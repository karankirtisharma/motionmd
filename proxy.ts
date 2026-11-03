import { NextResponse, type NextRequest } from 'next/server';
import delivery from './src/generated/asset-delivery.json';
import manifest from './public/assets/scene-manifest.json';
import { selectAssetEncoding } from './src/server/assetEncoding';
import { assetCacheControl } from './src/server/assetRevision';

type DeliveryEntry = { br: string; gzip: string; identity?: string; decodedBytes: number; brBytes: number; gzipBytes: number };
const entries = delivery as Record<string, DeliveryEntry>;
const immutablePaths = new Set(Object.values(entries).flatMap(entry => [entry.br, entry.gzip, entry.identity].filter((path): path is string => !!path)));
const totals = manifest.chunks.map(chunk => entries[chunk.url]).filter(Boolean).reduce((sum, entry) => ({ br: sum.br + entry.brBytes, gzip: sum.gzip + entry.gzipBytes, identity: sum.identity + entry.decodedBytes }), { br: 0, gzip: 0, identity: 0 });

export function proxy(request: NextRequest) {
  // Set cache policy here, not in destination headers: Next reapplies headers
  // after a rewrite, which would otherwise mark mutable source URLs immutable.
  if (['GET', 'HEAD'].includes(request.method) && immutablePaths.has(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', request.nextUrl.searchParams.has('__md_revalidate') ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable');
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

export const config = { matcher: ['/assets/:path*.glb', '/asset-delivery/:path*'] };
