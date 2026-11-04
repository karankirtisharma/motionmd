import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { readGLB } from '../scripts/glb-storage.mjs';
import { writeGLB } from '../scripts/glb-images.mjs';
import { pruneUnusedGeometry } from '../scripts/glb-live-accessors.mjs';

// Independent semantic snapshot: follow the mesh's actual references and
// compare the addressed attribute/index/image payload, not its array position.
function renderGraph(buffer) {
  const { json, binary } = readGLB(buffer), fingerprints = new Map();
  function view(i) {
    if (fingerprints.has(i)) return fingerprints.get(i);
    const v=json.bufferViews[i], encoded=v.extensions?.EXT_meshopt_compression ?? v.extensions?.KHR_meshopt_compression;
    const ref=encoded??v;
    assert.equal(ref.buffer,0);
    const start=ref.byteOffset??0;
    const digest=createHash('sha256').update(binary.subarray(start,start+ref.byteLength)).digest('hex');
    const details={...v}, stream=encoded?{...encoded}:undefined;
    delete details.byteOffset;
    if(stream) {delete stream.byteOffset;details.extensions={meshopt:stream};}
    const value={details,digest};fingerprints.set(i,value);return value;
  }
  function accessor(i) {
    const a=structuredClone(json.accessors[i]);
    for (const ref of [a,a.sparse?.indices,a.sparse?.values]) if(ref?.bufferView!==undefined) ref.bufferView=view(ref.bufferView);
    return a;
  }
  for (const mesh of json.meshes??[]) for (const p of mesh.primitives){
    if(p.indices!==undefined)p.indices=accessor(p.indices);
    for(const attrs of [p.attributes,...(p.targets??[])])for(const key of Object.keys(attrs))attrs[key]=accessor(attrs[key]);
  }
  for(const image of json.images??[])if(image.bufferView!==undefined)image.bufferView=view(image.bufferView);
  delete json.accessors;delete json.bufferViews;
  json.buffers[0].byteLength=0;
  return json;
}

test('Studio and founder keyboard/foliage deliveries retain exact referenced attributes, triangle sequences, images and complete scene graph',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
  for(const id of ['studio','founder','lounge','entrance','shell','gallery','v13','v18']){
    const url=manifest.chunks.find(c=>c.id===id).url, original=fs.readFileSync(new URL('../public'+url,import.meta.url));
    const trimmed=pruneUnusedGeometry(original);
    assert.ok(trimmed.removedViews>0,id);
    assert.deepEqual(renderGraph(original),renderGraph(trimmed.buffer),id);
    assert.equal(pruneUnusedGeometry(trimmed.buffer).removedViews,0,id+' must be idempotent');
  }
});

test('a sparse morph target and annotated library data survive pruning; unknown extensions and skinned assets opt out',()=>{
  const json={asset:{version:'2.0'},buffers:[{byteLength:64}],bufferViews:[0,1,2,3,4].map(i=>({buffer:0,byteOffset:i*12,byteLength:12})),
    accessors:[{bufferView:0,componentType:5126,count:1,type:'VEC3'},{bufferView:1,componentType:5126,count:1,type:'VEC3'},
      {componentType:5126,count:1,type:'VEC3',sparse:{count:1,indices:{componentType:5121,bufferView:2},values:{bufferView:3}}},
      {name:'editor field',bufferView:4,componentType:5126,count:1,type:'VEC3'}],
    meshes:[{primitives:[{attributes:{POSITION:1},targets:[{POSITION:2}]}]}]};
  const input=writeGLB(json,Buffer.alloc(64)), trimmed=pruneUnusedGeometry(input), packed=readGLB(trimmed.buffer).json;
  assert.equal(trimmed.removedAccessors,1);assert.equal(trimmed.removedViews,1);
  assert.deepEqual(renderGraph(trimmed.buffer),renderGraph(input));
  assert.equal(packed.accessors.at(-1).name,'editor field');
  for(const patch of [{extensionsUsed:['EXT_unhandled_accessor_index']},{skins:[{joints:[0]}]},{animations:[{}]}]){
    const unsupported=writeGLB({...json,...patch},Buffer.alloc(64));
    assert.equal(pruneUnusedGeometry(unsupported).buffer,unsupported);
  }
});
