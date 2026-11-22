// Stair walk audit, every frame at the display rate. The authored walk is not altered on stairs, so the
// legs are the flat-ground legs by construction (checked bone for bone); what can go wrong is the body's
// height: shoes entering a tread, shoes hovering, or the body moving unevenly.
//   node qa/stair-walk-audit.mjs            STAIR_HZ=164,60  STAIR_TRACE=<file> writes every frame
import fs from 'node:fs';
import * as THREE from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
import {createStairSurfaces} from '../src/runtime/interaction/StairSurfaces.ts';
import {smoothSupportHeight} from '../src/runtime/interaction/movement.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const id of ['v13','v18','v19','entrance','shell'])scene.add((await geometryFixture(manifest.chunks.find(c=>c.id===id).url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds),sample=createStairSurfaces(scene,'stair-candidates');
const routes=[['spiral r1.55',t=>spiral(t,1.55)],['spiral r1.1',t=>spiral(t,1.1)],['spiral r0.85',t=>spiral(t,.85)],['rounded',t=>[8.3-3.15*t,3.675,-23]],['entrance',t=>[-7.5+3.02*t,-.355,-17.1]]];
function spiral(t,r){t=-.07+1.07*t;const angle=(60+315/46)-(315+315/46)*t,a=angle*Math.PI/180;return [18.76+r*Math.cos(a),3.67/24*((60-angle)/(315/23)+.5),-(20.2+r*Math.sin(a))];}
const rates=(process.env.STAIR_HZ??'164,60').split(',').map(Number),rows=[],trace=[];
const point=new THREE.Vector3(),cm=v=>(v*100).toFixed(1);
for(const [route,at] of routes)for(const reverse of [false,true])for(const speed of (process.env.STAIR_SPEEDS??'0.9,1.2').split(',').map(Number))for(const hz of rates){
  const avatar=await avatarFixture(),flat=await avatarFixture(),soles=[];
  avatar.root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const w=mesh.geometry.attributes.skinWeight,j=mesh.geometry.attributes.skinIndex;
    for(let v=0;v<w.count;v++){let fw=0,left=0;for(let s=0;s<4;s++){const name=mesh.skeleton.bones[j.getComponent(v,s)].name;if(/foot|toe/i.test(name)){fw+=w.getComponent(v,s);if(/bip01[ _]?l/i.test(name))left+=w.getComponent(v,s);}}if(fw>.95)soles.push([mesh,v,left>fw/2?0:1]);}});
  const bones=a=>{const list=[];a.root.traverse(o=>{if(o.isBone)list.push(o);});return list;},mine=bones(avatar),theirs=bones(flat);
  // Path length, then walk it at constant ground speed in display frames.
  const pts=[];for(let i=0;i<=2000;i++){const p=at(reverse?1-i/2000:i/2000);pts.push(new THREE.Vector3(p[0],p[1],p[2]));}
  const lengths=[0];for(let i=1;i<pts.length;i++)lengths.push(lengths[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z));
  const total=lengths.at(-1),dt=1/hz,feet=new THREE.Vector3(),sink=[],hover=[],body=[];let support,index=0,jointDrift=0,previous;
  for(let frame=0;;frame++){
    const along=frame*speed*dt;if(along>total)break;
    while(index<pts.length-2&&lengths[index+1]<along)index++;
    const k=(along-lengths[index])/Math.max(1e-9,lengths[index+1]-lengths[index]);feet.lerpVectors(pts[index],pts[index+1],k);
    feet.y=physics.groundAt(feet);
    support=support===undefined?feet.y:smoothSupportHeight(support,feet.y,dt,true);
    if(previous)avatar.root.rotation.y=flat.root.rotation.y=Math.atan2(feet.x-previous.x,feet.z-previous.z);
    previous=feet.clone();
    avatar.root.position.set(feet.x,support,feet.z);flat.root.position.set(feet.x,support,feet.z);
    const onStairs=sample.isStair(feet,feet.y);
    avatar.update(dt,speed,0,.55,undefined,{sample,active:true});flat.update(dt,speed,0);
    avatar.root.updateMatrixWorld(true);
    
    // Per shoe: deepest point inside a tread, and how far its lowest point is above the tread under it.
    const deep=[0,0],gap=[Infinity,Infinity];
    for(const [mesh,v,side] of soles){mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld);const y=sample(point,support);if(y===undefined)continue;deep[side]=Math.max(deep[side],y-point.y);gap[side]=Math.min(gap[side],point.y-y);}
    const lift=avatar.locomotion.stairLift;
    if(onStairs){sink.push(Math.max(deep[0],deep[1]));hover.push(Math.max(0,Math.min(gap[0],gap[1])));}
    body.push([frame*dt,support+lift,onStairs]);
    if(process.env.STAIR_TRACE)trace.push({route,reverse,speed,hz,t:+(frame*dt).toFixed(4),support:+support.toFixed(4),lift:+lift.toFixed(4),sink:+Math.max(deep[0],deep[1]).toFixed(4),hoverL:+gap[0].toFixed(4),hoverR:+gap[1].toFixed(4)});
  }
  // Body height: speed against the travel, worst change of vertical speed between frames, and how often it
  // reverses direction (a smooth climb reverses a handful of times; jitter reverses many times a second).
  let against=0,jolt=0,reversals=0,last=0;const seconds=body.at(-1)[0];
  for(let i=2;i<body.length;i++){const v1=(body[i-1][1]-body[i-2][1])/dt,v2=(body[i][1]-body[i-1][1])/dt;
    against=Math.max(against,reverse?v2:-v2);jolt=Math.max(jolt,Math.abs(v2-v1));
    if(Math.abs(v2)>.02){if(last&&Math.sign(v2)!==last)reversals++;last=Math.sign(v2);}}
  sink.sort((a,b)=>a-b);hover.sort((a,b)=>a-b);const p=(list,q)=>list.length?list[Math.min(list.length-1,Math.floor(list.length*q))]:0;
  rows.push({route,direction:reverse?'down':'up',speed,hz,frames:body.length,sinkP95:p(sink,.95),sinkMax:p(sink,1),hoverMean:hover.reduce((s,v)=>s+v,0)/Math.max(1,hover.length),hoverP95:p(hover,.95),against,jolt,reversalsPerSecond:reversals/seconds,jointDrift});
  avatar.dispose();flat.dispose();
}
physics.dispose();
console.log('route          dir  speed  Hz | shoe inside tread p95/max cm | lowest shoe above tread mean/p95 cm | body against travel m/s | worst frame-to-frame speed change m/s | reversals/s | joints vs flat walk');
for(const r of rows)console.log(`${r.route.padEnd(13)} ${r.direction.padEnd(4)} ${r.speed.toFixed(2)} ${String(r.hz).padStart(4)} | ${cm(r.sinkP95).padStart(5)}/${cm(r.sinkMax).padStart(5)} | ${cm(r.hoverMean).padStart(5)}/${cm(r.hoverP95).padStart(5)} | ${r.against.toFixed(2)} | ${r.jolt.toFixed(3)} | ${r.reversalsPerSecond.toFixed(1)} | ${r.jointDrift<1e-9?'identical':r.jointDrift.toExponential(1)}`);
if(process.env.STAIR_TRACE)fs.writeFileSync(process.env.STAIR_TRACE,JSON.stringify(trace));
