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

test('both transmission passes are prepared before the final full render', async () => {
 const scene=new Scene(), meshes=Array.from({length:5},()=>new Mesh(new BoxGeometry(),new MeshBasicMaterial()));
 scene.add(...meshes);let filter=null,frames=0,submitted=[];
 const renderer={getRenderObjectFunction:()=>filter,setRenderObjectFunction:value=>filter=value,
   renderObject:(...args)=>submitted.push([args[0],args[8]??null])};
 await prepareRenderSlices(renderer,scene,async()=>{
   frames++;const start=submitted.length;
   for(const pass of ['backSide',null])for(const m of meshes)filter(m,scene,null,m.geometry,m.material,null,null,null,pass);
   assert.ok(submitted.length-start<=4);
 });
 assert.equal(frames,3);assert.equal(submitted.length,10);
 for(const m of meshes)assert.deepEqual(submitted.filter(([object])=>object===m).map(([,pass])=>pass),['backSide',null]);
 assert.equal(filter,null);
});

test('nested render contexts and lighting variants are all prepared before the final draw', async () => {
 const scene = new Scene(), meshes = Array.from({length: 7}, () => new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
 scene.add(...meshes);
 const contexts = [{}, {}], lights = [{}, {}], prepared = new Map();
 let filter = null, frames = 0, submitted = 0;
 const renderer = {getRenderObjectFunction: () => filter, setRenderObjectFunction: value => {filter=value;},
   renderObject: (object, scene, camera, geometry, material, group, light, context) => {
     submitted++; const key = contexts.indexOf(context) + ':' + lights.indexOf(light);
     if (!prepared.has(key)) prepared.set(key, new Set()); prepared.get(key).add(object);
   }};
 await prepareRenderSlices(renderer, scene, async submit => {
   assert.equal(submit, filter); frames++; const before = submitted;
   for(const context of contexts) for(const light of lights) for(const mesh of meshes)
     submit(mesh,scene,null,mesh.geometry,mesh.material,null,light,context);
   assert.ok(submitted-before<=4);
 });
 assert.equal(frames,7); assert.equal(submitted,28); assert.equal(prepared.size,4);
 assert.ok([...prepared.values()].every(objects=>objects.size===7)); assert.equal(filter,null);
});
