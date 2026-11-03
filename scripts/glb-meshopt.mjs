import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGLB } from './glb-storage.mjs';
import { writeGLB } from './glb-images.mjs';

const EXT = 'EXT_meshopt_compression', KHR = 'KHR_meshopt_compression';
const compression = view => view.extensions?.[EXT] ?? view.extensions?.[KHR];
function semanticMetadata(json) {
  const copy = structuredClone(json);
  for (const field of ['extensionsUsed', 'extensionsRequired']) if (copy[field]) copy[field] = [...new Set(copy[field].map(name => name === EXT ? KHR : name))];
  for (const item of [...(copy.bufferViews ?? []), ...(copy.buffers ?? [])]) {
    if (item.extensions?.[EXT]) { item.extensions[KHR] = item.extensions[EXT]; delete item.extensions[EXT]; }
  }
  for (const view of copy.bufferViews ?? []) {
    const encoded = compression(view);
    if (encoded) { delete encoded.byteOffset; delete encoded.byteLength; }
  }
  copy.buffers[0].byteLength = 0;
  return copy;
}

/** Repack existing Meshopt attribute streams only. No welding, quantization,
 * triangle/vertex reordering, filter reapplication, or animation resampling.
 * Decode the pre-filter storage and prove identical bytes with the shipped
 * browser decoder before accepting the v1 stream. KHR also permits retained v0
 * streams, so index topology and any unprofitable streams remain verbatim. */
export async function optimizeMeshoptStreams(source) {
  const before = readGLB(source), json = structuredClone(before.json);
  if (!json.bufferViews?.some(view => compression(view))) return { buffer: source, streams: [] };
  if (json.buffers[0].uri) throw Error('Meshopt delivery requires an embedded GLB buffer');
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const parts = [before.binary], streams = []; let length = before.binary.length;
  for (const [index, view] of json.bufferViews.entries()) {
    const encoded = compression(view);
    if (!encoded || encoded.buffer !== 0 || encoded.mode !== 'ATTRIBUTES' || encoded.byteLength < 256) continue;
    const start = encoded.byteOffset ?? 0, end = start + encoded.byteLength;
    assert.ok(Number.isSafeInteger(start) && start >= 0 && end <= before.binary.length, 'Invalid compressed buffer range');
    assert.equal(view.byteLength, encoded.count * encoded.byteStride, 'Unexpected decoded view length');
    const original = before.binary.subarray(start, end), raw = new Uint8Array(view.byteLength);
    // Deliberately omit filter: re-encode the same filtered integer representation.
    MeshoptDecoder.decodeGltfBuffer(raw, encoded.count, encoded.byteStride, original, encoded.mode);
    const candidate = MeshoptEncoder.encodeVertexBufferLevel(raw, encoded.count, encoded.byteStride, 3, 1);
    if (candidate.byteLength >= original.byteLength) continue;
    const decoded = new Uint8Array(raw.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, encoded.count, encoded.byteStride, candidate, encoded.mode);
    assert.ok(Buffer.from(raw).equals(Buffer.from(decoded)), `Meshopt raw-byte parity failed at view ${index}`);
    if (encoded.filter && encoded.filter !== 'NONE') {
      MeshoptDecoder.decodeGltfBuffer(raw, encoded.count, encoded.byteStride, original, encoded.mode, encoded.filter);
      MeshoptDecoder.decodeGltfBuffer(decoded, encoded.count, encoded.byteStride, candidate, encoded.mode, encoded.filter);
      assert.ok(Buffer.from(raw).equals(Buffer.from(decoded)), `Meshopt filtered-byte parity failed at view ${index}`);
    }
    const padding = (4 - length % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); length += padding; }
    encoded.byteOffset = length; encoded.byteLength = candidate.byteLength;
    parts.push(Buffer.from(candidate)); length += candidate.byteLength;
    streams.push({ index, before: original.byteLength, after: candidate.byteLength, decodedBytes: raw.length, byteExact: true });
  }
  if (!streams.length) return { buffer: source, streams };
  // The v1 bitstream belongs to KHR, never label it as EXT. Upgrade placeholder
  // buffer tags too; a fallback buffer may not carry both extension variants.
  for (const item of [...json.bufferViews, ...json.buffers]) {
    if (item.extensions?.[EXT]) { item.extensions[KHR] = item.extensions[EXT]; delete item.extensions[EXT]; }
  }
  for (const field of ['extensionsUsed', 'extensionsRequired']) if (json[field]) json[field] = [...new Set(json[field].map(name => name === EXT ? KHR : name))];
  json.buffers[0].byteLength = length;
  assert.deepEqual(semanticMetadata(json), semanticMetadata(before.json), 'Meshopt repack changed scene/accessor/material/animation metadata');
  return { buffer: writeGLB(json, Buffer.concat(parts)), streams };
}
