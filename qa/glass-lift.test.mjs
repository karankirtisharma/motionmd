import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
import { createGlassLift } from '../src/runtime/interaction/GlassLift.ts';
import { CinematicPath, CINEMATIC_SECONDS } from '../src/runtime/rendering/cinematic.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
async function load(url) {
 let b=fs.readFileSync(new URL('../public'+url,import.meta.url));
 const size=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+size));
 if(j.images?.length) {
  delete j.images;delete j.textures;delete j.samplers;j.materials=j.materials.map(m=>({name:m.name}));
  const raw=Buffer.from(JSON.stringify(j)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
  const h=Buffer.from(b.subarray(0,20));h.writeUInt32LE(20+json.length+b.length-20-size,8);h.writeUInt32LE(json.length,12);
  b=Buffer.concat([h,json,b.subarray(20+size)]);
 }
 return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene;
}
async function fixture() {
  const collision=new THREE.Group();for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])collision.add(await load(url));
  const scene=await load(manifest.chunks.find(c=>c.id==='founder-lift').url),p=await createCollisionWorld(collision,undefined,collision);
  const lift=createGlassLift(scene,p,manifest.lift);return {p,lift,scene,dispose(){lift.dispose();p.dispose();}};
}
function walk(f,feet,target,speed=1.38) {
  let grounded=true,vy=0;
  for(let i=0;i<600;i++) {
    const dx=target[0]-feet.x,dz=target[2]-feet.z,d=Math.hypot(dx,dz);if(d<.035)return;
    const step=Math.min(d,speed/60);vy=grounded?-.5:Math.max(-16,vy-9.81/60);
    f.lift.step(1/60,feet);grounded=f.p.move(new THREE.Vector3(dx/d*step,vy/60,dz/d*step),1/60,feet);
  }
  assert.fail(`Route blocked at ${feet.toArray()} toward ${target}`);
}
function tick(f,feet,frames=700) { const heights=[];for(let i=0;i<frames;i++){const rider=f.lift.step(1/60,feet);if(rider)f.p.place(feet);else f.p.world.step();f.lift.render(.5);heights.push(feet.y);}return heights; }

test('walk through presentation doorway, ride up, exit founder floor, reboard and descend',async t=>{
  const f=await fixture();try {
    for(const speed of [1.38,3.35]) {
      f.lift.reset();const feet=new THREE.Vector3(13.35,.035,-3.35);f.p.place(feet);
      walk(f,feet,[13.35,.035,1.15],speed);assert.ok(f.lift.inside(feet));
      assert.ok(Math.abs(feet.y-.035)<.035);assert.ok(f.lift.interact(feet));
      const heights=tick(f,feet);assert.equal(f.lift.state.floor,1);assert.equal(f.lift.state.phase,'idle');
      assert.ok(Math.abs(feet.y-4.23)<.035);assert.deepEqual(f.lift.state.doorLocked,[true,false]);
      assert.ok(Math.max(...heights.slice(1).map((v,i)=>Math.abs(v-heights[i])))<.018,'slow continuous hydraulic travel');
      walk(f,feet,[13.35,4.23,-1.8],speed);assert.ok(Math.abs(feet.y-4.23)<.035);
      walk(f,feet,[13.35,4.23,1.15],speed);f.lift.interact(feet);tick(f,feet);
      assert.equal(f.lift.state.floor,0);assert.ok(Math.abs(feet.y-.035)<.035);
      walk(f,feet,[13.35,.035,-3.35],speed);t.diagnostic(JSON.stringify({speed,end:feet.toArray()}));
    }
  }finally{f.dispose();}
});

test('empty-shaft doors block full capsule; remote calls and obstruction reopen safely',async()=>{
  const f=await fixture();try {
    const upper=new THREE.Vector3(13.35,4.23,-1.2);f.p.place(upper);
    for(let i=0;i<100;i++)f.p.move(new THREE.Vector3(0,-.5/60,3.35/60),1/60,upper);
    assert.ok(upper.z<-.23,'closed upper landing blocks shaft access');assert.ok(upper.y>4.2);
    assert.ok(f.lift.interact(upper));tick(f,upper);assert.equal(f.lift.state.floor,1);
    const lower=new THREE.Vector3(13.35,.035,-1);f.p.place(lower);f.lift.interact(lower);
    // Somebody crosses the upper door while it is closing; departure cancels.
    const obstruction=new THREE.Vector3(13.35,4.23,.1);tick(f,obstruction,130);
    assert.equal(f.lift.state.phase,'idle');assert.equal(f.lift.state.floor,1);assert.equal(f.lift.state.openness,1);
    f.lift.interact(lower);tick(f,lower);assert.equal(f.lift.state.floor,0);assert.deepEqual(f.lift.state.doorLocked,[false,true]);
  }finally{f.dispose();}
});

