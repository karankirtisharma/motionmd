// What would a reduced mirror reflection draw? Per chunk: meshes/triangles by distance from the mirror plane and surface scale.
import fs from 'node:fs';
import * as THREE from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const MIRROR_Z=-9.35,FAR=Number(process.argv[2]??14),BROAD=Number(process.argv[3]??0.002);
const rows=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
for(const chunk of manifest.chunks){const root=(await geometryFixture(chunk.url)).root;root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,n=(index?.count??p.count)/3;let area=0;const box=new THREE.Box3();
  for(let i=0;i<n;i++){const ia=index?index.getX(i*3):i*3,ib=index?index.getX(i*3+1):i*3+1,ic=index?index.getX(i*3+2):i*3+2;
    a.fromBufferAttribute(p,ia).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,ib).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,ic).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);area+=b.sub(a).cross(c.sub(a)).length()/2;}
  rows.push({chunk:chunk.id,material:(Array.isArray(mesh.material)?mesh.material[0]:mesh.material)?.name??'',tris:n,mean:area/n,minZ:box.min.z,maxZ:box.max.z});
});}
// Hall side of the pane: the reflection shows what lies at z < mirror. Distance = gap between the pane and the nearest part of the mesh.
for(const side of ['hall','founder']){
  const seen=rows.filter(r=>side==='hall'?r.minZ<MIRROR_Z:r.maxZ>MIRROR_Z);
  const gap=r=>side==='hall'?Math.max(0,MIRROR_Z-r.maxZ):Math.max(0,r.minZ-MIRROR_Z);
  const keep=seen.filter(r=>gap(r)<FAR||r.mean>=BROAD),drop=seen.filter(r=>!(gap(r)<FAR||r.mean>=BROAD));
  const sum=list=>`${list.length} meshes ${(list.reduce((s,r)=>s+r.tris,0)/1e6).toFixed(2)}M tris`;
  console.log(`\n${side} side (far ≥ ${FAR} m, broad ≥ ${BROAD} m²/tri): candidates ${sum(seen)} | kept ${sum(keep)} | dropped ${sum(drop)}`);
  const by=new Map();for(const r of drop){const t=by.get(r.chunk)??{n:0,t:0};t.n++;t.t+=r.tris;by.set(r.chunk,t);}
  console.log('  dropped by chunk:',[...by].map(([k,v])=>`${k} ${v.n} meshes ${(v.t/1e6).toFixed(2)}M`).join(' | '));
  const kb=new Map();for(const r of keep){const t=kb.get(r.chunk)??{n:0,t:0};t.n++;t.t+=r.tris;kb.set(r.chunk,t);}
  console.log('  kept by chunk:   ',[...kb].map(([k,v])=>`${k} ${v.n} meshes ${(v.t/1e6).toFixed(2)}M`).join(' | '));
  console.log('  biggest kept:',keep.sort((x,y)=>y.tris-x.tris).slice(0,8).map(r=>`${r.chunk}/${r.material.replace(/^.*?__/,'').slice(0,34)} ${(r.tris/1e3).toFixed(0)}k gap ${gap(r).toFixed(0)}m`).join(' | '));
}
const z=new Map();for(const r of rows){const t=z.get(r.chunk)??[1e9,-1e9];t[0]=Math.min(t[0],r.minZ);t[1]=Math.max(t[1],r.maxZ);z.set(r.chunk,t);}
console.log('\nchunk z ranges:',[...z].map(([k,v])=>`${k} ${v[0].toFixed(0)}..${v[1].toFixed(0)}`).join(' | '));
