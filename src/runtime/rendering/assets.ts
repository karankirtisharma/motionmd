import { TextureLoader, Texture, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace, EquirectangularReflectionMapping } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
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

export async function fetchBuffer(url: string, signal: AbortSignal, onBytes?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(assetURL(url), { signal });
  if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.byteLength; onBytes?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes.buffer;
}

export async function loadTexture(url: string, usage: 'color' | 'linear' | 'data' = 'data', signal?: AbortSignal): Promise<Texture> {
  signal?.throwIfAborted();
  const resolved = assetURL(url);
  const extension = url.split('?')[0].toLowerCase();
  let texture: Texture;
  if (extension.endsWith('.exr')) texture = await new EXRLoader().loadAsync(resolved);
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
