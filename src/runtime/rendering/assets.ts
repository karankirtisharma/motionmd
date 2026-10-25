import { TextureLoader, Texture, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace, EquirectangularReflectionMapping } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/*
 * Content versions from /assets/asset-versions.json (written at build). Every asset URL
 * carries ?v=<content hash>, so the CDN and browser may cache it as immutable and a repeat
 * visit loads the scene from disk. Without the file (dev), URLs stay unversioned.
 */
let versions: Readonly<Record<string, string>> | undefined;
export function setAssetVersions(map: Readonly<Record<string, string>> | undefined) { versions = map; }
export function withAssetVersion(url: string): string {
  if (!versions || /^(blob:|data:)/.test(url) || /[?&]v=/.test(url)) return url;
  let parsed: URL;
  try { parsed = new URL(url, 'http://md.local/'); } catch { return url; }
  // glTF-relative URIs arrive as '.../founder-lift-v10/../source-walls/x.png'; URL normalises them.
  const pathname = decodeURI(parsed.pathname), pathStart = pathname.indexOf('/assets/');
  const version = pathStart < 0 ? undefined : versions[pathname.slice(pathStart)];
  if (!version) return url;
  parsed.searchParams.set('v', version);
  return /^[a-z]+:/i.test(url) ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

/** Use a public object-storage origin for large deployments; local assets work unchanged. */
export function assetURL(path: string): string {
  if (/^(https?:|blob:|data:)/.test(path)) return withAssetVersion(path);
  const origin = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.replace(/\/$/, '') ?? '';
  return withAssetVersion(origin + (path.startsWith('/') ? path : `/${path}`));
}

/** Keep glTF root-relative images inside the configured CDN release prefix (and versioned). */
export function resolveAssetDependency(url: string, base = process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '', pageURL = typeof window === 'undefined' ? 'http://localhost/' : window.location.href): string {
  return withAssetVersion(resolveAssetHost(url, base, pageURL));
}

function resolveAssetHost(url: string, base: string, pageURL: string): string {
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

/*
 * Browsers' HTTP caches refuse single entries this large (the 190 MB studio chunk is
 * re-downloaded on every visit), so versioned scene chunks are also kept in Cache Storage.
 * Keys include ?v=<content hash>; entries from older builds are pruned once versions load.
 */
const SCENE_CACHE = 'md-scene-chunks';
async function cachedFetch(url: string, signal: AbortSignal): Promise<Response> {
  if (typeof caches === 'undefined' || !/[?&]v=/.test(url)) return fetch(url, { signal });
  let cache: Cache;
  try { cache = await caches.open(SCENE_CACHE); } catch { return fetch(url, { signal }); }
  const hit = await cache.match(url).catch(() => undefined);
  if (hit) return hit;
  const response = await fetch(url, { signal });
  if (response.ok) void cache.put(url, response.clone()).catch(() => undefined); // quota or private mode: just skip
  return response;
}
export async function pruneSceneCache() {
  if (typeof caches === 'undefined' || !versions) return;
  try {
    const cache = await caches.open(SCENE_CACHE);
    for (const request of await cache.keys()) {
      const url = new URL(request.url), current = versions[decodeURI(url.pathname).slice(decodeURI(url.pathname).indexOf('/assets/'))];
      if (url.searchParams.get('v') !== current) await cache.delete(request);
    }
  } catch { /* storage unavailable */ }
}

/** True when the build wrote a gzip twin (scripts/compress-assets.mjs) for this asset path. */
const hasGzipTwin = (url: string) => !!versions?.[`${url.split('?')[0]}.gz`];

export async function fetchBuffer(url: string, signal: AbortSignal, onBytes?: (loaded: number, total: number) => void, expectedBytes = 0): Promise<ArrayBuffer> {
  // Large GLBs ship as .glb.gz (the CDN does not compress model/gltf-binary). Inflate the
  // stream natively; the bytes are identical to the original file.
  const gzip = hasGzipTwin(url) && typeof DecompressionStream !== 'undefined';
  const response = await cachedFetch(assetURL(gzip ? `${url}.gz` : url), signal);
  if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status}).`);
  const total = gzip ? expectedBytes : Number(response.headers.get('content-length')) || expectedBytes;
  if (!response.body) return gzip ? new Response(new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : response.arrayBuffer();
  const reader = (gzip ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body).getReader();
  // Stream straight into one buffer when the size is known (no second full-size copy for
  // the 100-300 MB chunks). A compressed transfer can exceed Content-Length; grow then.
  let bytes = new Uint8Array(total || 1 << 20);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > bytes.byteLength) {
      const grown = new Uint8Array(Math.max(bytes.byteLength * 2, loaded + value.byteLength));
      grown.set(bytes.subarray(0, loaded)); bytes = grown;
    }
    bytes.set(value, loaded); loaded += value.byteLength; onBytes?.(loaded, total);
  }
  return loaded === bytes.byteLength ? bytes.buffer : bytes.slice(0, loaded).buffer;
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
