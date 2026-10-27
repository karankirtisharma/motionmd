import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {createStairSurfaces} from '../src/runtime/interaction/StairSurfaces.ts';

test('millimetre sole contact preserves the source knee plane instead of imposing the seated hinge',async context=>{
 const source=await avatarFixture(),contact=await avatarFixture();let maximumIdleThigh=0,maximumMovingThigh=0,maximumFootAngle=0;
 try {
  for(const speed of [0,1.38,3.35])for(let frame=0;frame<180;frame++){
   source.update(1/60,speed,0);contact.update(1/60,speed,0,.55,undefined,{sample:()=>0});
   for(const side of ['L','R']) {
    const name='Bip01_'+side+'_Thigh';
    const angle=source.root.getObjectByName(name).quaternion.angleTo(contact.root.getObjectByName(name).quaternion)*180/Math.PI;
    if(speed===0)maximumIdleThigh=Math.max(maximumIdleThigh,angle);else maximumMovingThigh=Math.max(maximumMovingThigh,angle);
    const foot='Bip01_'+side+'_Foot';
    maximumFootAngle=Math.max(maximumFootAngle,source.root.getObjectByName(foot).getWorldQuaternion(new T.Quaternion()).normalize().angleTo(contact.root.getObjectByName(foot).getWorldQuaternion(new T.Quaternion()).normalize()));
   }
  }
  assert.ok(maximumIdleThigh<2.5,`2mm contact changed idle thigh ${maximumIdleThigh} degrees`);
  assert.ok(maximumMovingThigh<5,`ordinary floor must not overwrite the source gait: ${maximumMovingThigh}`);
  assert.ok(maximumFootAngle<1e-5,`toe orientation remains authored: ${maximumFootAngle}`); context.diagnostic(JSON.stringify({maximumIdleThigh,maximumMovingThigh,maximumFootAngle}));
 }finally{source.dispose();contact.dispose()}
});

function top(materialName){
 const material=new T.MeshBasicMaterial();material.name=materialName;
 const mesh=new T.Mesh(new T.PlaneGeometry(2,2),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=.3;
 return new T.Group().add(mesh);
}
test('authored stair anticipation crosses the support-height eligibility band continuously',()=>{
 const sample=createStairSurfaces(top('v19__EH54 | polished warm-grey cloud marble'));
 const point=new T.Vector3(0,0,0);let last=0,maximumChange=0;
 for(let support=-.06;support<=.04;support+=.001){
  const value=sample(point,support,.18)??0;
  assert.ok(value>=last-1e-7,'anticipatory target is monotonic');
  maximumChange=Math.max(maximumChange,value-last);last=value;
 }
 assert.ok(last>.299,'actual tread height is reached');
 assert.ok(maximumChange<.006,`eligibility must not introduce a whole-tread pop: ${maximumChange}`);
 assert.equal(sample(point,0),undefined,'exact contact keeps the physical maximum-step bound');
});

test('ordinary raised ledges do not gain unreachable stair anticipation',()=>{
 const sample=createStairSurfaces(top('shell__PL86 | ground wing polished existing marble'));
 assert.equal(sample(new T.Vector3(0,0,0),0,.18),undefined);
 assert.equal(sample(new T.Vector3(0,0,0),0),undefined);
});
