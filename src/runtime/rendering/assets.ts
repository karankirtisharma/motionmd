import delivery from '../../generated/asset-delivery.json' with { type: 'json' };
import { versionedAssetPath } from '../../server/assetRevision.ts';
import type { SceneDeliverySize } from './loadingProgress.ts';
import { fetchAssetBuffer } from './fetchAsset.ts';
import { TextureLoader, Texture, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace, EquirectangularReflectionMapping } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { loadEXRInWorker } from './exrDecode.ts';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** Use a public object-storage origin for large deployments; local assets work unchanged. */
export function assetURL(path: string): string {
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const origin = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.replace(/\/$/, '') ?? '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return origin ? origin + normalized : versionedAssetPath(normalized, delivery);
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
  return fetchAssetBuffer(assetURL(url), { signal, expectedBytes, onProgress: onBytes ? (loaded, total, headers) => {
    onBytes(loaded, total, { encodedBytes: Number(headers.get('x-scene-encoded-length')) || 0,
      decodedBytes: Number(headers.get('x-scene-decoded-length')) || 0, encoding: headers.get('content-encoding') || 'identity' });
  } : undefined });
}

export async function loadTexture(url: string, usage: 'color' | 'linear' | 'data' = 'data', signal?: AbortSignal): Promise<Texture> {
  signal?.throwIfAborted();
  const resolved = assetURL(url);
  const extension = url.split('?')[0].toLowerCase();
  let texture: Texture;
  if (extension.endsWith('.exr')) texture = typeof Worker === 'undefined'
    ? new EXRLoader().createDataTexture(await fetchAssetBuffer(resolved, { signal })) : await loadEXRInWorker(resolved, signal);
  else if (extension.endsWith('.hdr')) texture = new RGBELoader().createDataTexture(await fetchAssetBuffer(resolved, { signal }));
  else {
    const bytes = await fetchAssetBuffer(resolved, { signal });
    signal?.throwIfAborted();
    const objectURL = URL.createObjectURL(new Blob([bytes]));
    try {
      texture = await new Promise<Texture>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const abort = () => { if (settled) return; settled = true; cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        new TextureLoader().load(objectURL, loaded => {
          if (settled) { loaded.dispose(); return; }
          settled = true; cleanup(); resolve(loaded);
        }, undefined, cause => {
          if (settled) return; settled = true; cleanup();
          reject(new Error(`Could not decode texture ${url.split('/').pop()}.`, { cause }));
        });
        if (signal?.aborted) abort();
      });
    } finally { URL.revokeObjectURL(objectURL); }
  }
  if (signal?.aborted) { texture.dispose(); signal.throwIfAborted(); }
  texture.colorSpace = usage === 'color' ? SRGBColorSpace : usage === 'linear' ? LinearSRGBColorSpace : NoColorSpace;
  return texture;
}

export async function loadEnvironment(url: string, signal?: AbortSignal): Promise<Texture> {
  const texture = await loadTexture(url, /\.(exr|hdr)(\?|$)/i.test(url) ? 'linear' : 'color', signal);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
