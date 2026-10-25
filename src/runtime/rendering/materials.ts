import { Color, DoubleSide, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Texture } from 'three';
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import type { SceneManifest } from '@/types';
import { loadTexture } from './assets';
import { asPhysicalNodeMaterial, withBakedDiffuse } from './BakedPhysicalMaterial';
import { materialClearcoat, materialClearcoatRoughness, materialRoughness, positionWorld, float, mix } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { sourceUVNormal } from './sourceNormals';
import { restoreSourceStoneWalls } from './sourceStoneWalls';
import { restoreSourceStoneFloors } from './sourceStoneFloors';
import { restoreSourceBronze } from './sourceBronze';
import { repairCollapsedBrushFrame } from './brushTangents';

const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;

export function prepareSourceMaterials(root: Object3D, renderer: WebGPURenderer): Set<Texture> {
  const textures = new Set<Texture>();
  const canonical = new Map<string, Texture>();
  const anisotropy = Math.min(16, renderer.getMaxAnisotropy());
  let references = 0, replaced = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    repairCollapsedBrushFrame(object);
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    if (!object.userData.contextOnly && !object.geometry.userData.contextOnly) {
      object.castShadow = object.userData.castShadow !== false; object.receiveShadow = true;
    }
    object.frustumCulled = !('isSkinnedMesh' in object);
    for (const material of materials) {
      // Thin glass should transmit sunlight; standard shadow maps cannot calculate tinted transmission.
      if ('transmission' in material && Number(material.transmission) > 0.5) object.castShadow = false;
      for (const [slot, value] of Object.entries(material)) {
        if (value instanceof Texture) {
          value.anisotropy = anisotropy;
          references++;
          // GLTFLoader clones every nonzero UV-channel texture assignment. Keep distinct
          // UV/color/sampler semantics, but share one Texture instance for identical views.
          const key = JSON.stringify([
            value.source.uuid, value.channel, value.colorSpace, value.mapping,
            value.wrapS, value.wrapT, 'wrapR' in value ? value.wrapR : null,
            value.magFilter, value.minFilter, value.anisotropy,
            value.format, value.type, value.internalFormat, value.generateMipmaps,
            value.flipY, value.premultiplyAlpha, value.unpackAlignment,
            value.offset.x, value.offset.y, value.repeat.x, value.repeat.y,
            value.center.x, value.center.y, value.rotation, value.matrixAutoUpdate,
            value.matrixAutoUpdate ? null : value.matrix.elements,
          ]);
          const existing = canonical.get(key);
          if (existing && existing !== value) {
            (material as unknown as Record<string, unknown>)[slot] = existing;
            value.userData.mdSkipUpload = true;
            value.dispose();
            replaced++;
            textures.add(existing);
          } else {
            canonical.set(key, value); textures.add(value);
          }
        }
      }
      // Preserve authored metallic, roughness, normal, coating, and emissive values.
      material.needsUpdate = true;
    }
  });
  console.info('[MD textures] canonicalized material views', { references, unique: textures.size, replaced });
  return textures;
}

