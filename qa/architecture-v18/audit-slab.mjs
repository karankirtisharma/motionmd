import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createCollisionWorld} from '../../src/runtime/interaction/CollisionWorld.ts';
const root=new T.Group(),m=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const urls=[m.collisions.url,...m.collisions.additionalUrls];
for(const url of urls){const b=fs.readFileSync('public'+url);root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene)}
const p=await createCollisionWorld(root,undefined,root),results=[];
const front=y=>-7.28125+Math.sqrt(14.28125**2-(y-19.65)**2);
function height(x,y){const u=x-front(y);return u<0?4.233:u<.3?4.2:u<.6?4.025:u<.9?3.85:3.675}
function walk(label,route,speed){const feet=new T.Vector3(...route[0]);feet.y=p.groundAt(feet);p.place(feet);let g=true,v=0;
 for(const b of route.slice(1)){for(let i=0;i<1800;i++){const d=new T.Vector3(b[0]-feet.x,0,b[2]-feet.z);if(d.length()<.045)break;d.clampLength(0,speed/60);v=g?-.5:Math.max(-16,v-9.81/60);d.y=v/60;g=p.move(d,1/60,feet)}
  if(Math.hypot(feet.x-b[0],feet.z-b[2])>.1||Math.abs(feet.y-b[1])>.21){results.push({label,speed,pass:false,target:b,feet:feet.toArray()});return}}
 results.push({label,speed,pass:true,feet:feet.toArray()});}
const diagonal=[];for(let i=0;i<=50;i++){const t=i/50,x=-1.1+9.9*t,y=11.5+11.3*t;diagonal.push([x,height(x,y),-y])}
const crossings=[diagonal];for(const y of [18.8,20.4,21.6,22.3])crossings.push([[front(y)-.65,4.233,-y],[front(y)+1.4,3.675,-y]]);
for(const speed of [1.38,3.35])for(const [i,route] of crossings.entries()){walk('curved slab route '+i,route,speed);walk('reverse curved slab route '+i,[...route].reverse(),speed)}
let samples=0;
for(const y of [18.8,20.4,21.6,22.3])for(const u of [-1,.15,.45,.75,1.25]){
 const x=front(y)+u,feet=new T.Vector3(x,height(x,y),-y),ground=p.groundAt(feet),onSteps=u>=0&&u<.9;
 results.push({label:'slab support '+x.toFixed(3)+','+y,pass:Math.abs(ground-feet.y)<.035&&(onSteps||p.canStandAt(feet)),ground});samples++;
}
for(const t of [.25,.5,.75]){
 const s=1-t,x=s**3*(-.45)+3*s*s*t*5.7+3*s*t*t*10.95+t**3*10.95,y=s**3*10.8+3*s*s*t*11.7+3*s*t*t*16.4+t**3*22.6;
 results.push({label:'curved outer guard '+t,pass:!p.canStandAt(new T.Vector3(x,height(x,y),-y))});
}
results.push({label:'central atrium remains open',pass:p.groundAt(new T.Vector3(11,4.1,-17))<1});
p.dispose();fs.writeFileSync('qa/architecture-v18/slab-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.pass),'Slab traversal or guard check failed');
