import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { avatarFixture } from './helpers/avatar-fixture.mjs';

const joint = (avatar,name) => avatar.root.getObjectByName(name);
const position = bone => bone.getWorldPosition(new THREE.Vector3());
const angle = (a,b) => a.clone().normalize().angleTo(b.clone().normalize());

test('tread clearance preserves foot direction, horizontal stride, limb lengths and upper-body animation',async t=>{
 const source=await avatarFixture(),contact=await avatarFixture();
 const sample=p=>p.z>.12?.17:0; sample.isStair=()=>true;
 const getLeg=(avatar,side)=>['Thigh','Calf','Foot'].map(n=>joint(avatar,`Bip01_${side}_${n}`));
 const upperNames=['Bip01_Spine','Bip01_Spine1','Bip01_Spine2','Bip01_Neck','Bip01_Head'];
 let maxHorizontal=0,maxFootAngle=0,minPlaneDot=1,maxJointLengthError=0;
 try{for(let frame=0;frame<480;frame++){
  const speed=frame<240?1.38:0;
  source.update(1/60,speed,0);contact.update(1/60,speed,0,.55,undefined,{sample});
  source.root.updateMatrixWorld(true);contact.root.updateMatrixWorld(true);
  for(const name of upperNames)assert.ok(angle(joint(source,name).quaternion,joint(contact,name).quaternion)<1e-6,`${name} changed`);
  for(const side of ['L','R']){
   const a=getLeg(source,side),b=getLeg(contact,side),pa=a.map(position),pb=b.map(position);
   maxHorizontal=Math.max(maxHorizontal,Math.hypot(pa[2].x-pb[2].x,pa[2].z-pb[2].z));
   maxFootAngle=Math.max(maxFootAngle,angle(a[2].getWorldQuaternion(new THREE.Quaternion()),b[2].getWorldQuaternion(new THREE.Quaternion())));
   for(let k=0;k<2;k++)maxJointLengthError=Math.max(maxJointLengthError,Math.abs(pa[k].distanceTo(pa[k+1])-pb[k].distanceTo(pb[k+1])));
   const planeA=pa[1].clone().sub(pa[0]).cross(pa[2].clone().sub(pa[1]));
   const planeB=pb[1].clone().sub(pb[0]).cross(pb[2].clone().sub(pb[1]));
   if(planeA.length()>.0001&&planeB.length()>.0001)minPlaneDot=Math.min(minPlaneDot,planeA.normalize().dot(planeB.normalize()));
  }
  assert.ok(contact.locomotion.stairBodyLift>=0&&contact.locomotion.stairBodyLift<=.24);
 }
 assert.ok(maxHorizontal<.001,`horizontal foot drift ${maxHorizontal}`);
 assert.ok(maxFootAngle<1e-6,`foot rotation changed ${maxFootAngle}`);
 assert.ok(maxJointLengthError<1e-6,`limb stretch ${maxJointLengthError}`);
 assert.ok(minPlaneDot>.9,`knee plane reversed ${minPlaneDot}`);
 t.diagnostic(JSON.stringify({maxHorizontal,maxFootAngle,minPlaneDot,maxJointLengthError}));
 }finally{source.dispose();contact.dispose();}
});

test('sprint fades to controlled stair gait and returns without action restarts',async t=>{
 const avatar=await avatarFixture();const sample=()=>0;sample.isStair=()=>false;
 let previousRun=0,previousPhase=0,maxWeightStep=0,maximumRun=0,minimumStairRun=1;
 try{for(let frame=0;frame<600;frame++){
  const stair=frame>=180&&frame<360; sample.isStair=()=>stair;
  avatar.update(1/60,3.35,0,.55,undefined,{sample,active:stair,sprint:true});
  const state=avatar.locomotion;
  if(frame>120)maxWeightStep=Math.max(maxWeightStep,Math.abs(state.weights.run-previousRun));
  if(frame>300&&frame<360)minimumStairRun=Math.min(minimumStairRun,state.weights.run);
  if(frame>480)maximumRun=Math.max(maximumRun,state.weights.run);
  assert.ok(((state.phase-previousPhase+1)%1)<.1,'gait phase restarted');
  previousRun=state.weights.run;previousPhase=state.phase;
 }
 assert.ok(maxWeightStep<.22,`abrupt sprint switch ${maxWeightStep}`);
 assert.ok(minimumStairRun<.001);assert.ok(maximumRun>.99,'flat sprint did not return');
 t.diagnostic(JSON.stringify({maxWeightStep,minimumStairRun,maximumRun}));
 }finally{avatar.dispose();}
});
