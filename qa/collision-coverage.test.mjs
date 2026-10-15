import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const m=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
async function fixture(){const r=new T.Group();for(const u of [m.collisions.url,...m.collisions.additionalUrls]){const b=fs.readFileSync(new URL('../public'+u,import.meta.url));r.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene)}return createCollisionWorld(r,undefined,r)}
test('previously omitted glass guards, cabinet and club seats block the complete body',async()=>{
 const p=await fixture();try{
  for(const [name,x,y,z]of [['curved slab guard',5.530527499999999,4.233,-12.688128749999999],['gallery guard',12,3.7,-24.9],['cabinet',16,4.25,-10.2],['founder club seat',10.7,4.25,-6.45]])assert.equal(p.canStandAt(new T.Vector3(x,y,z)),false,name);
  for(const speed of [1.38,3.35])for(const [name,start,dir,axis,bound,sign]of [
   ['curved slab',[4.795448899574505,4.233,-13.003817601872372],[0.9188482505318669,0.39461106484046743],'x',5.530527499999999,1],['gallery',[12,3.675,-24.05],[0,-1],'z',-24.64,-1],['cabinet',[16,4.23,-8.7],[0,-1],'z',-9.62,-1],['club seat',[10.7,4.23,-7.7],[0,1],'z',-7.2,1]
  ]){const feet=new T.Vector3(...start);p.place(feet);for(let i=0;i<300;i++){p.move(new T.Vector3(dir[0]*speed/60,-.5/60,dir[1]*speed/60),1/60,feet);assert.ok(p.canStandAt(feet),name+' body must stay outside solid geometry');}assert.ok(name==='club seat'||(name==='curved slab' ? 0.9188482505318669*(feet.x-5.530527499999999)+0.39461106484046743*(feet.z+12.688128749999999)<-.19 : sign*feet[axis]<sign*bound),`${name} at ${speed}: ${feet.toArray()}`);assert.ok(Math.abs(feet.y-start[1])<.045,`${name} must not climb or fall`);}
 }finally{p.dispose()}
});
test('approved perimeter gallery connects the existing entrance bridge to the helical landing in both directions',async()=>{
 const p=await fixture();try{
 const route=[[-1.2,4.233,-12],[-1.2,4.233,-19.14]];
 for(let i=1;i<=48;i++){const a=Math.PI-Math.PI/2*i/48;route.push([3.6+4.75*Math.cos(a),4.233,-(19.14+4.75*Math.sin(a))]);}
 route.push([5.5,4.23,-24.1],[7.3,3.675,-24.1],[16,3.675,-24.1],[18.6,3.67,-24.1],[18.6,3.67,-23.2],[18.6,3.67,-21.9]);
 for(const speed of [1.38,3.35])for(const direction of [1,-1]){
  const points=direction>0?route:[...route].reverse(),feet=new T.Vector3(...points[0]);feet.y=p.groundAt(feet);p.place(feet);let g=true,v=0;
  for(const b of points.slice(1)){
   for(let n=0;n<1800;n++){const d=new T.Vector3(b[0]-feet.x,0,b[2]-feet.z);if(d.length()<.045)break;d.clampLength(0,speed/60);v=g?-.5:Math.max(-16,v-9.81/60);d.y=v/60;g=p.move(d,1/60,feet)}
   assert.ok(Math.hypot(feet.x-b[0],feet.z-b[2])<.1,`route at ${speed}: ${feet.toArray()} -> ${b}`);
   assert.ok(Math.abs(feet.y-b[1])<.2,'route must stay on its intended level');
  }
 }
 }finally{p.dispose()}
});
test('the rejected central shortcut is absent and both entrances have solid glass guards',async()=>{
 const p=await fixture();try{
  for(const point of [[10.95,3.675,-23.0],[9.4,4.23,-10.985]])assert.equal(p.canStandAt(new T.Vector3(...point)),false,'restored guard blocks the former entrance');
  assert.ok(p.groundAt(new T.Vector3(11,4.1,-17))<1,'no invisible central walkway remains above the atrium');
  assert.ok(![...p.colliderNames.values()].some(n=>n.includes('atrium bridge')),'retired bridge must have no collision geometry');
 }finally{p.dispose()}
});
test('full width slab supports the diagonal shortcut and extended steps at walk and sprint speeds',async()=>{
 const p=await fixture();try{
  const height=(x,y)=>{const t=Math.max(0,Math.min(1,(y-11.01)/6.99));const u=x-(-7.28125+Math.sqrt(14.28125**2-(y-19.65)**2)+1.8*(1-t*t*(3-2*t)));return u<0?4.233:u<.3?4.2:u<.6?4.025:u<.9?3.85:3.675};
  const diagonal=Array.from({length:41},(_,i)=>{const t=i/40,x=-1.1+8.6*t;return [x,height(x,11.5+11.3*t),-(11.5+11.3*t)]});
  const routes=[diagonal,...[21.6,22.3,23.3,24.1].map(y=>[[5.5,4.233,-y],[8,3.675,-y]])];
  for(const speed of [1.38,3.35])for(const route of routes)for(const reverse of [false,true]){
   const points=reverse?[...route].reverse():route,feet=new T.Vector3(...points[0]);feet.y=p.groundAt(feet);p.place(feet);let grounded=true,v=0;
   for(const target of points.slice(1)){
    for(let n=0;n<1800;n++){
     const d=new T.Vector3(target[0]-feet.x,0,target[2]-feet.z);if(d.length()<.045)break;
     d.clampLength(0,speed/60);v=grounded?-.5:Math.max(-16,v-9.81/60);d.y=v/60;grounded=p.move(d,1/60,feet);
    }
    assert.ok(Math.hypot(feet.x-target[0],feet.z-target[2])<.1,`slab traversal ${speed}: ${feet.toArray()} -> ${target}`);
    assert.ok(Math.abs(feet.y-target[1])<.21,'slab route stays on the intended floor');
   }
  }
 }finally{p.dispose()}
});
