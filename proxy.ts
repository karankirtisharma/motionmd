import { NextResponse, type NextRequest } from 'next/server';
import delivery from './src/generated/asset-delivery.json';
import textureDelivery from './src/generated/texture-delivery.json';
import rawRevisions from './src/generated/immutable-scene-assets.json';
import chairLightmap from './src/generated/chair-lightmap.json';
import { prefersWebP } from './src/server/imageEncoding';
import manifest from './public/assets/scene-manifest.json';
import { selectAssetEncoding } from './src/server/assetEncoding';
import { assetCacheControl } from './src/server/assetRevision';

type DeliveryEntry = { br: string; gzip: string; identity?: string; decodedBytes: number; brBytes: number; gzipBytes: number };
const entries = delivery as Record<string, DeliveryEntry>;
const textures: Record<string, { webp: string }> = textureDelivery;
const raw: Record<string, string> = rawRevisions;
const immutablePaths = new Set(Object.values(entries).flatMap(entry => [entry.br, entry.gzip, entry.identity].filter((path): path is string => !!path)));
for (const texture of Object.values(textures)) immutablePaths.add(texture.webp);
const chairURL=(chairLightmap as {url?:string}).url;
if(chairURL) immutablePaths.add(chairURL);
const totals = manifest.chunks.map(chunk => entries[chunk.url]).filter(Boolean).reduce((sum, entry) => ({ br: sum.br + entry.brBytes, gzip: sum.gzip + entry.gzipBytes, identity: sum.identity + entry.decodedBytes }), { br: 0, gzip: 0, identity: 0 });

export function proxy(request: NextRequest) {
  // Set cache policy here, not in destination headers: Next reapplies headers
  // after a rewrite, which would otherwise mark mutable source URLs immutable.
  if (['GET', 'HEAD'].includes(request.method) && immutablePaths.has(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    const mutable = request.nextUrl.searchParams.has('__md_revalidate');
    response.headers.set('Cache-Control', mutable ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable');
    if (mutable && request.nextUrl.pathname.endsWith('.webp')) response.headers.set('Vary', 'Accept, Accept-Encoding');
    return response;
  }
  const revision = raw[request.nextUrl.pathname];
  if (revision && ['GET', 'HEAD'].includes(request.method)) {
    const requested = request.nextUrl.searchParams.get('v');
    if (requested !== null && requested !== revision) {
      const current = request.nextUrl.clone();
      current.searchParams.set('v', revision);
      const response = NextResponse.redirect(current, 307);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const response = NextResponse.next();
    response.headers.set('Cache-Control', requested === revision ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    return response;
  }
  const texture = textures[request.nextUrl.pathname];
  if (texture && ['GET', 'HEAD'].includes(request.method)) {
    const webp = prefersWebP(request.headers.get('accept'));
    const target = new URL(texture.webp, request.url);
    target.searchParams.set('__md_revalidate', '1');
    const response = webp ? NextResponse.rewrite(target) : NextResponse.next();
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    response.headers.set('Vary', 'Accept, Accept-Encoding');
    response.headers.set('Content-Type', webp ? 'image/webp' : 'image/png');
    return response;
  }
  const entry = entries[request.nextUrl.pathname];
  if (!entry || !['GET', 'HEAD'].includes(request.method)) return NextResponse.next();
  const encoding = selectAssetEncoding(request.headers.get('accept-encoding'));
  if (!encoding) return new NextResponse(null, { status: 406, headers: { Vary: 'Accept-Encoding' } });
  const selected = encoding;
  const destination = selected === 'identity' ? entry.identity : entry[selected];
  const cacheControl = assetCacheControl(request.nextUrl.searchParams.get('v'), entry);
  const target = destination ? new URL(destination, request.url) : undefined;
  // A deployment may proxy the rewrite through another local origin (including
  // Next's localhost normalization). Carry the mutable source's cache decision
  // through that second request without trusting a client-supplied Host header.
  if (target && cacheControl.includes('must-revalidate')) target.searchParams.set('__md_revalidate', '1');
  const response = target ? NextResponse.rewrite(target) : NextResponse.next();
  response.headers.set('Vary', 'Accept-Encoding');
  response.headers.set('Content-Type', 'model/gltf-binary');
  response.headers.set('Cache-Control', cacheControl);
  response.headers.set('X-Asset-Decoded-Length', String(entry.decodedBytes));
  response.headers.set('X-Scene-Encoded-Length', String(totals[selected]));
  response.headers.set('X-Scene-Decoded-Length', String(totals.identity));
  if (selected !== 'identity') response.headers.set('Content-Encoding', selected);
  return response;
}

export const config = { matcher: ['/assets/:path*.glb', '/assets/:path*.png', '/assets/:path*.exr', '/assets/:path*.ktx2', '/asset-delivery/:path*'] };
