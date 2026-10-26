import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function readGLB(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw Error('Invalid GLB');
  const jsonLength = buffer.readUInt32LE(12), binaryStart = 28 + jsonLength;
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || buffer.readUInt32LE(24 + jsonLength) !== 0x004e4942 || binaryStart + buffer.readUInt32LE(20 + jsonLength) !== buffer.length) throw Error('Only standard JSON + BIN GLBs are supported');
  return { json: JSON.parse(buffer.subarray(20,20 + jsonLength).toString()), binary: buffer.subarray(binaryStart) };
}
function references(json) {
  const result = [];
  for (const view of json.bufferViews ?? []) {
    if (view.buffer === 0) result.push(view);
    const encoded = view.extensions?.EXT_meshopt_compression;
    if (encoded?.buffer === 0) result.push(encoded);
  }
  return result;
}
function range(binary, ref) {
  const start = ref.byteOffset ?? 0, end = start + ref.byteLength;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > binary.length) throw Error('Invalid binary reference');
  return binary.subarray(start,end);
}
function metadata(json) {
  const copy = structuredClone(json);
  for (const ref of references(copy)) delete ref.byteOffset;
  copy.buffers[0].byteLength = 0;
  return copy;
}
/** Storage-only compaction. Never decode/re-encode, quantize, weld or reorder geometry. */
export function compactGLB(source) {
  const before = readGLB(source), json = structuredClone(before.json);
  if (json.buffers[0].uri) throw Error('Embedded buffer required');
  const chunks = [], locations = new Map(); let length = 0, reused = 0;
  for (const ref of references(json)) {
    const data = range(before.binary, ref);
    const key = createHash('sha256').update(data).digest('hex');
    let location = locations.get(key);
    // Hash is an index; byte equality is still checked before reusing storage.
    if (location && location.data.equals(data)) reused += data.length;
    else {
      const padding = (4 - length % 4) % 4;
      if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
      location = { offset: length, data }; locations.set(key,location);
      chunks.push(data); length += data.length;
    }
    ref.byteOffset = location.offset;
  }
  json.buffers[0].byteLength = length;
  const binary = Buffer.concat([...chunks,Buffer.alloc((4 - length % 4) % 4)]);
  const rawJSON = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.concat([rawJSON,Buffer.alloc((4 - rawJSON.length % 4) % 4,0x20)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28 + jsonBytes.length + binary.length,8);
  header.writeUInt32LE(jsonBytes.length,12);header.writeUInt32LE(0x4e4f534a,16);
  binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  const output = Buffer.concat([header,jsonBytes,binHeader,binary]);
  const after = readGLB(output);
  assert.deepEqual(metadata(before.json),metadata(after.json),'Scene graph/material/accessor/animation metadata changed');
  const oldRefs = references(before.json), newRefs = references(after.json);
  assert.equal(oldRefs.length,newRefs.length);
  for (let i=0;i<oldRefs.length;i++) assert.ok(range(before.binary,oldRefs[i]).equals(range(after.binary,newRefs[i])),'Referenced binary data changed at view '+i);
  return { buffer: output.length < source.length ? output : source, reusedBytes: reused, verifiedRanges: oldRefs.length };
}
