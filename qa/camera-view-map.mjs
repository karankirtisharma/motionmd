// ASCII elevation of one wall plane: where the rendered geometry (R), the collision world (C) or both (B) stop a ray.
//   node qa/camera-view-map.mjs <axis x|z> <plane> <from> <to> <startOffset> [yMin yMax]
// axis z: rays travel along z from plane+startOffset toward the plane, sampled along x in [from,to].
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
  if(materials.some(name=>/glass|glaz|water|acrylic|transluc|sheer|curtain|light beam|glow|haze/i.test(name)))return;
  const position=mesh.geometry.attributes.position,vertices=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);vertices.set([point.x,point.y,point.z],i*3);}
  const index=mesh.geometry.index,indices=new Uint32Array(index?.count??position.count);
  for(let i=0;i<indices.length;i++)indices[i]=index?index.getX(i):i;
  if(indices.length<3)return;
  names.set(visual.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices)).handle,`${mesh.userData.sourceName??mesh.name} / ${materials[0]}`);
});
visual.step();
const jobs=process.argv.slice(2).join(' ').split(';').map(s=>s.trim().split(/\s+/));
for(const [axis,planeText,fromText,toText,offsetText,yMinText='0.25',yMaxText='4'] of jobs){
  const plane=+planeText,from=+fromText,to=+toText,offset=+offsetText,reach=Math.abs(offset)+.6,direction=axis==='z'?{x:0,y:0,z:-Math.sign(offset)}:{x:-Math.sign(offset),y:0,z:0};
  console.log(`\n${axis}=${plane} seen from ${axis}=${plane+offset}, across ${axis==='z'?'x':'z'} ${from}..${to} (R render only, C collision only, B both, . open)`);
  const seen=new Map();
  for(let y=+yMaxText;y>=+yMinText-1e-6;y-=.25){
    let row='';
    for(let t=from;t<=to+1e-6;t+=.25){
      const origin=axis==='z'?{x:t,y,z:plane+offset}:{x:plane+offset,y,z:t};
      const r=visual.castRay(new RAPIER.Ray(origin,direction),reach,false),c=physics.world.castRay(new RAPIER.Ray(origin,direction),reach,false,undefined,undefined,physics.capsule,physics.body);
      // "Both" only when the collision surface is within 12 cm of the rendered one.
      const both=r&&c&&Math.abs(r.timeOfImpact-c.timeOfImpact)<.12;
      row+=both?'B':r&&c?(c.timeOfImpact<r.timeOfImpact?'c':'r'):r?'R':c?'C':'.';
      if(r&&!both){const n=names.get(r.collider.handle);seen.set(n,(seen.get(n)??0)+1);}
    }
    console.log(y.toFixed(2).padStart(5),row);
  }
  console.log('      '+Array.from({length:Math.floor((to-from)/1)+1},(_,i)=>String(Math.round(from+i)).padEnd(4)).join(''));
  console.log(' render-only meshes:',[...seen].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,c])=>`${c}× ${n.slice(0,80)}`).join(' | '));
}
physics.dispose();visual.free();
