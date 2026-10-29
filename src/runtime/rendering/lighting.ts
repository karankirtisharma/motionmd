import { Box3, Color, CubeTextureLoader, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace, Mesh, MeshStandardMaterial, Object3D, PointLight, RectAreaLight, RGBAFormat, Scene, SpotLight, Texture, Vector3 } from 'three';
import { MeshPhysicalNodeMaterial, PMREMGenerator, RectAreaLightNode, type WebGPURenderer } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import type { SceneManifest } from '@/types';
import { assetURL, loadEnvironment } from './assets';
import { asPhysicalNodeMaterial } from './BakedPhysicalMaterial';
import { filterTemporaryEnvironment } from './temporaryEnvironment';
import { roomEnvironment, probesForBounds, type RoomProbe } from './probes';
import { architecturalShadowBounds, fitSunShadow } from './shadowBounds';

function authoredColor(value: string | [number, number, number]): Color {
  return Array.isArray(value) ? new Color().setRGB(...value, LinearSRGBColorSpace) : new Color(value);
}

/** A linear HDR gradient resembling the source world if no exported capture is present. */
function neutralWorld(): Texture {
  const width = 256, height = 128;
  const data = new Uint16Array(width * height * 4);
  const low = new Color().setRGB(0.12, 0.11, 0.10);
  const horizon = new Color().setRGB(0.65, 0.61, 0.55);
  const zenith = new Color().setRGB(0.42, 0.49, 0.58);
  for (let y = 0; y < height; y++) {
    // Typed arrays use bottom-up rows for equirectangular sampling: +Y maps to v=1.
    const t = 1 - y / (height - 1);
    const color = t < 0.5 ? zenith.clone().lerp(horizon, t * 2) : horizon.clone().lerp(low, (t - 0.5) * 2);
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      data[i] = DataUtils.toHalfFloat(color.r); data[i + 1] = DataUtils.toHalfFloat(color.g); data[i + 2] = DataUtils.toHalfFloat(color.b); data[i + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export async function configureLighting(scene: Scene, renderer: WebGPURenderer, manifest: SceneManifest, bounds: Box3, signal?: AbortSignal) {
  const owned: Array<{ dispose: () => void }> = [];
  const installed: Object3D[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    installed.forEach(object => object.removeFromParent());
    scene.environment = null; scene.background = null;
    owned.forEach(resource => resource.dispose());
  };
  const pmrem = new PMREMGenerator(renderer);
  try {
  signal?.throwIfAborted();
  let environment: Texture;
  if (manifest.environment?.url) environment = await loadEnvironment(manifest.environment.url, signal);
  else if (manifest.environment?.faces?.length === 6) environment = await new CubeTextureLoader().loadAsync(manifest.environment.faces.map(assetURL));
  else environment = neutralWorld();
  const keepSource = manifest.environment?.background !== false;
  if (keepSource) owned.push(environment);
  const filter = (source: Texture) => 'isCubeTexture' in source ? pmrem.fromCubemap(source) : pmrem.fromEquirectangular(source);
  const filtered = keepSource ? filter(environment) : filterTemporaryEnvironment(environment, filter);
  owned.push(filtered);
  scene.environment = filtered.texture;
  scene.environmentIntensity = manifest.environment?.intensity ?? 0.65;
  scene.environmentRotation.y = manifest.environment?.rotation ?? 0;
  const background = manifest.environment?.background === false ? neutralWorld() : environment;
  if (background !== environment) owned.push(background);
  scene.background = background;
  scene.backgroundIntensity = 0.65;
  scene.backgroundBlurriness = 0.1;
  scene.backgroundRotation.copy(scene.environmentRotation);

  // The shader chooses the region per fragment and corrects each reflected ray against its box.
  const probes: RoomProbe[] = [];
  for (const probe of manifest.reflectionProbes ?? []) {
    const source = await loadEnvironment(probe.url, signal);
    const capture = filterTemporaryEnvironment(source, texture => pmrem.fromEquirectangular(texture));
    owned.push(capture);
    const region = new Box3(new Vector3().fromArray(probe.bounds.min), new Vector3().fromArray(probe.bounds.max));
    probes.push({ id: probe.id, region, position: probe.position ? new Vector3().fromArray(probe.position) : region.getCenter(new Vector3()), texture: capture.texture, intensity: probe.intensity ?? 1 });
  }
  function refreshProbeLighting(root: Object3D, moving = false) {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const objectBounds = moving ? null : new Box3().setFromObject(object);
      // Moving people retain one shader through room boundaries. The fragment
      // shader already evaluates probe influence and blends its boundary.
      const candidates = moving ? probes : probesForBounds(probes, objectBounds!);
      const key = candidates.map(probe => probe.id).join('|');
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const updated = list.map(material => {
        if (!(material instanceof MeshStandardMaterial) && !(material instanceof MeshPhysicalNodeMaterial)) return material;
        if (material instanceof MeshPhysicalNodeMaterial && material.userData.mdProbeKey === key) return material;
        const node = material instanceof MeshPhysicalNodeMaterial ? material : asPhysicalNodeMaterial(material);
        // Explicit envMap makes materialEnvIntensity independent of the scene's diffuse fill.
        node.envMap = filtered.texture;
        node.envMapIntensity = 1;
        node.envNode = roomEnvironment(filtered.texture, scene.environmentIntensity, candidates);
        node.userData.mdProbeKey = key;
        node.needsUpdate = true;
        return node;
      });
      object.material = Array.isArray(object.material) ? updated : updated[0];
    });
  }
  refreshProbeLighting(scene);

  const shadowBounds = architecturalShadowBounds(scene, bounds);
  const center = shadowBounds.getCenter(new Vector3());
  const sunData = manifest.sun;
  const sun = new DirectionalLight(authoredColor(sunData?.color ?? [1, 0.77, 0.52]), sunData?.intensity ?? 3.2);
  sun.name = 'MD | source sunset key';
  sun.position.fromArray(sunData?.position ?? [center.x - 25, center.y + 12, center.z + 30]);
  sun.target.position.copy(center);
  if (sunData?.positionIsDirection) sun.position.add(sun.target.position);
  sun.castShadow = manifest.baking?.mode !== 'combined';
  sun.shadow.mapSize.set(4096, 4096);
  const shadowFit = fitSunShadow(sun, shadowBounds);
  console.info('[MD stable shadows]', shadowFit);
  sun.shadow.normalBias = 0.008;
  sun.shadow.bias = -0.000025;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  installed.push(sun, sun.target); owned.push(sun.shadow);

  // These are source-authored practicals. Their powers must be calibrated by export;
  // area lights are baked instead of being indiscriminately replaced by point lights.
  if (manifest.lights?.some(light => light.type === 'area') && !manifest.baking?.bakedPracticals) RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  for (const light of manifest.baking?.bakedPracticals ? [] : manifest.lights ?? []) {
    const color = authoredColor(light.color);
    if (light.type === 'directional') continue;
    if (light.type === 'area') {
      const instance = new RectAreaLight(color, light.intensity, light.size ?? 1, light.sizeY ?? light.size ?? 1);
      instance.name = light.id; instance.position.fromArray(light.position);
      if (light.quaternion) instance.quaternion.fromArray(light.quaternion);
      else if (light.target) instance.lookAt(new Vector3().fromArray(light.target));
      scene.add(instance);
      installed.push(instance);
      continue;
    }
    const instance = light.type === 'spot'
      ? new SpotLight(color, light.intensity, light.range ?? 0, light.angle ?? Math.PI / 3, 0.4, light.decay ?? 2)
      : new PointLight(color, light.intensity, light.range ?? 0, light.decay ?? 2);
    instance.name = light.id; instance.position.fromArray(light.position);
    instance.castShadow = false;
    if (instance instanceof SpotLight && light.target) { instance.target.position.fromArray(light.target); scene.add(instance.target); installed.push(instance.target); }
    scene.add(instance);
    installed.push(instance);
  }
  return { sun, refreshProbeLighting, dispose };
  } catch (error) {
    dispose(); throw error;
  } finally {
    pmrem.dispose();
  }
}
