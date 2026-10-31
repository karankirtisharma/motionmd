import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { avatarFixture } from './helpers/avatar-fixture.mjs';

function shoeVertices(avatar) {
 const samples=[];
 avatar.root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const weights=mesh.geometry.attributes.skinWeight,joints=mesh.geometry.attributes.skinIndex;
  for(let v=0;v<weights.count;v++){
   let footWeight=0;
   for(let k=0;k<4;k++)if(/foot|toe/i.test(mesh.skeleton.bones[joints.getComponent(v,k)].name))footWeight+=weights.getComponent(v,k);
   if(footWeight>.95)samples.push([mesh,v]);
  }
 });return samples;
}
function lowestShoe(avatar,samples) {
 avatar.root.updateMatrixWorld(true);const point=new THREE.Vector3();let lowest=Infinity;
 for(const[mesh,index]of samples)lowest=Math.min(lowest,mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).y);
 return lowest;
}

test('spawn and settled idle soles stay on ordinary floors at each lounge elevation',async t=>{
 const avatar=await avatarFixture(),samples=shoeVertices(avatar);let minimumGap=Infinity,maximumGap=-Infinity;
 try{
  assert.equal(samples.length,361,'measure the actual supplied shoes');
  for(const floor of[-.355,0,3.675,4.265])for(const settlement of[0,-.009]){
   avatar.root.position.set(8.5,floor+settlement,-5);avatar.root.rotation.y=.71;
   avatar.resetMotion();avatar.update(0,0,0);
   for(let frame=0;frame<120;frame++){
    const gap=lowestShoe(avatar,samples)-floor;
    minimumGap=Math.min(minimumGap,gap);maximumGap=Math.max(maximumGap,gap);
    assert.ok(gap>=-.00001&&gap<=.01001,`spawn sole gap ${gap}m`);
    assert.ok(avatar.locomotion.soleLift>=0&&avatar.locomotion.soleLift<=.04);
    avatar.update(1/60,0,0);
   }
  }
  t.diagnostic(JSON.stringify({vertices:samples.length,minimumGap,maximumGap}));
 }finally{avatar.dispose();}
});

test('re-entry discards old sprint and seated pose before its first visible frame',async()=>{
 const used=await avatarFixture(),fresh=await avatarFixture();
 const bones=avatar=>{const list=[];avatar.root.traverse(o=>{if(o.isBone)list.push(o);});return list;};
 try{
  for(let frame=0;frame<180;frame++){used.root.rotation.y+=.025;used.update(1/60,3.35,0);}
  used.update(1/60,0,1,.55);
  for(const avatar of[used,fresh]){
   avatar.root.position.set(8.5,-.009,-5);avatar.root.rotation.y=-.56;
   avatar.resetMotion();avatar.update(0,0,0);
   assert.equal(avatar.locomotion.weights.idle,1);
   assert.equal(avatar.locomotion.weights.walk,0);assert.equal(avatar.locomotion.weights.run,0);assert.equal(avatar.locomotion.weights.sit,0);
   assert.equal(avatar.locomotion.speed,0);assert.equal(avatar.locomotion.phase,0);
   assert.equal(avatar.locomotion.forwardLean,0);assert.equal(avatar.locomotion.sideLean,0);
  }
  const a=bones(used),b=bones(fresh);
  for(let i=0;i<a.length;i++){
   assert.ok(a[i].position.distanceTo(b[i].position)<1e-9,`${a[i].name} inherited a previous position`);
   assert.ok(a[i].quaternion.toArray().every((v,j)=>Math.abs(v-b[i].quaternion.toArray()[j])<1e-12),`${a[i].name} inherited a previous rotation`);
  }
  assert.ok(Math.abs(lowestShoe(used,shoeVertices(used))-lowestShoe(fresh,shoeVertices(fresh)))<1e-8);
 }finally{used.dispose();fresh.dispose();}
});
