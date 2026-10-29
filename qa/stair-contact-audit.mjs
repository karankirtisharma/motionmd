import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
import {createStairSurfaces} from '../src/runtime/interaction/StairSurfaces.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const id of ['v13','v18','v19','entrance','shell'])scene.add((await geometryFixture(manifest.chunks.find(c=>c.id===id).url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds),sample=createStairSurfaces(scene);
const output=[];
for(const route of ['spiral','rounded','entrance']) for(const reverse of [false,true])for(const speed of [1.38,3.35]){
 if(process.env.STAIR_AUDIT_ROUTE && route!==process.env.STAIR_AUDIT_ROUTE)continue;
 const avatar=await avatarFixture();const samples=[];
 avatar.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const w=mesh.geometry.attributes.skinWeight,j=mesh.geometry.attributes.skinIndex;
  for(let v=0;v<w.count;v++){let fw=0;for(let s=0;s<4;s++)if(/foot|toe/i.test(mesh.skeleton.bones[j.getComponent(v,s)].name))fw+=w.getComponent(v,s);if(fw>.95)samples.push([mesh,v]);}});
 let contactCalls=0,contactMs=0,gateCalls=0,gateMs=0,avatarMs=0;
 const measuredSample=(...args)=>{const t=performance.now();const value=sample(...args);contactCalls++;contactMs+=performance.now()-t;return value;};
 measuredSample.clearance=(...args)=>{const t=performance.now();const value=sample.clearance(...args);contactCalls++;contactMs+=performance.now()-t;return value;};
 measuredSample.isStair=(...args)=>{const t=performance.now();const value=sample.isStair(...args);gateCalls++;gateMs+=performance.now()-t;return value;};
 const point=new THREE.Vector3(),support=new THREE.Vector3(),gaps=[];let previous,elapsed=0,worst=0,worstAt;
 for(let frame=0;frame<181;frame++){
  const t=reverse?1-frame/180:frame/180;
  if(route==='spiral'){const angle=(60+315/46)-(315+315/46)*t,a=angle*Math.PI/180;support.set(18.76+1.55*Math.cos(a),3.67/24*((60-angle)/(315/23)+.5),-(20.2+1.55*Math.sin(a)));}
  else if(route==='rounded')support.set(8.3-3.15*t,3.675,-23);
  else support.set(-7+2.52*t,-.355,-17.1);
  support.y=physics.groundAt(support);
  let dt=1/60;if(previous){const dx=support.x-previous.x,dz=support.z-previous.z;dt=Math.hypot(dx,dz)/speed;avatar.root.rotation.y=Math.atan2(dx,dz);}
  previous=support.clone();elapsed+=dt;avatar.root.position.copy(support);const avatarStart=performance.now();avatar.update(dt,speed,0,.55,undefined,{sample:measuredSample});avatarMs+=performance.now()-avatarStart;avatar.root.updateMatrixWorld(true);
  let penetration=0;
  for(const[mesh,index]of samples){mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld);const y=sample(point,support.y);if(y!==undefined)penetration=Math.max(penetration,y-point.y);}
  gaps.push(penetration);if(penetration>worst){worst=penetration;worstAt={frame,position:support.toArray(),phase:avatar.locomotion.phase,clearance:avatar.locomotion.stairClearance,stair:sample.isStair(support,support.y)};}
 }
 gaps.sort((a,b)=>a-b);output.push({route,reverse,speed,vertices:samples.length,contactCalls,contactMs,gateCalls,gateMs,avatarMs,penetrationMax:worst,penetrationP95:gaps[Math.floor(gaps.length*.95)],worstAt});avatar.dispose();
}
physics.dispose();console.log(JSON.stringify(output,null,2));
for(const result of output) assert.ok(result.penetrationMax < .003, `${result.route} reverse=${result.reverse} speed=${result.speed}: shoe penetration ${result.penetrationMax} m`);
