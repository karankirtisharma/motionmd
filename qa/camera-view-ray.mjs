// node qa/camera-view-ray.mjs "x y z dx dy dz" ...   — first render hit and first collision hit along each ray (12 m)
import fs from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds);
const visual=new RAPIER.World({x:0,y:0,z:0}),names=new Map(),point=new THREE.Vector3();
scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.name??'');
  const position=mesh.geometry.attributes.position,vertices=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);vertices.set([point.x,point.y,point.z],i*3);}
  const index=mesh.geometry.index,indices=new Uint32Array(index?.count??position.count);
  for(let i=0;i<indices.length;i++)indices[i]=index?index.getX(i):i;
  if(indices.length<3)return;
  names.set(visual.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices)).handle,`${mesh.userData.sourceName??mesh.name} / ${materials[0]} (${indices.length/3} tris)`);
});
visual.step();
for(const text of process.argv.slice(2)){
  const [x,y,z,dx,dy,dz]=text.trim().split(/\s+/).map(Number),d=new THREE.Vector3(dx,dy,dz).normalize();
  const hits=[];let origin={x,y,z},travelled=0;
  for(let i=0;i<4;i++){const r=visual.castRay(new RAPIER.Ray(origin,d),12-travelled,false);if(!r)break;travelled+=r.timeOfImpact+.02;hits.push(`${(travelled-.02).toFixed(2)} ${names.get(r.collider.handle)}`);origin={x:x+d.x*travelled,y:y+d.y*travelled,z:z+d.z*travelled};}
  const c=physics.world.castRay(new RAPIER.Ray({x,y,z},d),12,false,undefined,undefined,physics.capsule,physics.body);
  console.log(`\nray ${text}\n  collision: ${c?c.timeOfImpact.toFixed(2)+' '+physics.colliderNames.get(c.collider.handle):'none'}\n  render:\n    ${hits.join('\n    ')}`);
}
physics.dispose();visual.free();
