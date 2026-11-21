import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Material, Mesh, Scene, Texture, Vector3 } from 'three';
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { prepareSkyBackground } from './prepareSkyBackground.ts';
import { backgroundIntensity, backgroundRotation, cameraPosition, cameraViewMatrix, equirectUV, float, mix, normalView, output, positionWorld, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { loadEnvironment } from './assets';
import type { ReadLightingBytes } from './lightingReadAhead';
import { createSandSurfaceTexture } from './SandSurface';

// Measured original 'Neutral presentation ground'; all values are Three Y-up.
export const SOURCE_GROUND = { minX: -28.77499962, maxX: 49.97499847, minZ: -62.95000076, maxZ: 24.54999924, y: -0.35499999 };
export const SKY_URL = '/assets/environment/qwantani-sunset-2k.hdr';
const SOURCE_SKY_SUN_AZIMUTH = 0.6258641614573416;
const SOURCE_SUN: [number, number, number] = [-28.817291, 19.211535, -20.012016];
// Sky light relative to direct sun (R, G, B) on flat sand, measured from the building's own shadow on the ground slab.
const SKY_TO_SUN = [0.39, 0.48, 0.69];
// Slope strength of the fine ripples and of the larger mid-distance pattern.
const NEAR_RELIEF = 2.8, BROAD_RELIEF = 5;

function smooth(a: number, b: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Smooth 0…1 value noise for dune-scale variation (build time only). */
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const a = tx * tx * (3 - 2 * tx), b = ty * ty * (3 - 2 * ty);
  const corner = (cx: number, cy: number) => {
    let value = Math.imul(cx, 374761393) ^ Math.imul(cy, 668265263) ^ seed;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const bottom = corner(ix, iy) * (1 - a) + corner(ix + 1, iy) * a, top = corner(ix, iy + 1) * (1 - a) + corner(ix + 1, iy + 1) * a;
  return bottom * (1 - b) + top * b;
}

/** One dune in cross-section: a long windward rise to the crest (at `windward`), then a short slip face. */
function duneProfile(cycle: number, windward: number) {
  const p = cycle - Math.floor(cycle);
  if (p < windward) return smooth(0, 1, p / windward);
  const q = (p - windward) / (1 - windward);
  return 1 - smooth(0, 1, Math.sqrt(q * Math.sqrt(q)));
}

/**
 * Static context only. Its inner rectangular ring exactly meets the original ground.
 * Dune shape, tone and the low sun's shadows are all decided here once, per vertex.
 */
export function createDesertGeometry(ground = SOURCE_GROUND, sunDirection: [number, number, number] = SOURCE_SUN) {
  const rings = 96, outerRadius = 1500;
  const centerX = (ground.minX + ground.maxX) / 2;
  const centerZ = (ground.minZ + ground.maxZ) / 2;
  // A buried overlap closes subpixel raster cracks along the bevelled source
  // ground edge. It is below the retained surface, avoiding coplanar z-fighting.
  const overlap = 0.25;
  const halfX = (ground.maxX - ground.minX) / 2 - overlap;
  const halfZ = (ground.maxZ - ground.minZ) / 2 - overlap;
  const corner = Math.atan2(halfZ, halfX);
  const thetaValues = [...Array.from({ length: 193 }, (_, i) => i / 192 * Math.PI * 2), corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner].sort((a, b) => a - b);
  const angles = thetaValues.length - 1;
  // Height above the flat ground. The wind blows from the sun's side, so the long windward
  // slopes catch the light and the slip faces fall away from it. Also reports where on its dune
  // a point sits (ridge: 0 trough … 1 crest) and how much dune there is at all (weight).
  let ridge = 0, weight = 0;
  const terrain = (x: number, z: number) => {
    const fromX = x - centerX, fromZ = z - centerZ, radius = Math.hypot(fromX, fromZ);
    ridge = 0; weight = 0;
    if (radius <= 70) return 0;
    const inner = radius * Math.min(halfX / Math.max(1e-8, Math.abs(fromX)), halfZ / Math.max(1e-8, Math.abs(fromZ)));
    weight = smooth(70, 135, radius) * smooth(8, 45, radius - inner);
    if (weight === 0) return 0;
    const along = x * 0.87 + z * 0.49, across = -x * 0.49 + z * 0.87;
    const broad = 0.5 + 0.5 * Math.sin(along * 0.010 - across * 0.014 + 1.4);
    // Crests wander and vary in height along their length, so ridges swell, sag and pinch out.
    const wander = noise(along * 0.0019 + 31.7, across * 0.0052 + 7.3, 11) - 0.5;
    const crest = 4.5 + 15 * smooth(0.2, 0.8, noise(along * 0.0042 + 3.1, across * 0.0088 + 19.4, 29)) + 3.5 * broad;
    const phase = along * 0.034 + 0.7 * Math.sin(across * 0.012) + 0.18 * Math.sin(across * 0.037) + 3 * wander;
    // The slip face stays near the angle of repose, so a taller dune gets a longer one. Far out it
    // widens to span several of the coarser triangles, which would otherwise stair-step along it.
    const windward = 1 - Math.max(crest * 0.0137, Math.min(0.5, radius * 0.0008));
    ridge = duneProfile((phase - 1.25) / (Math.PI * 2) + windward, windward);
    // Smaller dunes cross the troughs at another heading; they fade out where the mesh is coarse.
    const small = 3 * smooth(0.3, 0.75, noise(x * 0.0037 + 5.5, z * 0.0037 + 40.2, 47)) * (1 - 0.6 * ridge) * (1 - smooth(320, 720, radius));
    const along2 = x * 0.6 + z * 0.8, across2 = -x * 0.8 + z * 0.6;
    const minor = small > 0 ? duneProfile(along2 * 0.0156 + 0.06 * Math.sin(across2 * 0.021) + 0.5 * noise(along2 * 0.006, across2 * 0.014 + 9, 71), 0.74) : 0;
    return weight * (ridge * crest + 3.2 * broad + small * minor);
  };
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], heights: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = Math.pow(ring / rings, 1.65);
    for (let angle = 0; angle <= angles; angle++) {
      const theta = thetaValues[angle];
      const dx = Math.cos(theta), dz = Math.sin(theta);
      const inner = Math.min(halfX / Math.max(1e-8, Math.abs(dx)), halfZ / Math.max(1e-8, Math.abs(dz)));
      const radius = inner + (outerRadius - inner) * t;
      const x = centerX + dx * radius, z = centerZ + dz * radius;
      const height = terrain(x, z);
      const buriedEdge = 0.018 * (1 - smooth(0, 0.8, radius - inner));
      positions.push(x, ground.y + height - buriedEdge, z); heights.push(height);
      // Tone: exactly 1 where the ring meets the ground slab (which has no vertex colours), then
      // paler crests, deeper and slightly redder troughs, broad drifts and wind streaks.
      const blend = smooth(1.5, 40, radius - inner);
      const along = x * 0.87 + z * 0.49, across = -x * 0.49 + z * 0.87;
      const drift = noise(x * 0.0041 + 80, z * 0.0041 + 13, 5) - 0.5;
      const streak = (noise(along * 0.006 + 3, across * 0.034 + 50, 83) - 0.5) * (1 - smooth(250, 600, radius));
      const tone = 1 + blend * (0.05 * drift + 0.035 * streak + weight * (0.07 * ridge * ridge - 0.045 * (1 - ridge)));
      const warmth = blend * (0.04 * (noise(x * 0.0029 + 7, z * 0.0029 + 61, 131) - 0.5) - weight * 0.03 * (ridge - 0.5));
      colors.push(tone * (1 + warmth * 0.5), tone, tone * (1 - warmth));
      if (ring < rings && angle < angles) {
        const a = ring * (angles + 1) + angle, b = a + 1, c = a + angles + 1, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const normals = geometry.getAttribute('normal');
  for (let ring = 0; ring <= rings; ring++) {
    const first = ring * (angles + 1), last = first + angles;
    const normal = new Vector3().fromBufferAttribute(normals, first).add(new Vector3().fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z); normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
  // The dunes neither cast nor receive runtime shadows, so the low sun's shadows are marched
  // across the height field here and stored in the vertex colour. Only the sun's share of the
  // light is removed, which leaves shaded sand lit by the cooler sky as it is beside the building.
  const tint = geometry.getAttribute('color');
  const sunLength = Math.hypot(...sunDirection), sunFlat = Math.max(1e-6, Math.hypot(sunDirection[0], sunDirection[2]));
  const sunX = sunDirection[0] / sunFlat, sunZ = sunDirection[2] / sunFlat, sunRise = sunDirection[1] / sunFlat;
  const shade = new Float32Array(heights.length), row = angles + 1;
  for (let i = 0; i < heights.length; i++) {
    const x = positions[i * 3], z = positions[i * 3 + 2], radius = Math.hypot(x - centerX, z - centerZ);
    // Nothing inside the flat apron is shaded, and the widened far slip faces are too gentle to cast.
    if (radius < 75 || radius > 450) continue;
    let light = 1;
    for (let step = 1; step <= 12 && light > 0; step++) {
      const reach = step * (2.5 + 0.18 * step);
      light = Math.min(light, (heights[i] + reach * sunRise - terrain(x + sunX * reach, z + sunZ * reach)) * 6 / reach);
    }
    shade[i] = 1 - smooth(0, 1, light);
  }
  for (let ring = 1; ring < rings; ring++) for (let angle = 0; angle <= angles; angle++) {
    // Averaged with its four neighbours so a shadow edge does not stair-step along triangle edges.
    const i = ring * row + angle, before = ring * row + (angle === 0 ? angles - 1 : angle - 1), after = ring * row + (angle === angles ? 1 : angle + 1);
    const soft = (2 * shade[i] + shade[before] + shade[after] + shade[i - row] + shade[i + row]) / 6;
    const facing = (normals.getX(i) * sunDirection[0] + normals.getY(i) * sunDirection[1] + normals.getZ(i) * sunDirection[2]) / sunLength;
    if (soft > 0 && facing > 0) for (let channel = 0; channel < 3; channel++) tint.setComponent(i, channel, tint.getComponent(i, channel) * (1 - soft * facing / (facing + SKY_TO_SUN[channel])));
  }
  geometry.userData.contextOnly = true;
  return geometry;
}

// Each sample's UV is a fixed rotation and scale of world X/Z, so the slopes stored in the
// texture turn into a world-space gradient with the same four numbers.
const NEAR_UV = { ux: 0.1224, uz: 0.0494, vx: -0.0521, vz: 0.1289 };
const BROAD_UV = { ux: 0.766 / 24, uz: 0.643 / 24, vx: -0.643 / 24, vz: 0.766 / 24 };

function sandMaterial(sky: Texture, surface: Texture, vertexColors: boolean) {
  const material = new MeshStandardNodeMaterial({ color: new Color('#bda783'), roughness: 0.94, metalness: 0, vertexColors });
  material.name = vertexColors ? 'MD | distant desert sand' : 'shell__Neutral architectural ground';
  material.fog = false;
  const sandUV = vec2(positionWorld.x.mul(NEAR_UV.ux).add(positionWorld.z.mul(NEAR_UV.uz)), positionWorld.x.mul(NEAR_UV.vx).add(positionWorld.z.mul(NEAR_UV.vz)));
  const broadUV = vec2(positionWorld.x.mul(BROAD_UV.ux).add(positionWorld.z.mul(BROAD_UV.uz)), positionWorld.x.mul(BROAD_UV.vx).add(positionWorld.z.mul(BROAD_UV.vz))).add(vec2(0.37, 0.71));
  const near = texture(surface, sandUV), broad = texture(surface, broadUV);
  const albedoVariation = mix(float(0.85), float(1.12), near.r.mul(0.35).add(broad.r.mul(0.65))).mul(mix(float(0.955), float(1.045), near.g.mul(0.6).add(broad.g.mul(0.4))));
  material.colorNode = vec3(material.color.r, material.color.g, material.color.b).mul(albedoVariation);
  material.roughnessNode = float(0.895).add(near.g.mul(0.11));
  // Ripple relief comes from the slope channels of the two samples already taken: fine ripples
  // underfoot, and the same pattern three times larger carrying the relief into the middle
  // distance. Both fade out with distance before they could shimmer.
  const distance = positionWorld.distance(cameraPosition);
  const nearSlope = near.zw.sub(0.5).mul(float(1).sub(smoothstep(12, 60, distance)).mul(NEAR_RELIEF));
  const broadSlope = broad.zw.sub(0.5).mul(float(1).sub(smoothstep(60, 300, distance)).mul(BROAD_RELIEF));
  const gradient = vec3(
    nearSlope.x.mul(NEAR_UV.ux).add(nearSlope.y.mul(NEAR_UV.vx)).add(broadSlope.x.mul(BROAD_UV.ux)).add(broadSlope.y.mul(BROAD_UV.vx)), 0,
    nearSlope.x.mul(NEAR_UV.uz).add(nearSlope.y.mul(NEAR_UV.vz)).add(broadSlope.x.mul(BROAD_UV.uz)).add(broadSlope.y.mul(BROAD_UV.vz)));
  material.normalNode = normalView.sub(cameraViewMatrix.mul(vec4(gradient, 0)).xyz).normalize();
  const direction = positionWorld.sub(cameraPosition).normalize();
  const skyDirection = backgroundRotation.mul(vec4(direction, 0)).xyz;
  const horizonColor = texture(sky, equirectUV(skyDirection)).level(float(0)).rgb.mul(backgroundIntensity);
  const haze = smoothstep(180, 1450, distance);
  // Fog is confined to this material. The building's glass, lights, bakes and
  // exposure remain on their source rendering path.
  material.outputNode = vec4(mix(output.rgb, horizonColor, haze), output.a);
  return material;
}

/** Call after source lighting/shadow bounds are configured. Does not change IBL. */
export async function createDesertEnvironment(scene: Scene, options: { renderer?: WebGPURenderer; signal?: AbortSignal; readBytes?: ReadLightingBytes; sunDirection?: [number, number, number] } = {}) {
  options.signal?.throwIfAborted();
  const sky = await loadEnvironment(SKY_URL, options.signal, options.readBytes);
  let skyTarget: ReturnType<typeof prepareSkyBackground> | undefined;
  try { options.signal?.throwIfAborted(); if (options.renderer) skyTarget = prepareSkyBackground(options.renderer, sky); }
  catch (error) { sky.dispose(); throw error; }
  const background = skyTarget?.texture ?? sky;
  const previous = { background: scene.background, intensity: scene.backgroundIntensity, blur: scene.backgroundBlurriness, rotation: scene.backgroundRotation.clone() };
  const root = new Group(); root.name = 'MD | desert background context'; root.userData.contextOnly = true;
  const groundBounds = new Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((material) => /Neutral architectural ground/i.test(material.name))) {
      groundBounds.union(new Box3().setFromObject(mesh));
    }
  });
  // Fit the evaluated/exported surface, including source modifiers and rounding.
  const ground = groundBounds.isEmpty() ? SOURCE_GROUND : { minX: groundBounds.min.x, maxX: groundBounds.max.x, minZ: groundBounds.min.z, maxZ: groundBounds.max.z, y: groundBounds.max.y };
  const geometry = createDesertGeometry(ground, options.sunDirection);
  const surface = createSandSurfaceTexture();
  const duneMaterial = sandMaterial(sky, surface, true), groundMaterial = sandMaterial(sky, surface, false);
  const dunes = new Mesh(geometry, duneMaterial);
  dunes.name = 'MD | distant static dunes'; dunes.castShadow = false; dunes.receiveShadow = false;
  dunes.userData.noCollision = true; root.add(dunes);
  const replaced: Array<{ mesh: Mesh; material: Material | Material[] }> = [];
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!list.some((material) => /Neutral architectural ground/i.test(material.name))) return;
    replaced.push({ mesh, material: mesh.material });
    const replacements = list.map((material) => /Neutral architectural ground/i.test(material.name) ? groundMaterial : material);
    mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
  });
  scene.add(root);
  scene.background = background; scene.backgroundIntensity = 0.65; scene.backgroundBlurriness = 0;
  const sun = new Vector3(...(options.sunDirection ?? SOURCE_SUN));
  // Align the photographed sun's azimuth with the authored key. Its low sunset
  // elevation is retained; this background never rotates the baked scene light.
  scene.backgroundRotation.set(0, SOURCE_SKY_SUN_AZIMUTH - Math.atan2(sun.z, sun.x), 0);
  let disposed = false;
  return {
    root, triangles: geometry.index!.count / 3, sourceGroundMaterials: replaced.length, ground,
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent();
      replaced.forEach(({ mesh, material }) => { mesh.material = material; });
      if (scene.background === background) {
        scene.background = previous.background; scene.backgroundIntensity = previous.intensity;
        scene.backgroundBlurriness = previous.blur; scene.backgroundRotation.copy(previous.rotation);
      }
      geometry.dispose(); duneMaterial.dispose(); groundMaterial.dispose(); surface.dispose(); skyTarget?.dispose(); sky.dispose();
    },
  };
}
