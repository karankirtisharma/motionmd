// Explain individual samples from camera-view-audit: what the render geometry and the collision world each
// put between the visitor's chest and the desired camera.   node qa/camera-view-inspect.mjs <bad.json> [count]
import fs from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
const collisionNames=[];
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]){const root=(await geometryFixture(url)).root;colliders.add(root);}
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds);
const visual=new RAPIER.World({x:0,y:0,z:0}),names=new Map(),point=new THREE.Vector3();
scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.name??'');
  if(materials.some(name=>/glass|glaz|water|acrylic|transluc|sheer|curtain|light beam|glow|haze/i.test(name)))return;
  const position=mesh.geometry.attributes.position,vertices=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);vertices.set([point.x,point.y,point.z],i*3);}
  const index=mesh.geometry.index,indices=new Uint32Array(index?.count??position.count);
  for(let i=0;i<indices.length;i++)indices[i]=index?index.getX(i):i;
  if(indices.length<3)return;
  names.set(visual.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices)).handle,`${mesh.userData.sourceName??mesh.name} / ${materials[0]}`);
});
visual.step();
const collisionMeshNames=new Map();
{ // Rebuild the handle → name map the same way the world assigned handles is not exposed; identify by ray against a named copy.
}
const bad=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).filter(b=>b.through);
const count=Number(process.argv[3]??8),stride=Math.max(1,Math.floor(bad.length/count));
for(let i=0;i<bad.length&&i/stride<count;i+=stride){
  const b=bad[i],feet=new THREE.Vector3(...b.feet),pivot=feet.clone().setY(feet.y+1.35);
  const offset=new THREE.Vector3(Math.sin(b.yaw)*Math.cos(b.pitch)*2.45,Math.sin(b.pitch)*2.45+.1,Math.cos(b.yaw)*Math.cos(b.pitch)*2.45),length=offset.length(),direction=offset.clone().multiplyScalar(1/length);
  const render=visual.castRay(new RAPIER.Ray(pivot,direction),length,false);
  const collision=physics.world.castRay(new RAPIER.Ray(pivot,direction),length+2,true,undefined,undefined,physics.capsule,physics.body);
  const renderPoint=render&&pivot.clone().addScaledVector(direction,render.timeOfImpact);
  console.log(JSON.stringify({feet:b.feet,yaw:b.yaw,pitch:b.pitch,boom:b.boom,renderHitAt:render&&+render.timeOfImpact.toFixed(2),renderPoint:renderPoint?.toArray().map(v=>+v.toFixed(2)),renderMesh:render&&names.get(render.collider.handle).slice(0,70),collisionHitAt:collision?+collision.timeOfImpact.toFixed(2):null}));
}
physics.dispose();visual.free();
