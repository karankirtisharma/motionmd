import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactGLB, readGLB } from '../scripts/glb-storage.mjs';

test('exact storage compaction preserves all shipped metadata and referenced bytes',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
  let before=0,after=0,ranges=0;
  for(const chunk of manifest.chunks){
    const source=fs.readFileSync(new URL('../public'+chunk.url,import.meta.url));
    const compact=compactGLB(source);before+=source.length;after+=compact.buffer.length;ranges+=compact.verifiedRanges;
    assert.ok(compact.buffer.length<=source.length);
    // compactGLB asserts every referenced byte AND the entire non-offset JSON graph.
    const a=readGLB(source).json,b=readGLB(compact.buffer).json;
    assert.deepEqual(a.meshes,b.meshes);assert.deepEqual(a.nodes,b.nodes);
    assert.deepEqual(a.animations,b.animations);assert.deepEqual(a.accessors,b.accessors);
  }
  assert.ok(before-after>4_000_000);
  assert.ok(ranges>1500);
  console.log({sourceBytes:before,deliveryBytes:after,savedBytes:before-after,verifiedRanges:ranges});
});
