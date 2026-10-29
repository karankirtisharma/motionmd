import { NextResponse, type NextRequest } from 'next/server';
import delivery from './src/generated/asset-delivery.json';
import manifest from './public/assets/scene-manifest.json';
import { selectAssetEncoding } from './src/server/assetEncoding';

type DeliveryEntry = { br: string; gzip: string; identity?: string; decodedBytes: number; brBytes: number; gzipBytes: number };
const entries = delivery as Record<string, DeliveryEntry>;
const totals = manifest.chunks.map(chunk => entries[chunk.url]).filter(Boolean).reduce((sum, entry) => ({ br: sum.br + entry.brBytes, gzip: sum.gzip + entry.gzipBytes, identity: sum.identity + entry.decodedBytes }), { br: 0, gzip: 0, identity: 0 });

export function proxy(request: NextRequest) {
  const entry = entries[request.nextUrl.pathname];
  if (!entry || !['GET', 'HEAD'].includes(request.method)) return NextResponse.next();
  const encoding = selectAssetEncoding(request.headers.get('accept-encoding'));
  if (!encoding) return new NextResponse(null, { status: 406, headers: { Vary: 'Accept-Encoding' } });
  const selected = encoding;
  const destination = selected === 'identity' ? entry.identity : entry[selected];
  const response = destination ? NextResponse.rewrite(new URL(destination, request.url)) : NextResponse.next();
  response.headers.set('Vary', 'Accept-Encoding');
  response.headers.set('Content-Type', 'model/gltf-binary');
  response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  response.headers.set('X-Asset-Decoded-Length', String(entry.decodedBytes));
  response.headers.set('X-Scene-Encoded-Length', String(totals[selected]));
  response.headers.set('X-Scene-Decoded-Length', String(totals.identity));
  if (selected !== 'identity') response.headers.set('Content-Encoding', selected);
  return response;
}

export const config = { matcher: '/assets/:path*.glb' };
