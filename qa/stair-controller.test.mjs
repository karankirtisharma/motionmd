import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
import { CinematicPath, CINEMATIC_HANDOFF } from '../src/runtime/rendering/cinematic.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
delete manifest.lift; // This fixture isolates existing avatar/camera tests; lift has its own integration suite.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = relative => ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const movementURL = new URL('../src/runtime/interaction/movement.ts', import.meta.url).href;
const rocketboxSource = transpile('../src/runtime/interaction/RocketboxAvatar.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`);
const { createRocketboxAvatar } = await import(dataModule(rocketboxSource));

async function load(url, omitImages = false) {
  assert.ok(url.startsWith('/assets/'));
  let bytes = fs.readFileSync(new URL(`../public${url}`, import.meta.url));
  if (omitImages) {
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
    delete json.images; delete json.textures; delete json.samplers;
    json.materials = json.materials.map(material => ({ name: material.name }));
    let encoded = Buffer.from(JSON.stringify(json));
    encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - length, 8);
    header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    bytes = Buffer.concat([header, encoded, bytes.subarray(20 + length)]);
  }
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}

// Replace only asset/browser adapters. All controller state, camera math, actual
// source collision meshes, Rocketbox skin/animation and fixed-step simulation run.
const fixtureKey = '__mdControllerCameraQA';
const controllerSource = transpile('../src/runtime/interaction/InteractionController.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './Workstation'", `from ${JSON.stringify(new URL('../src/runtime/interaction/Workstation.ts', import.meta.url).href)}`)
  .replace("from './StairSurfaces'", `from ${JSON.stringify(new URL('../src/runtime/interaction/StairSurfaces.ts', import.meta.url).href)}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './GlassLift'", `from ${JSON.stringify(new URL('../src/runtime/interaction/GlassLift.ts', import.meta.url).href)}`)
  .replace("from './CollisionWorld'", `from ${JSON.stringify(dataModule(`export const createCollisionWorld=async()=>globalThis.${fixtureKey}.physics;`))}`)
  .replace("from './Avatar'", `from ${JSON.stringify(dataModule(`export const loadAvatar=async()=>globalThis.${fixtureKey}.avatar;`))}`)
  .replace("from '../presentation/PresentationScreen'", `from ${JSON.stringify(dataModule(`export const createPresentationScreen=()=>globalThis.${fixtureKey}.screen;`))}`)
  .replace("from '../rendering/assets'", `from ${JSON.stringify(new URL('../src/runtime/rendering/assets.ts', import.meta.url).href)}`);
const { createInteractionController } = await import(dataModule(controllerSource));



test('full-scene stair controller preserves forward progress and running through ascent and descent',async context=>{
 const collisionRoot=new THREE.Group(),scene=new THREE.Scene();
 for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])collisionRoot.add((await load(url)).scene);
 for(const id of ['v13','v18','v19','entrance','shell'])scene.add((await load(manifest.chunks.find(c=>c.id===id).url,true)).scene);
 const prior={document:globalThis.document,window:globalThis.window,matchMedia:globalThis.matchMedia};
 const reports=[];
 try{for(const routeType of ['rounded','spiral','entrance'])for(const sprint of [false,true])for(const reverse of [false,true]){
  const physics=await createCollisionWorld(scene,undefined,collisionRoot,[],manifest.explorationBounds);
  const avatar=createRocketboxAvatar(await load(manifest.character.url,true));
  const original=physics.speedForClearance.bind(physics);let requested=0,allowed=0,queries=0;
  physics.speedForClearance=(direction,speed)=>{const result=original(direction,speed);requested+=speed;allowed+=result;queries++;return result;};
  globalThis.document={pointerLockElement:null,addEventListener(){},removeEventListener(){},exitPointerLock(){}};
  globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.matchMedia=()=>({matches:false});
  globalThis[fixtureKey]={physics,avatar};
  const camera=new THREE.PerspectiveCamera(54,16/9,.1,1800);
  const controller=await createInteractionController({scene,camera,canvas:{addEventListener(){},removeEventListener(){},focus(){}},manifest:{...manifest,screen:undefined}});
  try{
   let points;
   if(routeType==='rounded')points=Array.from({length:36},(_,i)=>[8.3-i*.09,3.675,-23]);
   else if(routeType==='entrance')points=Array.from({length:29},(_,i)=>[-7+i*.09,-.355,-17.1]);
   else points=Array.from({length:81},(_,i)=>{const a=(60+315/46)-(315+315/46)*i/80,r=a*Math.PI/180;return[18.76+1.55*Math.cos(r),3.67/24*((60-a)/(315/23)+.5),-(20.2+1.55*Math.sin(r))]});
   if(reverse)points.reverse();
   // Match the rounded browser spawn and facing; remaining routes face their first segment.
   const initial=new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0]));
   const yaw=Math.atan2(-initial.x,-initial.z);
   controller.enterExplore(undefined,{position:points[0],yaw});for(let i=0;i<60;i++)controller.update(1/60);
   let steps=0,maximumRun=0,maximumAnimationSpeed=0;
   for(const [index,target]of points.slice(1).entries()){
    let reached=false;
    for(let i=0;i<120;i++){
     const p=controller.diagnostics.state.feet,dx=target[0]-p[0],dz=target[2]-p[2],distance=Math.hypot(dx,dz);
     if(distance<.045){reached=true;break;}
     controller.setVirtualInput((Math.cos(yaw)*dx-Math.sin(yaw)*dz)/distance,(-Math.sin(yaw)*dx-Math.cos(yaw)*dz)/distance,0,0,sprint);
     controller.update(1/60);steps++;maximumRun=Math.max(maximumRun,avatar.locomotion.weights.run);maximumAnimationSpeed=Math.max(maximumAnimationSpeed,avatar.locomotion.speed);
    }
    assert.ok(reached,`${routeType} ${sprint?'sprint':'walk'} reverse=${reverse}: stuck at waypoint${index}, feet=${controller.diagnostics.state.feet}`);
   }
   const seconds=steps/60,budget=routeType==='spiral'?(sprint?5.5:12):(sprint?3:5.5);
   assert.ok(seconds<budget,`${routeType} must make continuous progress: ${seconds}s`);
   assert.ok(allowed/requested>.9,`${routeType}: floor/landing must not be treated as an approaching wall (${allowed/requested})`);
   // The tight spiral legitimately blends walk/run to the achieved curved path speed.
   if(sprint)assert.ok(maximumRun>(routeType==='spiral'?.35:.75),`${routeType}: sprint must reach the source run animation, got ${maximumRun}`);
   reports.push({routeType,sprint,reverse,seconds,allowedRatio:allowed/requested,maximumRun,maximumAnimationSpeed,feet:controller.diagnostics.state.feet});
  }finally{controller.dispose()}
 }
 context.diagnostic(JSON.stringify(reports));
 }finally{Object.assign(globalThis,prior);delete globalThis[fixtureKey]}
});
