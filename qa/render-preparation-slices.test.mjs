import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Mesh, Group, BoxGeometry, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { prepareRenderSlices } from '../src/runtime/rendering/prepareRenderSlices.ts';
import { createScreenAperture } from '../src/runtime/presentation/screenTexture.ts';
import { Texture } from 'three';

for (const outcome of ['complete', 'cancel', 'failed']) test(`preparation restores render dispatch after ${outcome} without changing visibility`, async () => {
 const scene=new Scene(), signal=new AbortController();
 const meshes=Array.from({length:11},()=>{const m=new Mesh(new BoxGeometry(),new MeshBasicMaterial());scene.add(m);return m});
 const hidden=new Group();hidden.visible=false;scene.add(hidden);
 const quad=new Mesh();let frames=0,seen=new Set(),forwarded=0,filter;
 const original=(object)=>{if(object===quad)forwarded++;else seen.add(object)};
 filter=original;
 const renderer={getRenderObjectFunction:()=>filter,setRenderObjectFunction:value=>filter=value,renderObject:original};
 const pending=prepareRenderSlices(renderer,scene,async()=>{
   frames++;const before=seen.size;filter(quad,null,null,null,quad.material);
   for(const m of meshes)filter(m,null,null,null,m.material);
   assert.ok(seen.size-before<=4);assert.ok(meshes.every(m=>m.visible));assert.equal(hidden.visible,false);
   if(outcome==='cancel')signal.abort();if(outcome==='failed')throw Error('draw failed');
 },signal.signal);
 if(outcome==='complete'){await pending;assert.equal(seen.size,11);assert.equal(frames,3);assert.equal(forwarded,3)}else await assert.rejects(pending);
 assert.equal(filter,original);assert.ok(meshes.every(m=>m.visible));assert.equal(hidden.visible,false);
});

test('app snapshot stays opaque through loading, hidden state and reflections; ownership stays with caller',()=>{
 const preview=new Texture(),main=new PerspectiveCamera(),reflection=new PerspectiveCamera();
 const m=new Mesh(new BoxGeometry(),new MeshBasicMaterial());const aperture=createScreenAperture(m,main,preview);
 let disposals=0;preview.addEventListener('dispose',()=>disposals++);
 for(const live of [false,true,false])for(const camera of [main,reflection]){
 aperture.setLive(live);m.onBeforeRender(null,null,camera,m.geometry,m.material,null);
 assert.equal(m.material.map,preview);assert.equal(m.material.opacity,live&&camera===main?0:1);
 }
 aperture.dispose();assert.equal(disposals,0);preview.dispose();assert.equal(disposals,1);
});
