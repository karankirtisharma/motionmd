import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const pub = new URL('../../public/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../../../architecture-v16/candidate-manifest.json', import.meta.url)));
const urls = new Set();
function collect(value) {
  if (typeof value === 'string' && value.startsWith('/assets/')) urls.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(manifest);
const chunks = [];
for (const chunk of manifest.chunks) {
  const data = fs.readFileSync(new URL('.' + chunk.url, pub));
  assert.equal(data.readUInt32LE(0), 0x46546c67);
  assert.equal(data.readUInt32LE(8), data.length, 'GLB byte length: ' + chunk.id);
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)));
  if (chunk.sha256) assert.equal(createHash('sha256').update(data).digest('hex'), chunk.sha256, 'Chunk hash: ' + chunk.id);
  assert.equal(data.length, chunk.bytes, 'Manifest length: ' + chunk.id);
  for (const image of gltf.images ?? []) if (image.uri && !image.uri.startsWith('data:')) {
    urls.add(image.uri.startsWith('/') ? image.uri : path.posix.join(path.posix.dirname(chunk.url), image.uri));
  }
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) === 4) triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  chunks.push({ id: chunk.id, triangles, bytes: data.length });
}
let bytes = 0;
for (const url of urls) {
  assert.ok(url.startsWith('/assets/') && !url.includes('..'), url);
  const file = new URL('.' + url, pub);
  assert.ok(fs.existsSync(file), 'Missing dependency: ' + url);
  const stat = fs.statSync(file); assert.ok(stat.size > 0, 'Empty dependency: ' + url); bytes += stat.size;
}
assert.ok(![...urls].some(url => url.includes('/client-v13/')), 'Rejected model is still active');
assert.equal(manifest.chairs.length, 4, 'Keep the four approved presentation-room interactions');
const result = { files: urls.size, bytes, chunks, totalTriangles: chunks.reduce((sum, c) => sum + c.triangles, 0), rejectedAssetsReferenced: false };
fs.writeFileSync(new URL('asset-audit.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
