import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {mirrorCamera,createGalleryMirror} from '../src/runtime/rendering/galleryMirror.ts';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
async function load(url,noImages=false){
 let b=fs.readFileSync(new URL('../public'+url,import.meta.url));
 if(noImages){const n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));delete j.images;delete j.textures;delete j.samplers;j.materials=j.materials.map(m=>({name:m.name,doubleSided:true}));const raw=Buffer.from(JSON.stringify(j)),p=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(p);const h=Buffer.from(b.subarray(0,20));h.writeUInt32LE(20+p.length+b.length-20-n,8);h.writeUInt32LE(p.length,12);b=Buffer.concat([h,p,b.subarray(20+n)]);}
 const scene=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene;scene.updateMatrixWorld(true);return scene;
}
test('mirror clips behind the physical plane on both APIs, including reversed depth',()=>{
 for(const coordinateSystem of [T.WebGPUCoordinateSystem,T.WebGLCoordinateSystem])for(const reversed of [false,true]){
  const source=new T.PerspectiveCamera(50,1.6,.1,1800);source.coordinateSystem=coordinateSystem;source._reversedDepth=reversed;source.position.set(2,1,5);source.lookAt(0,0,0);source.updateProjectionMatrix();source.updateMatrixWorld();
  const cam=mirrorCamera(source,new T.PerspectiveCamera(),new T.Vector3(),new T.Vector3(0,0,1));
  assert.ok(cam.position.distanceTo(new T.Vector3(2,1,-5))<1e-10);
  const near=reversed?1:coordinateSystem===T.WebGLCoordinateSystem?-1:0;
  const plane=new T.Vector3().project(cam),front=new T.Vector3(0,0,2).project(cam),behind=new T.Vector3(0,0,-.2).project(cam);
  assert.ok(Math.abs(plane.z-near)<1e-9);assert.ok(front.z<1&&front.z>(coordinateSystem===T.WebGLCoordinateSystem&&!reversed?-1:0));
  assert.ok(reversed?behind.z>1:behind.z<near);assert.ok(cam.projectionMatrix.elements.every(Number.isFinite));
 }
});
test('exported mirror has one correctly oriented face and restores renderer state after a failed pass',async()=>{
 const root=await load('/assets/architecture-v21/mirror.glb');const scene=new T.Scene();scene.add(root);scene.updateMatrixWorld(true);
 const panes=[];root.traverse(o=>{if(o.userData.mdPlanarMirror)panes.push(o)});assert.equal(panes.length,1);
 const pane=panes[0],bounds=new T.Box3().setFromObject(pane),normal=new T.Vector3().fromBufferAttribute(pane.geometry.attributes.normal,0).transformDirection(pane.matrixWorld);
 assert.ok(normal.distanceTo(new T.Vector3(0,0,-1))<1e-6);assert.ok(Math.abs(bounds.min.z+9.45)<1e-5);
 const mirror=createGalleryMirror(root),view=new T.PerspectiveCamera(50,1.6,.1,100);view.position.set(5,5.8,-14);view.lookAt(bounds.getCenter(new T.Vector3()));view.updateMatrixWorld();
 const initialTarget={},initialMRT={};let target=initialTarget,mrt=initialMRT;
 const renderer={autoClear:false,getRenderTarget:()=>target,getMRT:()=>mrt,setRenderTarget:v=>target=v,setMRT:v=>mrt=v,getDrawingBufferSize:v=>v.set(1600,1000),render:()=>{assert.equal(pane.visible,false);throw Error('simulated render failure')}};
 assert.throws(()=>mirror.update(renderer,scene,view),/simulated/);assert.equal(pane.visible,true);assert.equal(target,initialTarget);assert.equal(mrt,initialMRT);assert.equal(renderer.autoClear,false);mirror.dispose();
});
test('removed panel and head are absent in the shipped geometry; mirror is solid and opening is traversable',async()=>{
 const founder=await load(manifest.chunks.find(c=>c.id==='founder').url,true),ray=new T.Raycaster();let rays=0;
 for(const x of [6.5,6.9,7.4,7.72])for(const y of [4.6,5.8,6.9]){ray.set(new T.Vector3(x,y,-9.8),new T.Vector3(0,0,1));ray.far=.8;assert.equal(ray.intersectObject(founder).length,0,`old panel remains ${x},${y}`);rays++;}
 for(const x of [8,9,10.8]){ray.set(new T.Vector3(x,7.22,-9.8),new T.Vector3(0,0,1));ray.far=.8;assert.equal(ray.intersectObject(founder).length,0,`old head remains ${x}`);rays++;}
 const collisions=new T.Group();for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])collisions.add(await load(url));
 const physics=await createCollisionWorld(collisions,undefined,collisions);
 try{
  assert.equal(physics.canStandAt(new T.Vector3(5,4.23,-9.4)),false,'mirror must block the body');
  for(const speed of [1.38,3.35])for(const sign of [-1,1]){const feet=new T.Vector3(6.95,4.231,sign===1?-10.2:-8.5);physics.place(feet);for(let i=0;i<Math.ceil(1.7/speed*60);i++)physics.move(new T.Vector3(0,-.5/60,sign*speed/60),1/60,feet);assert.ok(sign===1?feet.z>-8.65:feet.z<-10.05,`new opening blocks ${feet.toArray()}`);}
 }finally{physics.dispose();}
 assert.equal(rays,15);
});

test('founder side covers the dark backing with a correctly facing live mirror and shares one render pass',async()=>{
 const root=await load('/assets/architecture-v21/mirror.glb'),scene=new T.Scene();scene.add(root);
 const originalCount=root.children.length,mirror=createGalleryMirror(root);scene.updateMatrixWorld(true);
 const panes=[];root.traverse(o=>{if(o.userData.mdPlanarMirror)panes.push(o)});assert.equal(panes.length,2);
 const rear=panes.find(o=>o.userData.mirrorSide==='founder'),bounds=new T.Box3().setFromObject(rear);
 assert.ok(Math.abs(bounds.min.z+9.25)<1e-5);
 assert.ok(new T.Vector3().fromBufferAttribute(rear.geometry.attributes.normal,0).transformDirection(rear.matrixWorld).distanceTo(new T.Vector3(0,0,1))<1e-6);
 const ray=new T.Raycaster();
 for(const x of [3.8,5,6.2])for(const y of [4.3,5.75,7.2]){
  ray.set(new T.Vector3(x,y,-7),new T.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(root)[0]?.object,rear,`bronze backing exposed at ${x},${y}`);
 }
 let calls=0,reflectionTarget,reflectedPosition;
 const renderer={autoClear:false,getRenderTarget:()=>null,getMRT:()=>null,setRenderTarget:v=>{if(v){if(reflectionTarget)assert.equal(v,reflectionTarget);reflectionTarget=v;}},setMRT:()=>{},getDrawingBufferSize:v=>v.set(1600,1000),render:(_,camera)=>{calls++;assert.ok(panes.every(p=>!p.visible));reflectedPosition=camera.position.clone();}};
 for(const z of [-5.3,-13.5]){
  const view=new T.PerspectiveCamera(48,1.6,.1,100);view.position.set(5,5.8,z);view.lookAt(5,5.75,-9.35);view.updateMatrixWorld();
  const before=calls;mirror.update(renderer,scene,view);assert.equal(calls,before+1);assert.ok(panes.every(p=>p.visible));
  assert.ok(Math.abs(reflectedPosition.z-(2*(z>-9.35?-9.25:-9.45)-z))<1e-5);
 }
 mirror.dispose();assert.equal(root.children.length,originalCount);
});
