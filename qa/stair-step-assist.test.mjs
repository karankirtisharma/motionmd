import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

test('authored rounded stair climbs at slow approach speeds without extra horizontal motion',async context=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
 const root=new THREE.Group();
 for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]){
  const bytes=fs.readFileSync(new URL('../public'+url,import.meta.url));
  root.add((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'')).scene);
 }
 const physics=await createCollisionWorld(root,undefined,root);const reports=[];
 try{for(const speed of [.4,.95,1.75]){
  const feet=new THREE.Vector3(8.3,3.675,-23);feet.y=physics.groundAt(feet);physics.place(feet);
  let grounded=true,vy=0,frames=0,maximumRise=0;
  while(feet.x>6.4&&frames<1200){
   const before=feet.clone();vy=grounded?-.5:Math.max(-16,vy-9.81/60);
   grounded=physics.move(new THREE.Vector3(-speed/60,vy/60,0),1/60,feet);
   assert.ok(Math.hypot(feet.x-before.x,feet.z-before.z)<=speed/60+.004,'step assistance cannot add a forward lunge');
   maximumRise=Math.max(maximumRise,feet.y-before.y);assert.ok(feet.y-before.y<=.271,'must respect the physical maximum step height');frames++;
  }
  assert.ok(feet.x<=6.4,`speed ${speed} stalled at ${feet.toArray()}`);
  assert.ok(feet.y>4.15&&feet.y<4.25,'must finish supported on the upper landing');
  reports.push({speed,seconds:frames/60,maximumRise,feet:feet.toArray()});
 }
 context.diagnostic(JSON.stringify(reports));
 }finally{physics.dispose();}
});