export async function applyMaterialManifest(root: Object3D, manifest: SceneManifest, signal?: AbortSignal): Promise<Texture[]> {
  const ownedTextures: Texture[] = [];
  const cache = new Map<string, Promise<Texture>>();
  const uvViews = new Map<string, Texture>();
  const texture = (url: string, usage: 'color'|'linear'|'data') => {
    const key = `${url}:${usage}`;
    if (!cache.has(key)) cache.set(key, loadTexture(url, usage, signal).then(t => { t.flipY = false; ownedTextures.push(t); return t; }));
    return cache.get(key)!;
  };
  try {
  // Start every texture download together (lightmap EXRs were fetched one by one).
  // The loop below still resolves them from the cache in manifest order, so the
  // material assignment is unchanged; failures surface where they are awaited.
  const prefetch = (url: string | undefined, usage: 'color'|'linear'|'data') => { if (url) void texture(url, usage).catch(() => undefined); };
  for (const entry of manifest.materials ?? []) {
    if (entry.sourcePBR) {
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) prefetch(entry.sourcePBR[slot], slot === 'map' ? 'color' : 'data');
      continue;
    }
    for (const key of textureKeys) prefetch(entry[key], key === 'map' || key === 'emissiveMap' ? 'color' : 'data');
    prefetch(entry.lightMap, 'linear');
  }
  for (const entry of manifest.materials ?? []) {
    signal?.throwIfAborted();
    if (entry.sourcePBR) {
      const source = entry.sourcePBR;
      const maps = new Map<string, Texture>();
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
        if (!source[slot]) continue;
        const base = await texture(source[slot]!, slot === 'map' ? 'color' : 'data');
        const key = `${source[slot]}:${slot === 'map' ? 'color' : 'data'}:uv${source.uvChannel}`;
        if (!uvViews.has(key)) {
          const view = base.clone(); view.channel = source.uvChannel; view.needsUpdate = true;
          base.userData.mdSkipUpload = true; view.userData.mdSkipUpload = false;
          uvViews.set(key, view); ownedTextures.push(view);
        }
        maps.set(slot, uvViews.get(key)!);
      }
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        if (entry.objectNames?.length && !entry.objectNames.includes(object.name)) return;
        const original = Array.isArray(object.material) ? object.material : [object.material];
        const replaced = original.map(material => {
          if (material.name !== entry.name && !entry.objectNames?.includes(object.name)) return material;
          const result = new MeshPhysicalMaterial({ name: material.name, side: source.doubleSided ? DoubleSide : material.side, color: 0xffffff, roughness: source.roughness ?? 1, metalness: source.metalness ?? 0, clearcoat: source.clearcoat ?? 0, clearcoatRoughness: source.clearcoatRoughness ?? 0, ior: source.ior ?? 1.5, alphaTest: source.alphaTest ?? 0, opacity: source.opacity ?? 1, transparent: (source.opacity ?? 1) < 1 });
          result.normalScale.fromArray(source.normalScale ?? [1, 1]);
          for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) result[slot] = maps.get(slot) ?? null;
          const physical = asPhysicalNodeMaterial(result);
          if (physical.normalMap) physical.normalNode = sourceUVNormal(physical.normalMap, source.uvChannel, source.normalScale ?? [1, 1]);
          result.dispose();
          return physical;
        });
        object.material = Array.isArray(object.material) ? replaced : replaced[0];
      });
      continue;
    }
    const replacementMaps = new Map<string, Texture>();
    for (const key of textureKeys) {
      if (entry[key]) replacementMaps.set(key, await texture(entry[key]!, key === 'map' || key === 'emissiveMap' ? 'color' : 'data'));
    }
    let lightMap: Texture | null = null;
    if (entry.lightMap) {
      const channel = entry.uvChannel ?? 1;
      const key = `${entry.lightMap}:uv${channel}`;
      if (!uvViews.has(key)) {
        const base = await texture(entry.lightMap, 'linear');
        const view = base.clone(); view.channel = channel; view.needsUpdate = true;
        base.userData.mdSkipUpload = true;
        view.userData.mdSkipUpload = false;
        // EXRLoader returns vertically reversed typed-array scanlines, whereas glTF UVs
        // use an image-top origin. A UV transform works consistently on both backends.
        if (/\.exr(\?|$)/i.test(entry.lightMap)) { view.repeat.y = -1; view.offset.y = 1; }
        uvViews.set(key, view); ownedTextures.push(view);
      }
      lightMap = uvViews.get(key)!;
    }
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (entry.objectNames?.length && !entry.objectNames.includes(object.name)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const updated = source.map(material => {
        if (material.name !== entry.name && !entry.objectNames?.includes(object.name)) return material;
        if (entry.castShadow === false) { object.userData.castShadow = false; object.castShadow = false; }
        if (entry.lightMapMode === 'combined' && lightMap) {
          // A combined Cycles bake already contains reflected radiance and albedo.
          const result = new MeshBasicMaterial({ map: lightMap, color: new Color(1, 1, 1), side: material.side });
          result.name = `${material.name} | Cycles radiance`;
          return result;
        }
        if (!(material instanceof MeshStandardMaterial)) return material;
        const result = material.clone();
        for (const key of textureKeys) if (replacementMaps.has(key)) result[key] = replacementMaps.get(key)!;
        if (lightMap) {
          if (!object.geometry.getAttribute(`uv${lightMap.channel || ''}`)) {
            throw new Error(`Lighting UV channel ${lightMap.channel} missing on ${object.name}.`);
          }
          result.lightMap = lightMap;
          result.lightMapIntensity = entry.lightMapIntensity ?? 1;
          // The bake contains indirect diffuse. Environment reflections stay on metals;
          // avoid adding an ambient diffuse light over the precomputed illumination.
        }
        result.needsUpdate = true;
        if (!lightMap && !entry.regionOverrides?.length) return result;
        const physical = lightMap ? withBakedDiffuse(result) : asPhysicalNodeMaterial(result);
        if (physical.normalMap) {
          // A merged mesh can contain SourceUV0 and BakeUV1 materials. Its one
          // exported tangent attribute cannot describe both normal-map bases.
          physical.normalNode = sourceUVNormal(physical.normalMap, physical.normalMap.channel, [physical.normalScale.x, physical.normalScale.y]);
        }
        for (const override of entry.regionOverrides ?? []) {
          const coordinate = positionWorld[override.axis];
          const condition = override.operator === 'greaterThan' ? coordinate.greaterThan(override.threshold) : coordinate.lessThan(override.threshold);
          const weight = condition.select(1, 0);
          if (override.roughness !== undefined) physical.roughnessNode = mix((physical.roughnessNode ?? materialRoughness) as Node<'float'>, float(override.roughness), weight);
          if (override.clearcoat !== undefined) physical.clearcoatNode = mix((physical.clearcoatNode ?? materialClearcoat) as Node<'float'>, float(override.clearcoat), weight);
          if (override.clearcoatRoughness !== undefined) physical.clearcoatRoughnessNode = mix((physical.clearcoatRoughnessNode ?? materialClearcoatRoughness) as Node<'float'>, float(override.clearcoatRoughness), weight);
        }
        return physical;
      });
      object.material = Array.isArray(object.material) ? updated : updated[0];
    });
  }
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const updated = source.map(material => {
      if (!(material instanceof MeshStandardMaterial || material instanceof MeshPhysicalNodeMaterial) || !material.normalMap) return material;
      const physical = material instanceof MeshPhysicalNodeMaterial ? material : asPhysicalNodeMaterial(material);
      physical.normalNode = sourceUVNormal(physical.normalMap!, physical.normalMap!.channel, [physical.normalScale.x, physical.normalScale.y]);
      return physical;
    });
    object.material = Array.isArray(object.material) ? updated : updated[0];
  });
  // Only legacy atlases use probe fallback. Corrected orientation-v3 maps retain
  // their authored baked illumination, including the lounge limestone piers.
  const wallLightingFallbacks = new Set((manifest.materials ?? []).filter(entry =>
    entry.lightMap?.startsWith('/assets/lighting/')
  ).map(entry => entry.name));
  ownedTextures.push(...await restoreSourceStoneWalls(root, signal, wallLightingFallbacks));
  ownedTextures.push(...await restoreSourceStoneFloors(root, signal));
  ownedTextures.push(...await restoreSourceBronze(root, signal));
  return ownedTextures;
  } catch (error) {
    ownedTextures.forEach(texture => texture.dispose());
    throw error;
  }
}
