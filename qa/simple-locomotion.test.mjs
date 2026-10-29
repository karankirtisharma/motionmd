import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
const bones=avatar=>{const result=[];avatar.root.traverse(o=>{if(o.isBone)result.push(o);});return result;};

test('flat terrain leaves the original walk, run and idle poses unchanged',async()=>{
 const normal=await avatarFixture(),terrain=await avatarFixture();let samples=0;
 const sample=()=>{samples++;return .3;};sample.isStair=()=>false;
 const a=bones(normal),b=bones(terrain);
 try{for(let frame=0;frame<360;frame++){
  const speed=frame<90?1.38:frame<180?3.35:frame<270?0:1.38;
  for(const avatar of[normal,terrain]){avatar.root.position.set(frame/100,0,0);avatar.root.rotation.y=Math.sin(frame/100)*.35;}
  normal.update(1/60,speed,0);terrain.update(1/60,speed,0,.55,undefined,{sample});
  for(let i=0;i<a.length;i++){assert.deepEqual(a[i].position.toArray(),b[i].position.toArray());assert.deepEqual(a[i].quaternion.toArray(),b[i].quaternion.toArray(),a[i].name);}
  assert.deepEqual(terrain.locomotion.stairClearance,[0,0]);
 }assert.equal(samples,0);assert.deepEqual(new Set(terrain.animations),new Set(['Idle','Walk','Run','Sit']));
 }finally{normal.dispose();terrain.dispose();}
});

test('stair clearance preserves horizontal strides, foot orientation, bone lengths and upper-body motion',async()=>{
 const normal=await avatarFixture(),terrain=await avatarFixture(),a=bones(normal),b=bones(terrain);
 const sample=(_point,support)=>support+.12;sample.isStair=()=>true;
 const footPairs=a.map((o,i)=>[o,b[i]]).filter(([o])=>/Foot$/i.test(o.name));
 const p=new THREE.Vector3(),q=new THREE.Vector3(),r=new THREE.Quaternion(),s=new THREE.Quaternion();let corrections=0;
 try{for(let frame=0;frame<360;frame++){
  const speed=frame<120?1.38:frame<240?3.35:0;
  for(const avatar of[normal,terrain]){avatar.root.position.set(frame/100,0,0);avatar.root.rotation.y=Math.sin(frame/100)*.35;}
  normal.update(1/60,speed,0);terrain.update(1/60,speed,0,.55,undefined,{sample});
  normal.root.updateMatrixWorld(true);terrain.root.updateMatrixWorld(true);
  for(let i=0;i<a.length;i++){
   assert.deepEqual(a[i].position.toArray(),b[i].position.toArray(),`${a[i].name}: no bone translation or stretching`);
   if(!/(Thigh|Calf|Foot)$/i.test(a[i].name))assert.deepEqual(a[i].quaternion.toArray(),b[i].quaternion.toArray(),`${a[i].name}: source pose`);
  }
  for(const[x,y]of footPairs){x.getWorldPosition(p);y.getWorldPosition(q);assert.ok(Math.hypot(p.x-q.x,p.z-q.z)<1e-5,'no sideways or forward foot relocation');assert.ok(x.getWorldQuaternion(r).normalize().angleTo(y.getWorldQuaternion(s).normalize())<1e-6,`keep source shoe direction: ${r.angleTo(s)}`);assert.ok(q.y>=p.y-1e-5&&q.y-p.y<=.27001);}
  corrections+=terrain.locomotion.stairClearance.some(v=>v>.01)?1:0;
 }assert.ok(corrections>100);
 // A seat interaction must never inherit the terrain correction.
 normal.update(1/60,0,1);terrain.update(1/60,0,1,.55,undefined,{sample});
 assert.deepEqual(terrain.locomotion.stairClearance,[0,0]);
 for(let i=0;i<a.length;i++)assert.deepEqual(a[i].quaternion.toArray(),b[i].quaternion.toArray(),`${a[i].name}: sitting unchanged`);
 }finally{normal.dispose();terrain.dispose();}
});


test('raised stair targets cannot flip a straight source knee backwards or across the other leg', async () => {
 const avatar=await avatarFixture();
 const find=name=>bones(avatar).find(b=>b.name.replace(/[^a-z0-9]/gi,'').toLowerCase()===name.toLowerCase());
 const legs=['L','R'].map(side=>({hip:find(`Bip01${side}Thigh`),knee:find(`Bip01${side}Calf`),foot:find(`Bip01${side}Foot`)}));
 const sample=(_point,support)=>support+.16;sample.isStair=()=>true;
 const h=new THREE.Vector3(),k=new THREE.Vector3(),a=new THREE.Vector3(),axis=new THREE.Vector3(),bend=new THREE.Vector3(),forward=new THREE.Vector3();
 const knees=[new THREE.Vector3(),new THREE.Vector3()];let corrected=0;
 try {for(let frame=0;frame<480;frame++) {
  avatar.root.rotation.y=frame*.013;
  avatar.update(1/60,frame<240?1.38:1.65,0,.55,undefined,{sample});avatar.root.updateMatrixWorld(true);
  forward.set(0,0,1).applyQuaternion(avatar.root.quaternion);
  for(const [index,leg] of legs.entries()) {
   leg.hip.getWorldPosition(h);leg.knee.getWorldPosition(k);leg.foot.getWorldPosition(a);
   axis.copy(a).sub(h).normalize();bend.copy(k).sub(h);bend.addScaledVector(axis,-bend.dot(axis));
   assert.ok(bend.dot(forward)>=-.001,`knee must bend toward toes, frame ${frame}, leg ${index}`);
   const flex=Math.PI-h.clone().sub(k).angleTo(a.clone().sub(k));
   assert.ok(flex<110*Math.PI/180,`no deep squat on a 16 cm tread: ${flex*180/Math.PI}`);
   knees[index].copy(k);avatar.root.worldToLocal(knees[index]);
  }
  assert.ok(knees[0].x-knees[1].x>.07,'knees stay in separate anatomical lanes');
  corrected+=avatar.locomotion.stairClearance.some(v=>v>.01)?1:0;
 }assert.ok(corrected>300);}finally{avatar.dispose();}
});
