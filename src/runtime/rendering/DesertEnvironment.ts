import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Material, Mesh, Scene, Texture, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { backgroundIntensity, backgroundRotation, bumpMap, cameraPosition, equirectUV, float, mix, output, positionWorld, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { loadEnvironment } from './assets';
import { createSandSurfaceTexture } from './SandSurface';

// Measured original 'Neutral presentation ground'; all values are Three Y-up.
export const SOURCE_GROUND = { minX: -28.77499962, maxX: 49.97499847, minZ: -62.95000076, maxZ: 24.54999924, y: -0.35499999 };
const SKY_URL = '/assets/environment/qwantani-sunset-2k.hdr';
const SOURCE_SKY_SUN_AZIMUTH = 0.6258641614573416;

function smooth(a: number, b: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Static context only. Its inner rectangular ring exactly meets the original ground. */
export function createDesertGeometry(ground = SOURCE_GROUND) {
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
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = Math.pow(ring / rings, 1.65);
    for (let angle = 0; angle <= angles; angle++) {
      const theta = thetaValues[angle];
      const dx = Math.cos(theta), dz = Math.sin(theta);
      const inner = Math.min(halfX / Math.max(1e-8, Math.abs(dx)), halfZ / Math.max(1e-8, Math.abs(dz)));
      const radius = inner + (outerRadius - inner) * t;
      const x = centerX + dx * radius, z = centerZ + dz * radius;
      const along = x * 0.87 + z * 0.49, across = -x * 0.49 + z * 0.87;
      const phase = along * 0.034 + 0.7 * Math.sin(across * 0.012) + 0.18 * Math.sin(across * 0.037);
      const ridge = Math.pow(0.5 + 0.5 * Math.sin(phase + 0.34 * Math.sin(phase)), 2.1);
      const broad = 0.5 + 0.5 * Math.sin(along * 0.010 - across * 0.014 + 1.4);
      const duneWeight = smooth(70, 135, radius) * smooth(8, 45, radius - inner);
      const height = duneWeight * (ridge * (13 + 8 * broad) + 4 * broad);
      const buriedEdge = 0.018 * (1 - smooth(0, 0.8, radius - inner));
      positions.push(x, ground.y + height - buriedEdge, z);
      const variation = 0.98 + 0.025 * Math.sin(x * 0.011 + z * 0.007) + 0.015 * Math.sin(z * 0.037);
      colors.push(variation, variation, variation);
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
  geometry.userData.contextOnly = true;
  return geometry;
}

function sandMaterial(sky: Texture, surface: Texture, vertexColors: boolean) {
  const material = new MeshStandardNodeMaterial({ color: new Color('#bda783'), roughness: 0.94, metalness: 0, vertexColors });
  material.name = vertexColors ? 'MD | distant desert sand' : 'shell__Neutral architectural ground';
  material.fog = false;
  const sandUV = vec2(positionWorld.x.mul(0.11).add(positionWorld.z.mul(0.025)), positionWorld.z.mul(0.117).sub(positionWorld.x.mul(0.03)));
  const broadUV = vec2(positionWorld.x.mul(-0.6).add(positionWorld.z.mul(0.8)), positionWorld.x.mul(0.8).add(positionWorld.z.mul(0.6))).div(29).add(vec2(0.37, 0.71));
  const near = texture(surface, sandUV), broad = texture(surface, broadUV);
  const albedoVariation = mix(float(0.85), float(1.12), near.r.mul(0.45).add(broad.r.mul(0.55)));
  material.colorNode = vec3(material.color.r, material.color.g, material.color.b).mul(albedoVariation);
  material.roughnessNode = float(0.87).add(near.g.mul(0.11));
  const detailFade = float(1).sub(smoothstep(12, 60, positionWorld.distance(cameraPosition)));
  material.normalNode = bumpMap(near.b, float(0.09).mul(detailFade));
  const direction = positionWorld.sub(cameraPosition).normalize();
  const skyDirection = backgroundRotation.mul(vec4(direction, 0)).xyz;
  const horizonColor = texture(sky, equirectUV(skyDirection)).level(float(0)).rgb.mul(backgroundIntensity);
  const haze = smoothstep(180, 1450, positionWorld.distance(cameraPosition));
  // Fog is confined to this material. The building's glass, lights, bakes and
  // exposure remain on their source rendering path.
  material.outputNode = vec4(mix(output.rgb, horizonColor, haze), output.a);
  return material;
}

/** Call after source lighting/shadow bounds are configured. Does not change IBL. */
export async function createDesertEnvironment(scene: Scene, options: { signal?: AbortSignal; sunDirection?: [number, number, number] } = {}) {
  options.signal?.throwIfAborted();
  const sky = await loadEnvironment(SKY_URL, options.signal);
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
  const geometry = createDesertGeometry(ground);
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
  scene.background = sky; scene.backgroundIntensity = 0.65; scene.backgroundBlurriness = 0;
  const sun = new Vector3(...(options.sunDirection ?? [-28.817291, 19.211535, -20.012016]));
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
      if (scene.background === sky) {
        scene.background = previous.background; scene.backgroundIntensity = previous.intensity;
        scene.backgroundBlurriness = previous.blur; scene.backgroundRotation.copy(previous.rotation);
      }
      geometry.dispose(); duneMaterial.dispose(); groundMaterial.dispose(); surface.dispose(); sky.dispose();
    },
  };
}
