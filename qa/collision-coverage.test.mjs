import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const m=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
async function fixture(){const r=new T.Group();for(const u of [m.collisions.url,...m.collisions.additionalUrls]){const b=fs.readFileSync(new URL('../public'+u,import.meta.url));r.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene)}return createCollisionWorld(r,undefined,r)}
test('previously omitted glass guards, cabinet and club seats block the complete body',async()=>{
 const p=await fixture();try{
  for(const [name,x,y,z]of [['bridge guard',-.45,4.23,-17],['gallery guard',12,3.7,-24.9],['cabinet',16,4.25,-10.2],['founder club seat',10.7,4.25,-6.45]])assert.equal(p.canStandAt(new T.Vector3(x,y,z)),false,name);
  for(const speed of [1.38,3.35])for(const [name,start,dir,axis,bound,sign]of [
   ['bridge',[-1.3,4.2,-17],[1,0],'x',-.7,1],['gallery',[12,3.675,-24.05],[0,-1],'z',-24.64,-1],['cabinet',[16,4.23,-8.7],[0,-1],'z',-9.62,-1],['club seat',[10.7,4.23,-7.7],[0,1],'z',-7.2,1]
  ]){const feet=new T.Vector3(...start);p.place(feet);for(let i=0;i<300;i++){p.move(new T.Vector3(dir[0]*speed/60,-.5/60,dir[1]*speed/60),1/60,feet);assert.ok(p.canStandAt(feet),name+' body must stay outside solid geometry');}assert.ok(name==='club seat'||sign*feet[axis]<sign*bound,`${name} at ${speed}: ${feet.toArray()}`);assert.ok(Math.abs(feet.y-start[1])<.045,`${name} must not climb or fall`);}
 }finally{p.dispose()}
});
test('all original stair and gallery connections remain traversable with added guards',async()=>{
 const p=await fixture();try{const frames=m.tour.filter(f=>!f.sourceFrame&&!f.id.startsWith('Return')&&f.frame<4000);
 for(const speed of [1.38,3.35])for(let i=0;i<frames.length-1;i++){
  const a=frames[i],b=frames[i+1],feet=new T.Vector3(...a.position);feet.y=p.groundAt(feet.clone().add(new T.Vector3(0,-1.65,0)),2);p.place(feet);let g=false,v=0;
  for(let n=0;n<1200;n++){const d=new T.Vector3(b.position[0]-feet.x,0,b.position[2]-feet.z);if(d.length()<.08)break;d.clampLength(0,speed/60);v=g?-.5:Math.max(-16,v-9.81/60);d.y=v/60;g=p.move(d,1/60,feet)}
  assert.ok(Math.hypot(feet.x-b.position[0],feet.z-b.position[2])<.15,`${a.id} to ${b.id} at ${speed}: ${feet.toArray()}`);
 }
 }finally{p.dispose()}
});
