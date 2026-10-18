import fs from 'node:fs';
import {Vector3} from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {repairArchitecturalJoins} from '../src/runtime/rendering/architecturalJoins.ts';

// Retain the shipped light UVs; export only the original founder floor receiver.
const work=process.argv[2];
if(!work)throw Error('Usage: node qa/export-founder-floor-bake.mjs EXTERNAL_WORK_DIRECTORY');
fs.mkdirSync(work,{recursive:true});
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const {root}=await geometryFixture(manifest.chunks.find(c=>c.id==='founder').url);
repairArchitecturalJoins(root);
const data={positions:[],uv:[],index:[]};
const protectedUV=[];
root.traverse(o=>{
 if(!o.isMesh)return;
 const entry=manifest.materials.find(m=>m.name===o.material.name);
 if(entry?.atlasId!=='founder-architecture')return;
 const g=o.geometry,p=g.attributes.position,u=g.attributes.uv1,vertices=[];
 for(let i=0;i<p.count;i++)vertices.push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));
 const remap=new Map();
 for(let i=0;i<g.index.count;i+=3){
  const ids=[0,1,2].map(j=>g.index.getX(i+j));
  const receiver=o.material.name==='founder__FR82 | polished ivory large format stone'&&ids.every(k=>{const v=vertices[k];return v.x>=3.6149&&v.x<=13.0101&&v.z>=-10.7564&&v.z<=-2.3969&&v.y>=4.1999&&v.y<=4.2301;});
  if(!receiver){for(const k of ids)protectedUV.push(u.getX(k),1-u.getY(k));continue;}
  for(const k of ids){
   if(!remap.has(k)){remap.set(k,data.positions.length/3);const v=vertices[k];data.positions.push(v.x,-v.z,v.y);data.uv.push(u.getX(k),1-u.getY(k));}
   data.index.push(remap.get(k));
  }
 }
});
if(data.index.length!==36)throw Error(`Expected the 12 original floor triangles; found ${data.index.length/3}`);
fs.writeFileSync(`${work}/floor.json`,JSON.stringify(data));
fs.writeFileSync(`${work}/protected-uv.bin`,Buffer.from(new Float32Array(protectedUV).buffer));
console.log({vertices:data.positions.length/3,triangles:data.index.length/3});
