import fs from 'node:fs';import {createHash} from 'node:crypto';import * as T from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';import {meshComponents} from './helpers/mesh-components.mjs';
const url='/assets/architecture-v19/shell.glb', {root}=await geometryFixture(url),pieces=[];
root.traverse(m=>{if(!m.isMesh||m.material.name!=='shell__EH54 | scanned cream limestone panels')return;
for(const c of meshComponents(m)){if(c.box.max.y>.06||c.box.min.y<-.36)continue;
let volume=0;for(let i=0;i<c.points.length;i+=3)volume+=c.points[i].dot(c.points[i+1].clone().cross(c.points[i+2]))/6;
const vertices=[],indices=[],ids=new Map();for(const p of c.points){const k=p.toArray().join(',');let id=ids.get(k);if(id===undefined){id=vertices.length/3;ids.set(k,id);vertices.push(...p.toArray())}indices.push(id)}
if(volume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
const entry=c.box.min.x<-5;
pieces.push({name:entry?'entry steps':c.box.min.x>20?'east terrace':c.box.max.z<-36?'south return':c.box.min.z>-3?'north return':c.box.max.z<-24?'west studio terrace':'west lounge terrace',min:c.box.min.toArray(),max:c.box.max.toArray(),sourceMeshName:m.name,sourceVertexIndices:[...new Set(c.triangles)],sourceTriangleOffsets:c.offsets,repairWinding:volume<0,existingCollider:entry,vertices,indices});
}});
if(pieces.length!==6)throw Error('Unexpected source topology');
const hash=createHash('sha256').update(fs.readFileSync('public'+url)).digest('hex');
fs.writeFileSync('src/runtime/interaction/exteriorCollision.ts',`// Exact source components, not bounding-box substitutes. Source SHA-256: ${hash}\n// Reproduce: node qa/generate-exterior-collision.mjs\nexport const exteriorCollision = ${JSON.stringify(pieces)} as const;\n`);
console.log(pieces.map(({name,vertices,indices,repairWinding})=>({name,vertices:vertices.length/3,triangles:indices.length/3,repairWinding})));
