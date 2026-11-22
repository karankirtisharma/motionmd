import fs from 'node:fs';
import * as THREE from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const rows=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
for(const chunk of manifest.chunks){const root=(await geometryFixture(chunk.url)).root;root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,n=(index?.count??p.count)/3;let area=0;
  for(let i=0;i<n;i++){const ia=index?index.getX(i*3):i*3,ib=index?index.getX(i*3+1):i*3+1,ic=index?index.getX(i*3+2):i*3+2;
    a.fromBufferAttribute(p,ia).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,ib).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,ic).applyMatrix4(mesh.matrixWorld);
    area+=b.sub(a).cross(c.sub(a)).length()/2;}
  const m=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(x=>x?.name).join('+');
  rows.push({chunk:chunk.id,name:mesh.userData.sourceName??mesh.name,material:m,tris:n,area,mean:area/n});
});}
rows.sort((x,y)=>y.mean-x.mean);
const pick=process.argv[2]?new RegExp(process.argv[2],'i'):null;
let cumulative=0;
for(const r of rows){cumulative+=r.tris;if(pick?pick.test(r.name+' '+r.material):true)console.log(`${r.mean.toFixed(4).padStart(9)} m²/tri ${String(r.tris).padStart(8)} tris ${r.area.toFixed(0).padStart(6)} m²  cum ${String(cumulative).padStart(9)}  ${r.chunk} | ${r.material.slice(0,70)}`);}
console.log('meshes',rows.length);
