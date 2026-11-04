import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, UnsignedByteType } from 'three';

type ScalarImage = { pixels: Uint8Array<ArrayBuffer>; width: number; height: number };

/** Only for authored non-color scalar inputs. Absence of worker support or
 * non-identical channels returns null so the caller can use its original image. */
export async function decodeScalarImage(blob: Blob, signal?: AbortSignal): Promise<DataTexture | null> {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  let worker: Worker;
  try { worker = new Worker(new URL('./scalarImage.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return null; }
  const image = await new Promise<ScalarImage | null>((resolve, reject) => {
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', cancelled); };
    const cancelled = () => { cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', cancelled, { once: true });
    worker.onmessage = (event: MessageEvent<ScalarImage | null>) => { cleanup(); resolve(event.data); };
    worker.onerror = event => { event.preventDefault(); cleanup(); resolve(null); };
    try { worker.postMessage(blob); } catch { cleanup(); resolve(null); }
  });
  signal?.throwIfAborted();
  if (!image) return null;
  const texture = new DataTexture(image.pixels, image.width, image.height, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
