import fs from 'node:fs';
import * as THREE from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds);
// Walk test: place the visitor and push them along a direction for 3 s; report where they stop.
for(const text of process.argv.slice(2)){
  const [x,y,z,dx,dz]=text.trim().split(/\s+/).map(Number),feet=new THREE.Vector3(x,y,z);
  feet.y=physics.groundAt(feet,3);physics.place(feet);
  const start=feet.clone();
  for(let i=0;i<240;i++)physics.move(new THREE.Vector3(dx*1.38/60,-.5/60,dz*1.38/60),1/60,feet);
  console.log(`from ${start.toArray().map(v=>v.toFixed(2))} heading ${dx},${dz} → stops at ${feet.toArray().map(v=>v.toFixed(2))} (walked ${feet.distanceTo(start).toFixed(2)} m of 5.52)`);
}
physics.dispose();
