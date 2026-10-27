import * as T from 'three';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
const {root}=await geometryFixture('/assets/architecture-v21/founder.glb');
const out=[], hulls=[];
root.traverse(mesh=>{
 if(!mesh.isMesh||!/^founder__FC9[12] \|.*(?:fine ivory leather|brushed|gold)/i.test(mesh.material.name))return;
 const pos=mesh.geometry.attributes.position,ix=mesh.geometry.index,representatives=new Map(),p=new T.Vector3();
 const ids=new Int32Array(pos.count),parent=[];
 for(let i=0;i<pos.count;i++) {p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);const key=[p.x,p.y,p.z].map(v=>Math.round(v*1e5)).join(',');let id=representatives.get(key);if(id===undefined){id=parent.length;parent.push(id);representatives.set(key,id)}ids[i]=id;}
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
 for(let i=0;i<ix.count;i+=3){join(ids[ix.getX(i)],ids[ix.getX(i+1)]);join(ids[ix.getX(i)],ids[ix.getX(i+2)])}
 const components=new Map();
 for(let i=0;i<pos.count;i++){const id=find(ids[i]);let item=components.get(id);if(!item){item={box:new T.Box3(),count:0,points:[]};components.set(id,item)}item.box.expandByPoint(p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld));item.count++;item.points.push(p.clone())}
 for (const item of components.values()) {
  if (item.box.min.y < 4.7 || item.box.max.y-item.box.min.y < .25 || item.count<1000) continue;
  const support=new Set();
  for(let i=0;i<384;i++) {
   const y=1-2*(i+.5)/384,r=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5));
   const d=new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);let best=-Infinity,chosen;
   for(const point of item.points){const dot=point.dot(d);if(dot>best){best=dot;chosen=point}}
   support.add(chosen);
  }
  const geometry=new ConvexGeometry([...support]), positions=geometry.attributes.position, normals=geometry.attributes.normal;
  let maximumSurfaceError=0;
  for(let i=0;i<positions.count;i+=3) {
   const n=new T.Vector3().fromBufferAttribute(normals,i),v=new T.Vector3().fromBufferAttribute(positions,i),offset=n.dot(v);
   for(const point of item.points)maximumSurfaceError=Math.max(maximumSurfaceError,n.dot(point)-offset);
  }
  if(maximumSurfaceError>.008)throw Error('Collision envelope exceeds 8 mm source tolerance');
  const vertices=[], indices=[], vertexIds=new Map();
  for(let i=0;i<positions.count;i++){const v=[positions.getX(i),positions.getY(i),positions.getZ(i)];const key=v.join(',');let id=vertexIds.get(key);if(id===undefined){id=vertices.length/3;vertices.push(...v);vertexIds.set(key,id)}indices.push(id)}
  hulls.push({name:item.box.min.y>5.4?'headrest':'backrest',maximumSurfaceError,vertices,indices});geometry.dispose();
 }
 out.push({material:mesh.material.name,vertices:pos.count,components:[...components.values()].sort((a,b)=>b.count-a.count).slice(0,15).map(v=>({count:v.count,min:v.box.min.toArray(),max:v.box.max.toArray()}))});
});
if(process.argv.includes('--write')) {
 const sourceSHA256=createHash('sha256').update(fs.readFileSync('public/assets/architecture-v21/founder.glb')).digest('hex');
 fs.writeFileSync('src/runtime/interaction/chairCollision.ts',`// Source-derived convex envelopes of the two omitted ivory leather components.
// Reproduce: node qa/inspect-chair-collision.mjs --write
// Founder GLB SHA-256: ${sourceSHA256}
export const chairCollision = ${JSON.stringify(hulls)} as const;
`);
}
console.log(JSON.stringify({components:out,hulls:hulls.map(h=>({name:h.name,maximumSurfaceError:h.maximumSurfaceError,vertices:h.vertices.length/3,triangles:h.indices.length/3}))},null,2));
