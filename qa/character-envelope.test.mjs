import test from 'node:test';
import fs from 'node:fs';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
import {exactBox} from '../src/runtime/interaction/exactBox.ts';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {createStairSurfaces} from '../src/runtime/interaction/StairSurfaces.ts';

const skinned = avatar => {const meshes=[];avatar.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});return meshes;};
function floorFixture() {
 const material=new T.MeshBasicMaterial();material.name='shell__Neutral architectural ground';
 const floor=new T.Mesh(new T.BoxGeometry(30,.2,30),material);floor.position.y=-.1;
 return new T.Group().add(floor);
}

test('exact-box conversion rejects openings, missing faces and bevels',()=>{
 const g=new T.BoxGeometry(2,1,3),v=Float32Array.from(g.attributes.position.array),ix=Uint32Array.from(g.index.array);
 assert.ok(exactBox(v,ix));
 assert.equal(exactBox(v,ix.slice(6)),undefined,'a missing face must remain an open mesh');
 const bevel=v.slice();bevel[0]-=.01;assert.equal(exactBox(bevel,ix),undefined,'changed corner is not an exact box');
});

test('animated shoes clear an ordinary floor with a small measured correction',async context=>{
 const avatar=await avatarFixture(), scene=floorFixture(),sample=createStairSurfaces(scene),point=new T.Vector3();
 const meshes=skinned(avatar);let min=Infinity,maxLift=0;
 try{for(const speed of[0,1.38,3.35]) for(let frame=0;frame<150;frame++){
  avatar.update(1/60,speed,0,undefined,undefined,{sample});avatar.root.updateMatrixWorld(true);
  maxLift=Math.max(maxLift,...avatar.locomotion.stairClearance);
  for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
   mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);min=Math.min(min,point.y);
  }
 }assert.ok(Number.isFinite(min),'actual shoe skin must be sampled');assert.ok(min>=-.002,`shoe penetration ${min}`);assert.ok(maxLift<.04,`flat-floor correction must stay small: ${maxLift}`);
 context.diagnostic(JSON.stringify({minimumSole: min,maximumCorrection:maxLift}));}finally{avatar.dispose()}
});

test('animated walk and sprint stop clear of walls at cardinal and diagonal headings',async context=>{
 const results=[];
 for(const speed of[1.38,3.35])for(const yaw of[0,Math.PI/4,Math.PI/2,Math.PI]){
  const scene=floorFixture(),wall=new T.Mesh(new T.BoxGeometry(8,3,.2),new T.MeshBasicMaterial());
  const forward=new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));wall.position.copy(forward).multiplyScalar(.1);wall.position.y=1.5;wall.rotation.y=yaw;scene.add(wall);
  const physics=await createCollisionWorld(scene,undefined,scene),avatar=await avatarFixture(),meshes=skinned(avatar),sample=createStairSurfaces(scene),feet=forward.clone().multiplyScalar(-2.5),point=new T.Vector3();physics.place(feet);
  let commanded=0,actual=0,grounded=true,vy=0,maximum=-Infinity,minimum=Infinity;
  try{for(let frame=0;frame<360;frame++){
   const target=physics.speedForClearance(forward,speed);commanded+=(target-commanded)*(1-Math.exp(-8/60));
   const before=feet.clone();vy=grounded?-.5:Math.max(-16,vy-9.81/60);
   grounded=physics.move(forward.clone().multiplyScalar(commanded/60).setY(vy/60),1/60,feet);
   const achieved=Math.hypot(feet.x-before.x,feet.z-before.z)*60;
   actual+=((achieved<.06?0:achieved)-actual)*(1-Math.exp(-16/60));
   avatar.root.position.copy(feet);avatar.root.rotation.y=yaw;avatar.update(1/60,actual,0,undefined,undefined,{sample});
   if(frame%3===0&&feet.dot(forward)>-1){avatar.root.updateMatrixWorld(true);for(const mesh of meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++){
    mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld);maximum=Math.max(maximum,point.dot(forward));minimum=Math.min(minimum,point.y);
   }}
   assert.ok(physics.canStandAt(feet),`body overlap ${speed}/${yaw}/${frame}: ${feet.toArray()}`);
  }
  assert.ok(feet.dot(forward)>-.38,'must reach body contact without a permanent stride-length dead zone');
  assert.ok(maximum<.002,`animated mesh penetrates wall by ${maximum} at ${speed}/${yaw}`);
  assert.ok(minimum>-.003,`skin below floor: ${minimum}`);
  results.push({speed,yaw,maximumPenetration:maximum,rootDistance:-feet.dot(forward)});
 }finally{avatar.dispose();physics.dispose()}
 }
 context.diagnostic(JSON.stringify(results));
});

test('head and shoulder clearance blocks low overhangs at walking and sprint speeds',async()=>{
 for(const speed of[1.38,3.35]){
 const scene=floorFixture(),beam=new T.Mesh(new T.BoxGeometry(3,.3,.4));beam.position.set(0,1.96,0);scene.add(beam);
 const physics=await createCollisionWorld(scene,undefined,scene),feet=new T.Vector3(0,0,-1.5);physics.place(feet);
 try{for(let i=0;i<240;i++)physics.move(new T.Vector3(0,-.5/60,speed/60),1/60,feet);
 assert.ok(feet.z<-.2,'1.81m overhang must block the 1.89m animated head');
 }finally{physics.dispose()}
 }
});


test('visible contact surfaces cover every room inspection point at source height',async()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url))),scene=new T.Group();
 for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
 const sample=createStairSurfaces(scene);
 for(const [name,x,y,z] of [['entrance',-8,-.355,-17.1],['studio',16.4,.015,-30.7],['lift',13.35,0,-3.35],['bridge',-1.3,4.233,-17],['gallery',12,3.675,-24.05],['founder',16,4.23,-8.7],['balcony',11,4.23,-10.25],['return',8.14,3.675,-24.48],['desk rug',14.8,4.262,-6.1],['lounge',8.5,0,-5]]) {
   const height=sample(new T.Vector3(x,y,z),y);
   assert.ok(height!==undefined && Math.abs(height-y)<.002,`${name}: ${height} vs ${y}`);
 }
});

test('close body contact permits tangential travel and immediate retreat', async () => {
 const scene=floorFixture(), wall=new T.Mesh(new T.BoxGeometry(12,3,.2));wall.position.set(0,1.5,.1);scene.add(wall);
 const physics=await createCollisionWorld(scene,undefined,scene), feet=new T.Vector3(0,0,-.37);
 physics.place(feet);
 try {
  for (const direction of [new T.Vector3(1,0,0),new T.Vector3(-1,0,0),new T.Vector3(0,0,-1)]) {
   assert.equal(physics.speedForClearance(direction,3.35),3.35,'wall must not slow movement alongside or away from it');
  }
  for(let i=0;i<120;i++) physics.move(new T.Vector3(1.38/60,-.5/60,0),1/60,feet);
  assert.ok(feet.x>2.6,'walk alongside wall without sticky contact');
  assert.ok(Math.abs(feet.y)<.003,'slow contact must not snap below the floor');
  assert.ok(physics.canStandAt(feet));
 } finally {physics.dispose();}
});
