import type { SceneDeliverySize } from './loadingProgress.ts';
import { TextureLoader, Texture, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace, EquirectangularReflectionMapping } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { loadEXRInWorker } from './exrDecode.ts';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** Use a public object-storage origin for large deployments; local assets work unchanged. */
export function assetURL(path: string): string {
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const origin = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.replace(/\/$/, '') ?? '';
  return origin + (path.startsWith('/') ? path : `/${path}`);
}

/** Keep glTF root-relative images inside the configured CDN release prefix. */
export function resolveAssetDependency(url: string, base = process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '', pageURL = typeof window === 'undefined' ? 'http://localhost/' : window.location.href): string {
  if (!base || /^(blob:|data:)/.test(url)) return url;
  const prefix = base.replace(/\/$/, '');
  if (url.startsWith('/assets/')) return prefix + url;
  const origin = new URL(prefix, pageURL);
  const resource = new URL(url, pageURL);
  // GLTFLoader resolves '/assets/...' against the asset host before its manager
  // sees it. Restore the release subpath it would otherwise discard.
  if (resource.origin === origin.origin && resource.pathname.startsWith('/assets/')) return prefix + resource.pathname + resource.search + resource.hash;
  return url;
}

export async function fetchBuffer(url: string, signal: AbortSignal, onBytes?: (loaded: number, total: number, delivery?: SceneDeliverySize) => void, expectedBytes?: number): Promise<ArrayBuffer> {
  const response = await fetch(assetURL(url), { signal });
  if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  // Without progress reporting, let the browser manage its buffer directly.
  if (!onBytes || !response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  // Content-Length describes decoded bytes only for unencoded responses.
  // Fill one destination instead of retaining a second complete GLB in chunks.
  const encoding = response.headers.get('content-encoding');
  const delivery: SceneDeliverySize = { encodedBytes: Number(response.headers.get('x-scene-encoded-length')) || 0, decodedBytes: Number(response.headers.get('x-scene-decoded-length')) || 0, encoding: encoding || 'identity' };
  const decodedLength = Number(response.headers.get('x-asset-decoded-length')) || expectedBytes || ((!encoding || encoding === 'identity') ? total : 0);
  let direct = decodedLength > 0 && decodedLength <= 512 * 1024 * 1024 ? new Uint8Array(decodedLength) : undefined;
  const parts: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (direct && loaded + value.byteLength <= direct.length) direct.set(value, loaded);
      else {
        // A proxy may omit or misreport the length. Preserve every byte.
        if (direct) { parts.push(direct.subarray(0, loaded)); direct = undefined; }
        parts.push(value);
      }
      loaded += value.byteLength; onBytes(loaded, decodedLength || total, delivery);
    }
    if (direct) return loaded === direct.length ? direct.buffer : direct.buffer.slice(0, loaded);
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes.buffer;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

export async function loadTexture(url: string, usage: 'color' | 'linear' | 'data' = 'data', signal?: AbortSignal): Promise<Texture> {
  signal?.throwIfAborted();
  const resolved = assetURL(url);
  const extension = url.split('?')[0].toLowerCase();
  let texture: Texture;
  if (extension.endsWith('.exr')) texture = typeof Worker === 'undefined' ? await new EXRLoader().loadAsync(resolved) : await loadEXRInWorker(resolved, signal);
  else if (extension.endsWith('.hdr')) texture = await new RGBELoader().loadAsync(resolved);
  else texture = await new TextureLoader().loadAsync(resolved);
  if (signal?.aborted) { texture.dispose(); signal.throwIfAborted(); }
  texture.colorSpace = usage === 'color' ? SRGBColorSpace : usage === 'linear' ? LinearSRGBColorSpace : NoColorSpace;
  return texture;
}

export async function loadEnvironment(url: string, signal?: AbortSignal): Promise<Texture> {
  const texture = await loadTexture(url, /\.(exr|hdr)(\?|$)/i.test(url) ? 'linear' : 'color', signal);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