test('terrace is recessed clear of the moving cabin, with a fitted landing sill',async()=>{
 const f=await fixture();try {
  const feet=new THREE.Vector3(13.35,.035,1.15);f.p.place(feet);f.lift.interact(feet);tick(f,feet);
  assert.ok(Math.abs(f.p.groundAt(new THREE.Vector3(13.1,.035,.45))+.125)<.006,'former slab overlap now reaches recessed foundation');
  assert.ok(Math.abs(f.p.groundAt(new THREE.Vector3(13.35,.035,.10))-.035)<.006,'fixed sill supports the doorway');
  assert.ok(Math.abs(f.p.groundAt(new THREE.Vector3(11.9,.035,.40)))<.006,'adjacent terrace surface retained');
 }finally{f.dispose();}
});

test('interaction remains available against each reachable cabin wall',async()=>{
  const f=await fixture();try {
    for(const [dx,dz] of [[1,0],[-1,0],[0,1]]) {
      f.lift.reset();const feet=new THREE.Vector3(13.25,.035,1.15);f.p.place(feet);
      for(let i=0;i<120;i++) { f.lift.step(1/60,feet);f.p.move(new THREE.Vector3(dx*3.35/60,-.5/60,dz*3.35/60),1/60,feet); }
      assert.ok(f.lift.inside(feet),`wall contact still inside: ${feet.toArray()}`);
      assert.ok(f.lift.interact(feet));assert.ok(f.lift.state.riding);
    }
  }finally{f.dispose();}
});

test('hydraulic sheave/ram moves at half cabin speed and cable length stays constant',async()=>{
  const f=await fixture();try {
    const roles=new Map();f.scene.traverse(o=>{if(o.userData.liftRole)roles.set(o.userData.liftRole,o);});
    const practical=f.scene.getObjectByName('LF102 warm cabin practical');
    assert.ok(practical?.isRectAreaLight,'cabin practical is present');
    const feet=new THREE.Vector3(13.35,.035,1.15);f.p.place(feet);f.lift.interact(feet);
    for(let i=0;i<680;i++) {
      tick(f,feet,1);const h=roles.get('cabin').position.y;
      assert.ok(Math.abs(practical.getWorldPosition(new THREE.Vector3()).y-(manifest.lift.base+2.44+h))<1e-6,'warm light follows the cabin throughout travel');
      assert.ok(Math.abs(roles.get('hydraulicHead').position.y-h/2)<1e-6);
      assert.ok(Math.abs(roles.get('hydraulicRod').scale.y-(.27+h/2))<1e-6);
      assert.ok(Math.abs(roles.get('anchorCable').scale.y+roles.get('carriageCable').scale.y-4.785)<1e-6);
      assert.ok(roles.get('carriageCable').scale.y>.23);
    }
    f.lift.reset();assert.equal(roles.get('cabin').position.y,0);assert.deepEqual(f.lift.state.doorLocked,[false,true]);
  }finally{f.dispose();}
});

test('full cinematic stays clear of architecture and the synchronized moving lift',async()=>{
  const f=await fixture(),path=new CinematicPath(manifest),shape=new RAPIER.Ball(.17);try {
    for(let i=0;i<=9120;i++){
      const pose=path.sample(i/9120);f.lift.setCinematicPose(pose.lift);
      const hit=f.p.world.intersectionWithShape(pose.position,{x:0,y:0,z:0,w:1},shape,undefined,undefined,f.p.capsule,f.p.body);
      assert.ok(!hit,'blocked at '+i/9120*CINEMATIC_SECONDS+' seconds: '+f.p.colliderNames.get(hit?.handle));
    }
    assert.equal(f.lift.state.floor,1);assert.equal(f.lift.state.openness,1);
    assert.deepEqual(f.lift.state.doorLocked,[true,false]);
    // Handoff keeps the lift upstairs and callable for a return trip.
    const feet=new THREE.Vector3(13.35,4.23,1.15);f.p.place(feet);f.lift.interact(feet);tick(f,feet);
    assert.equal(f.lift.state.floor,0);
    f.lift.setCinematicPose(path.sample(0).lift);assert.equal(f.lift.state.height,0);
  }finally{f.dispose();}
});
