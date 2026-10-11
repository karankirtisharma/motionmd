import fs from 'node:fs';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createCollisionWorld} from '../../src/runtime/interaction/CollisionWorld.ts';
const root=new T.Group(),base='public/assets/architecture-v14/collision/';
for(const name of fs.readdirSync(base).filter(n=>n.endsWith('.glb'))){const b=fs.readFileSync(base+name);root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene)}
const p=await createCollisionWorld(root,undefined,root),results=[];
function walk(label,route,speed){const feet=new T.Vector3(...route[0]);feet.y=p.groundAt(feet);p.place(feet);let g=true,v=0;for(let k=1;k<route.length;k++){const b=route[k];for(let i=0;i<1800;i++){const d=new T.Vector3(b[0]-feet.x,0,b[2]-feet.z);if(d.length()<.045)break;d.clampLength(0,speed/60);v=g?-.5:Math.max(-16,v-9.81/60);d.y=v/60;g=p.move(d,1/60,feet)}if(Math.hypot(feet.x-b[0],feet.z-b[2])>.1||Math.abs(feet.y-b[1])>.2){results.push({label,speed,pass:false,k,target:b,feet:feet.toArray()});return}}results.push({label,speed,pass:true,feet:feet.toArray()})}
const corner=[[-1.2,4.233,-12],[-1.2,4.233,-19.14]];
for(let i=1;i<=48;i++){const a=Math.PI-Math.PI/2*i/48;corner.push([3.6+4.75*Math.cos(a),4.233,-(19.14+4.75*Math.sin(a))])}
corner.push([5.5,4.23,-24.1],[7.3,3.675,-24.1],[16,3.675,-24.1],[18.6,3.67,-24.1],[18.6,3.67,-23.2],[18.6,3.67,-21.9]);
const stair=[];for(let i=0;i<=160;i++){const a=(60+315/23/2)-(315+315/23/2)*i/160,r=a*Math.PI/180;stair.push([18.76+1.55*Math.cos(r),3.67/24*((60-a)/(315/23)+.5),-(20.2+1.55*Math.sin(r))])}
for(const speed of [1.38,3.35]){walk('perimeter to landing',corner,speed);walk('landing to perimeter',[...corner].reverse(),speed);walk('spiral up',stair,speed);walk('spiral down',[...stair].reverse(),speed)}
for(const [label,feet] of [['former studio shortcut',[9.4,3.675,-22.6]],['former founder shortcut',[9.4,4.23,-10.985]],['perimeter glass',[-.45,4.233,-15]]])results.push({label,pass:!p.canStandAt(new T.Vector3(...feet))});
console.log(JSON.stringify(results,null,2));fs.writeFileSync('../architecture-v14/route-audit.json',JSON.stringify(results,null,2));p.dispose();
