import { DataTexture, LinearFilter } from 'three';
import { fetchAssetBuffer } from './fetchAsset.ts';
import type { DataTextureLoaderTexData } from 'three';
/** One bounded decode job per worker; workers and listeners are released on every outcome. */
export async function loadEXRInWorker(url: string, signal?: AbortSignal): Promise<DataTexture> {
  signal?.throwIfAborted();
  const buffer = await fetchAssetBuffer(url, { signal });
  signal?.throwIfAborted();
  const result = await new Promise<DataTextureLoaderTexData>((resolve, reject) => {
    const worker = new Worker(new URL('./exr.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    worker.onmessage = (event: MessageEvent<{ result?: DataTextureLoaderTexData; error?: string }>) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Lighting decode failed.'));
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Lighting worker could not start.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(buffer, [buffer]); } catch (error) { cleanup(); reject(error); }
  });
  signal?.throwIfAborted();
  const texture = new DataTexture(result.data, result.width, result.height, result.format, result.type);
  texture.colorSpace = result.colorSpace ?? texture.colorSpace;
  texture.minFilter = result.minFilter ?? LinearFilter; texture.magFilter = result.magFilter ?? LinearFilter;
  texture.generateMipmaps = result.generateMipmaps ?? false; texture.flipY = result.flipY ?? false;
  texture.needsUpdate = true;
  return texture;
}
