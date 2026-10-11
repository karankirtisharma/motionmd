import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createCollisionWorld} from '../../src/runtime/interaction/CollisionWorld.ts';
const root=new T.Group(),base='public/assets/architecture-v16/collision/';
for(const name of fs.readdirSync(base).filter(n=>n.endsWith('.glb'))){const b=fs.readFileSync(base+name);root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene)}
const p=await createCollisionWorld(root,undefined,root),results=[];
function height(x){return x<6?4.233:x<6.3?4.2:x<6.6?4.025:x<6.9?3.85:3.675}
function walk(label,route,speed){const feet=new T.Vector3(...route[0]);feet.y=p.groundAt(feet);p.place(feet);let g=true,v=0;
 for(const b of route.slice(1)){for(let i=0;i<1800;i++){const d=new T.Vector3(b[0]-feet.x,0,b[2]-feet.z);if(d.length()<.045)break;d.clampLength(0,speed/60);v=g?-.5:Math.max(-16,v-9.81/60);d.y=v/60;g=p.move(d,1/60,feet)}
  if(Math.hypot(feet.x-b[0],feet.z-b[2])>.1||Math.abs(feet.y-b[1])>.21){results.push({label,speed,pass:false,target:b,feet:feet.toArray()});return}}
 results.push({label,speed,pass:true,feet:feet.toArray()});}
const diagonal=[];for(let i=0;i<=40;i++){const t=i/40,x=-1.1+8.6*t;diagonal.push([x,height(x),-(11.5+11.3*t)])}
const crossings=[diagonal];for(const y of [21.6,22.3,23.3,24.1])crossings.push([[5.5,4.233,-y],[7.4,3.675,-y]]);
for(const speed of [1.38,3.35])for(const [i,route] of crossings.entries()){walk('slab route '+i,route,speed);walk('reverse slab route '+i,[...route].reverse(),speed)}
let samples=0;
for(const [x,y] of [[0,13],[1,15],[2,17],[3,19],[4,20],[5.5,21],[6.15,22],[6.45,22],[6.75,22],[7.3,22.5]]){
 // A raw capsule overlap at a 30 cm tread can touch the next riser. The
 // controller's step resolver is exercised by the bidirectional routes above.
 const feet=new T.Vector3(x,height(x),-y),ground=p.groundAt(feet),onSteps=x>=6&&x<6.9;
 results.push({label:'solid slab '+x+','+y,pass:Math.abs(ground-feet.y)<.035&&(onSteps||p.canStandAt(feet)),ground});samples++;
}
for(const t of [.25,.5,.75]){
 const s=1-t,x=s**3*(-.45)+3*s*s*t*3.2+3*s*t*t*8.95+t**3*8.95,y=s**3*10.8+3*s*s*t*12.8+3*s*t*t*19.2+t**3*22.6;
 results.push({label:'curved outer guard '+t,pass:!p.canStandAt(new T.Vector3(x,height(x),-y))});
}
results.push({label:'central atrium remains open',pass:p.groundAt(new T.Vector3(11,4.1,-17))<1});
p.dispose();fs.writeFileSync('qa/architecture-v16/slab-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.pass),'Slab traversal or guard check failed');
