import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readGLB } from '../scripts/glb-storage.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const rooms=read('src/generated/room-stream.json');
const originals=read('src/generated/asset-delivery.json');
const manifest=read('public/assets/scene-manifest.json');
const digest=b=>createHash('sha256').update(b).digest('hex');
function load(packet) {
  const bytes=brotliDecompressSync(fs.readFileSync('public'+packet.url));
  assert.equal(bytes.length,packet.bytes);
  assert.ok(packet.url.includes(digest(bytes)));
  return readGLB(bytes);
}
function signature(file,index) {
  const {bufferView,...accessor}=file.json.accessors[index];
  const view=file.json.bufferViews[bufferView];
  const encoded=view.extensions?.EXT_meshopt_compression??view.extensions?.KHR_meshopt_compression??view;
  const {byteOffset=0,buffer,...layout}=encoded;
  return {accessor,layout,stride:view.byteStride,bytes:digest(file.binary.subarray(byteOffset,byteOffset+encoded.byteLength))};
}
for(const id of ['founder','studio']) test(id+' retains every triangle and vertex attribute across entrance and detail packets',()=>{
  const original=readGLB(fs.readFileSync('public'+originals[manifest.chunks.find(c=>c.id===id).url].identity));
  const group=rooms[id],base=load(group.base), slots=new Map();
  for(const packet of group.details){
    const detail=load(packet);
    for(const p of detail.json.meshes[0].primitives){
      assert.ok(!slots.has(p.extras.mdRoomSlot));slots.set(p.extras.mdRoomSlot,[detail,p]);
    }
  }
  const source=original.json.meshes[0].primitives;
  assert.equal(base.json.meshes[0].primitives.length,source.length);
  for(const [i,old] of source.entries()){
    const core=base.json.meshes[0].primitives[i];
    assert.equal(core.material,old.material);
    const [file,p]=slots.get(i)??[base,core];
    assert.equal(slots.has(i),core.extras?.mdRoomSlot===i);
    assert.deepEqual(signature(file,p.indices),signature(original,old.indices));
    assert.deepEqual(Object.keys(p.attributes),Object.keys(old.attributes));
    for(const key of Object.keys(p.attributes)) assert.deepEqual(signature(file,p.attributes[key]),signature(original,old.attributes[key]));
  }
});