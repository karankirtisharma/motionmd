// Removes accessors no mesh, skin, animation or instancing extension references, and the
// buffer views only they used, from scene chunk GLBs. Every kept byte is copied unchanged
// (meshopt streams are not re-encoded), so decoded geometry is bit-identical; the manifest
// entry's bytes and sha256 are updated to match.
//   node scripts/prune-glb.mjs [chunk-id ...]   (default: every manifest chunk)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'public', 'assets', 'scene-manifest.json');
let manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const only = new Set(process.argv.slice(2));
const pad4 = (n) => (n + 3) & ~3;

function readGLB(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const bin = binHeader < bytes.length ? bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader)) : null;
  return { json, bin };
}

function writeGLB(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (length, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]);
}

function prune(json, bin) {
  // Accessors in use.
  const used = new Set();
  const mark = (index) => { if (index !== undefined) used.add(index); };
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    Object.values(primitive.attributes).forEach(mark); mark(primitive.indices);
    for (const target of primitive.targets ?? []) Object.values(target).forEach(mark);
  }
  for (const skin of json.skins ?? []) mark(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { mark(sampler.input); mark(sampler.output); }
  for (const node of json.nodes ?? []) Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {}).forEach(mark);
  const accessors = json.accessors ?? [];
  if (used.size === accessors.length) return null;
  const accessorMap = new Map();
  const keptAccessors = accessors.filter((_, i) => used.has(i) && accessorMap.set(i, accessorMap.size));
  const remap = (index) => (index === undefined ? undefined : accessorMap.get(index));
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(primitive.attributes[key]);
    if (primitive.indices !== undefined) primitive.indices = remap(primitive.indices);
    for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = remap(target[key]);
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { sampler.input = remap(sampler.input); sampler.output = remap(sampler.output); }
  for (const node of json.nodes ?? []) { const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes; if (attributes) for (const key of Object.keys(attributes)) attributes[key] = remap(attributes[key]); }
  json.accessors = keptAccessors;

  // Buffer views still referenced by an accessor (including sparse) or an image.
  const views = new Set();
  for (const accessor of keptAccessors) {
    if (accessor.bufferView !== undefined) views.add(accessor.bufferView);
    if (accessor.sparse) { views.add(accessor.sparse.indices.bufferView); views.add(accessor.sparse.values.bufferView); }
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) views.add(image.bufferView);
  const viewMap = new Map();
  const keptViews = json.bufferViews.filter((_, i) => views.has(i) && viewMap.set(i, viewMap.size));
  for (const accessor of keptAccessors) {
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap.get(accessor.bufferView);
    if (accessor.sparse) { accessor.sparse.indices.bufferView = viewMap.get(accessor.sparse.indices.bufferView); accessor.sparse.values.bufferView = viewMap.get(accessor.sparse.values.bufferView); }
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = viewMap.get(image.bufferView);
  json.bufferViews = keptViews;

  // Compact the GLB binary buffer (index 0): copy each kept byte range, 4-byte aligned.
  // Meshopt views live in the fallback buffer and point at their stream through the extension.
  const parts = []; let offset = 0;
  const relocate = (holder) => {
    if (holder.buffer !== 0) return;
    const start = holder.byteOffset ?? 0, aligned = pad4(offset);
    if (aligned > offset) parts.push(Buffer.alloc(aligned - offset));
    parts.push(bin.subarray(start, start + holder.byteLength));
    holder.byteOffset = aligned; offset = aligned + holder.byteLength;
  };
  for (const view of keptViews) {
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt) relocate(meshopt);
    relocate(view);
  }
  json.buffers[0].byteLength = offset;
  // The fallback buffer is never stored; size it to the views that remain.
  json.buffers.forEach((buffer, index) => {
    if (index === 0 || !buffer.extensions?.EXT_meshopt_compression?.fallback) return;
    buffer.byteLength = Math.max(0, ...keptViews.filter(view => view.buffer === index).map(view => (view.byteOffset ?? 0) + view.byteLength));
  });
  return { bin: Buffer.concat(parts), removedAccessors: accessors.length - keptAccessors.length };
}

let changed = false;
for (const chunk of manifest.chunks) {
  if (only.size && !only.has(chunk.id)) continue;
  const file = path.join(root, 'public', '.' + chunk.url);
  if (!fs.existsSync(file)) continue;
  const { json, bin } = readGLB(file);
  if (!bin || json.buffers?.[0]?.uri !== undefined) continue;
  const result = prune(json, bin);
  if (!result) continue;
  const output = writeGLB(json, result.bin);
  const before = fs.statSync(file).size;
  fs.writeFileSync(file, output);
  // Edit this chunk's entry in place; the manifest is hand-formatted.
  const start = manifestText.indexOf(`"url": "${chunk.url}"`), end = manifestText.indexOf('"id":', start);
  let entry = manifestText.slice(start, end < 0 ? undefined : end);
  entry = entry.replace(`"bytes": ${chunk.bytes}`, `"bytes": ${output.length}`);
  if (chunk.sha256) entry = entry.replace(`"sha256": "${chunk.sha256}"`, `"sha256": "${crypto.createHash('sha256').update(output).digest('hex')}"`);
  manifestText = manifestText.slice(0, start) + entry + (end < 0 ? '' : manifestText.slice(end));
  changed = true;
  console.log(`${chunk.id}: removed ${result.removedAccessors} unused accessors, ${(before / 1e6).toFixed(1)} -> ${(output.length / 1e6).toFixed(1)} MB`);
}
if (changed) fs.writeFileSync(manifestPath, manifestText);
