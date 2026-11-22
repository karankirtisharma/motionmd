import fs from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync('./public/assets/scene-manifest.json'));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds);
const f=new THREE.Vector2(.45,-.33).normalize(),yaw=Math.atan2(-f.x,-f.y),pitch=.95;
for(const x of [-2.4,-2.1,-1.8,-1.5,-1.3])for(const z of [-17.9,-17.4,-17]){
  const feet=new THREE.Vector3(x,4.6,z);feet.y=physics.groundAt(feet,1);
  const pivot=feet.clone().setY(feet.y+1.35),desired=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch)*2.45,Math.sin(pitch)*2.45+.1,Math.cos(yaw)*Math.cos(pitch)*2.45).add(pivot);
  const dir=desired.clone().sub(pivot),len=dir.length();dir.normalize();
  const hit=physics.world.castShape(pivot,{x:0,y:0,z:0,w:1},dir,new RAPIER.Ball(.19),.01,len,true,undefined,undefined,physics.capsule,physics.body);
  const ray=physics.world.castRay(new RAPIER.Ray(pivot,dir),len,true,undefined,undefined,physics.capsule,physics.body);
  console.log(`feet ${feet.toArray().map(v=>v.toFixed(2))} stand ${physics.canStandAt(feet)} plain ${physics.cameraDistance(pivot,desired,undefined,false).toFixed(2)} withDrawn ${physics.cameraDistance(pivot,desired).toFixed(2)} sweepHit ${hit?hit.time_of_impact.toFixed(2)+' '+physics.colliderNames.get(hit.collider.handle):'-'} ray ${ray?ray.timeOfImpact.toFixed(2)+' '+physics.colliderNames.get(ray.collider.handle):'-'}`);
}
physics.dispose();
