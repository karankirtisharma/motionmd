import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {meshComponents} from './helpers/mesh-components.mjs';
const url='/assets/architecture-v21/founder.glb';
const {root}=await geometryFixture(url), pieces=[];
root.traverse(m=>{
 if(!m.isMesh||m.material.name!=='founder__HF89 | ivory wool boucle upholstery')return;
 for(const c of meshComponents(m)){
  const size=c.box.getSize(new T.Vector3());
  // The four wraparound club shells, not the separate cushions or sofa.
  if(c.box.min.x<7||c.box.max.x>12||c.box.min.y<4.39||size.y<.7||size.y>.9||size.x>1.4)continue;
  const unique=new Map(); for(const p of c.points)unique.set(p.toArray().join(','),p);
  const points=[...unique.values()],support=new Set();
  for(let i=0;i<1024;i++){
   const y=1-2*(i+.5)/1024,r=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5)),d=new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);
   let best=-Infinity,chosen;for(const p of points){const dot=p.dot(d);if(dot>best){best=dot;chosen=p}}support.add(chosen);
  }
  const g=new ConvexGeometry([...support]),p=g.attributes.position,n=g.attributes.normal;
  let maximumSurfaceError=0;
  for(let i=0;i<p.count;i+=3){const normal=new T.Vector3().fromBufferAttribute(n,i),offset=normal.dot(new T.Vector3().fromBufferAttribute(p,i));for(const v of points)maximumSurfaceError=Math.max(maximumSurfaceError,normal.dot(v)-offset);}
  if(maximumSurfaceError>.008)throw Error('Club shell hull exceeds 8 mm source tolerance: '+maximumSurfaceError);
  const vertices=[],indices=[],ids=new Map();for(let i=0;i<p.count;i++){const v=[p.getX(i),p.getY(i),p.getZ(i)],k=v.join(',');let id=ids.get(k);if(id===undefined){id=vertices.length/3;ids.set(k,id);vertices.push(...v)}indices.push(id)}
  pieces.push({name:'HF89 club shell '+pieces.length,min:c.box.min.toArray(),max:c.box.max.toArray(),maximumSurfaceError,vertices,indices});g.dispose();
 }
});
if(pieces.length!==4)throw Error('Expected four source club shells');
console.log(JSON.stringify(pieces.map(({name,min,max,maximumSurfaceError,indices})=>({name,min,max,maximumSurfaceError,triangles:indices.length/3})),null,2));
if(process.argv.includes('--write'))fs.writeFileSync('src/runtime/interaction/clubCollision.ts',`// Static club-chair outer envelopes. These chairs have no sitting interaction.
// Reproduce: node qa/generate-club-collision.mjs --write
// Source SHA-256: ${createHash('sha256').update(fs.readFileSync('public'+url)).digest('hex')}
export const clubCollision = ${JSON.stringify(pieces)} as const;
`);
