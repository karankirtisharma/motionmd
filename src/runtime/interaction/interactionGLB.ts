import { BufferGeometry, LoaderUtils, Material, Mesh, Skeleton, SkinnedMesh, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetURL, resolveAssetDependency } from '../rendering/assets.ts';
import { fetchAssetBuffer } from '../rendering/fetchAsset.ts';
import type { SceneManifest } from '../../types';
import delivery from '../../generated/asset-delivery.json' with { type: 'json' };
import { createLightingReadAhead } from '../rendering/lightingReadAhead.ts';
import { createAssetLoadGuard } from '../rendering/loadingGuard.ts';

export type ReadInteractionBytes = (path: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

const fetchInteractionBytes: ReadInteractionBytes = (path, signal) => fetchAssetBuffer(assetURL(path), { signal });

/** The visitor and ten collision files total 17.84 MiB after HTTP decompression.
 * Start their transfers during material setup; the original consumers still own decoding. */
export function createInteractionReadAhead(manifest: Pick<SceneManifest, 'character' | 'collisions'>, signal: AbortSignal) {
  const urls = [manifest.character?.url, manifest.collisions?.url, ...(manifest.collisions?.additionalUrls ?? [])];
  const entries: Readonly<Record<string, { decodedBytes: number }>> = delivery;
  const sizes: Record<string, number> = {};
  for (const url of urls) {
    if (url && entries[url]) sizes[url] = entries[url].decodedBytes;
  }
  return createLightingReadAhead(sizes, fetchInteractionBytes, signal, 20 * 1024 * 1024, 2);
}

/** Every resource in these imports belongs to the private, unattached GLTF. */
export function disposeInteractionGLB(gltf: GLTF) {
  const geometry = new Set<BufferGeometry>(), materials = new Set<Material>();
  const textures = new Set<Texture>(), skeletons = new Set<Skeleton>();
  for (const scene of gltf.scenes) scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    geometry.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
    if ((mesh as SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as SkinnedMesh).skeleton);
  });
  geometry.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
  textures.forEach(item => item.dispose()); skeletons.forEach(item => item.dispose());
}

export async function loadInteractionGLB(path: string, signal?: AbortSignal, readBytes: ReadInteractionBytes = fetchInteractionBytes) {
  const url = assetURL(path);
  const bytes = await readBytes(path, signal);
  signal?.throwIfAborted();
  const guard = createAssetLoadGuard(resolveAssetDependency);
  const abortDependencies = () => guard.manager.abort();
  signal?.addEventListener('abort', abortDependencies, { once: true });
  try {
    // Keep relative resources beside the originally requested GLB, even when a
    // CDN rewrite delivers its bytes from a separate content-addressed object.
    const gltf = await new GLTFLoader(guard.manager).parseAsync(bytes, LoaderUtils.extractUrlBase(url));
    try {
      signal?.throwIfAborted();
      guard.assertLoaded();
      return gltf;
    } catch (error) {
      disposeInteractionGLB(gltf);
      throw error;
    }
  } finally {
    signal?.removeEventListener('abort', abortDependencies);
  }
}

/** Two collision imports at a time, alongside the independently loaded visitor.
 * Preserve source order because collider assignment and snapshots depend on it. */
export async function loadCollisionGLBs(urls: string[], signal?: AbortSignal, readBytes?: ReadInteractionBytes) {
  signal?.throwIfAborted();
  const batch = new AbortController();
  const abort = () => batch.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const loaded: GLTF[] = [];
  let next = 0;
  async function worker() {
    try {
      while (next < urls.length) {
        batch.signal.throwIfAborted();
        const i = next++;
        loaded[i] = await loadInteractionGLB(urls[i], batch.signal, readBytes);
      }
    } catch (error) { batch.abort(error); }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, urls.length) }, worker));
    if (batch.signal.aborted) {
      loaded.forEach(disposeInteractionGLB);
      batch.signal.throwIfAborted();
    }
    return loaded;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
