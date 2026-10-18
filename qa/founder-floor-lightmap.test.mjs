import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {FloatType, Vector3} from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {geometryFixture} from './helpers/geometry-fixture.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const floorMaterial='founder__FR82 | polished ivory large format stone';
const oldURL='/assets/material-v20/lighting/founder-architecture-indirect.exr';
function readEXR(url){
 const bytes=fs.readFileSync(new URL(`../public${url}`,import.meta.url));
 return new EXRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}

test('targeted founder floor lighting preserves the rest of the decoded atlas',async()=>{
 const entry=manifest.materials.find(m=>m.name===floorMaterial);
 assert.equal(entry.lightMap,'/assets/surface-v23/lighting/founder-floor-indirect.exr');
 const previous=readEXR(oldURL),current=readEXR(entry.lightMap);
 assert.equal(current.width,previous.width);assert.equal(current.height,previous.height);
 assert.equal(current.data.length,previous.data.length);
 const {width:w,height:h}=current;
 const allowed=new Uint8Array(w*h);
 const {root}=await geometryFixture(manifest.chunks.find(c=>c.id==='founder').url);
 let triangles=0;
 root.traverse(o=>{
  if(!o.isMesh||o.material.name!==floorMaterial)return;
  const g=o.geometry,p=g.attributes.position,u=g.attributes.uv1;
  for(let i=0;i<g.index.count;i+=3){
   const ids=[0,1,2].map(j=>g.index.getX(i+j));
   const positions=ids.map(k=>new Vector3().fromBufferAttribute(p,k).applyMatrix4(o.matrixWorld));
   if(!positions.every(v=>v.x>=3.6149&&v.x<=13.0101&&v.z>=-10.7564&&v.z<=-2.3969&&v.y>=4.1999&&v.y<=4.2301))continue;
   triangles++;
   const uv=ids.map(k=>[u.getX(k)*w,(1-u.getY(k))*h]);
   // Include the documented four-texel filter border and pixel-center rounding.
   const x0=Math.max(0,Math.floor(Math.min(...uv.map(v=>v[0])))-5);
   const x1=Math.min(w-1,Math.ceil(Math.max(...uv.map(v=>v[0])))+5);
   const y0=Math.max(0,Math.floor(Math.min(...uv.map(v=>v[1])))-5);
   const y1=Math.min(h-1,Math.ceil(Math.max(...uv.map(v=>v[1])))+5);
   for(let y=y0;y<=y1;y++)allowed.fill(1,y*w+x0,y*w+x1+1);
  }
 });
 assert.equal(triangles,12);
 let changed=0;
 const stride=current.data.length/(w*h);
 for(let i=0;i<allowed.length;i++){
  let different=false;
  for(let c=0;c<3;c++){
   const a=previous.data[i*stride+c],b=current.data[i*stride+c];
   assert.ok(Number.isFinite(b)&&b>=0);
   if(a!==b)different=true;
  }
  if(different){assert.ok(allowed[i],`Changed unrelated atlas texel ${i%w},${Math.floor(i/w)}`);changed++;}
 }
 assert.ok(changed>100000&&changed<=207960,`Unexpected replacement size ${changed}`);
 for(const other of manifest.materials.filter(m=>m.atlasId==='founder-architecture'&&m.name!==floorMaterial))assert.equal(other.lightMap,oldURL);
});
