import fs from 'node:fs';import * as T from 'three';import {geometryFixture} from './helpers/geometry-fixture.mjs';import {meshComponents} from './helpers/mesh-components.mjs';
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json')),boxes=[],pieces=[];
for(const u of[manifest.collisions.url,...manifest.collisions.additionalUrls]){const {root}=await geometryFixture(u);root.traverse(m=>{if(m.isMesh)boxes.push({name:m.userData.sourceName??m.name,box:new T.Box3().setFromObject(m)})})}
for(const chunk of manifest.chunks){const {root}=await geometryFixture(chunk.url);root.traverse(m=>{if(!m.isMesh||!/(?:^|__)Low iron glass \| 12 mm$/.test(m.material.name))return;
for(const c of meshComponents(m)){
 const size=c.box.getSize(new T.Vector3());if(size.y<.6||Math.max(size.x,size.z)<.5||Math.min(size.x,size.z)>.035)continue;
 if(boxes.some(b=>b.box.min.distanceTo(c.box.min)<.06&&b.box.max.distanceTo(c.box.max)<.06))continue;
 if(pieces.some(p=>new T.Vector3(...p.min).distanceTo(c.box.min)<.005&&new T.Vector3(...p.max).distanceTo(c.box.max)<.005))continue;
 const vertices=[],indices=[],ids=new Map();for(const p of c.points){const k=p.toArray().join(',');let id=ids.get(k);if(id===undefined){id=vertices.length/3;ids.set(k,id);vertices.push(...p.toArray())}indices.push(id)}
 pieces.push({name:chunk.id+' glazing '+pieces.length,min:c.box.min.toArray(),max:c.box.max.toArray(),vertices,indices});
}})}
console.log(JSON.stringify(pieces.map(({name,min,max,indices})=>({name,min,max,triangles:indices.length/3})),null,2));
if(process.argv.includes('--write'))fs.writeFileSync('src/runtime/interaction/facadeCollision.ts',`// Source vertical architectural panes omitted by the collision export. Exact geometry.\n// Reproduce: node qa/generate-facade-collision.mjs --write\nexport const facadeCollision = ${JSON.stringify(pieces)} as const;\n`);
