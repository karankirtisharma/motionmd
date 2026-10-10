import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vector3,PerspectiveCamera} from 'three';
import {CINEMATIC_SECONDS,LIFT_TIMING,CINEMATIC_HANDOFF,CinematicPath,cinematicDistance} from '../src/runtime/rendering/cinematic.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const original=JSON.stringify(manifest.tour), path=new CinematicPath(manifest);
test('complete live tour covers all principal spaces without rewriting the source anchors',()=>{
 assert.equal(JSON.stringify(manifest.tour),original);
 for(const id of ['Desert architecture','Entrance threshold','Studio work floor','PC screen reveal','PC screen tracking','Studio chandelier reveal','MD sculpture reveal','Seating reveal','Presentation screen','Cabin boarding','Founder room reveal'])assert.ok(path.frames.some(f=>f.id===id),'missing '+id);
 assert.ok(CINEMATIC_SECONDS>=60&&CINEMATIC_SECONDS<=90,'showcase must fit the requested 1–1.5 minutes');
 assert.ok(!path.frames.some(f=>/flight|stair|gallery|bridge/i.test(f.id)),'omit the rejected long staircase detour');
 const frame=path.frames.at(-1),last=path.sample(1),camera=new PerspectiveCamera();camera.position.fromArray(frame.position);camera.lookAt(new Vector3(...frame.target));
 assert.ok(last.position.distanceTo(camera.position)<1e-6);assert.ok(last.quaternion.angleTo(camera.quaternion)<1e-6);
 assert.ok(last.position.distanceTo(new Vector3(...CINEMATIC_HANDOFF.position))<3.2,'exploration continues in the room where the tour ends');
});
test('room camera and hydraulic ride have bounded motion and a level horizon',()=>{
 let previous=path.sample(0),vprev,maxSpeed=0,maxAcceleration=0,maxTurn=0;
 for(let i=1;i<=CINEMATIC_SECONDS*60;i++){
  const pose=path.sample(i/(CINEMATIC_SECONDS*60)),v=pose.position.clone().sub(previous.position).multiplyScalar(60);
  maxSpeed=Math.max(maxSpeed,v.length());maxTurn=Math.max(maxTurn,pose.quaternion.angleTo(previous.quaternion)*60*180/Math.PI);
  if(vprev)maxAcceleration=Math.max(maxAcceleration,v.clone().sub(vprev).length()*60);
  assert.ok([...pose.position.toArray(),...pose.quaternion.toArray(),pose.fov].every(Number.isFinite));
  assert.ok(Math.abs(new Vector3(1,0,0).applyQuaternion(pose.quaternion).y)<1e-6,'no unintended camera roll');
  previous=pose;vprev=v;
 }
 assert.ok(maxSpeed<2.4,`speed ${maxSpeed}`);assert.ok(maxAcceleration<4,`acceleration ${maxAcceleration}`);assert.ok(maxTurn<40,`turn ${maxTurn}`);
 assert.ok(cinematicDistance(.0001)<1e-6);assert.ok(1-cinematicDistance(.9999)<1e-6);
});
test('camera remains in the cabin, doors close before rising, and opening precedes exit',()=>{
 const at=s=>path.sample(s/CINEMATIC_SECONDS);
 for(let t=LIFT_TIMING.close;t<=LIFT_TIMING.arrive;t+=.02){const p=at(t);assert.equal(p.lift.openness,0);assert.ok(Math.abs(p.position.y-p.lift.height-1.69)<1e-8);assert.ok(p.position.z>.8);}
 assert.equal(at(LIFT_TIMING.open).lift.openness,1);
 assert.equal(at(0).lift.floor,0);assert.equal(at(CINEMATIC_SECONDS).lift.floor,1);
 for(const boundary of Object.values(LIFT_TIMING)){const a=at(boundary-.00001),b=at(boundary+.00001);assert.ok(a.position.distanceTo(b.position)<1e-4);assert.ok(a.quaternion.angleTo(b.quaternion)<1e-4);}
});
