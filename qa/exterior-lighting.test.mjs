import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const release=process.env.MD_EXTERIOR_LIGHTING_DIR??'public/assets/exterior-finish-v24';
const readReleaseAsset=url=>fs.readFileSync(path.join(release,path.basename(url)));
import * as T from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {repairFounderExteriorWinding,exteriorReceiverSignature,splitExteriorLightingReceivers} from '../src/runtime/rendering/exteriorLighting.ts';
import {founderExteriorSource} from '../src/runtime/rendering/exteriorLightingGeometry.ts';
import {asPhysicalNodeMaterial} from '../src/runtime/rendering/BakedPhysicalMaterial.ts';
import {vec3} from 'three/tsl';
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const founderURL=manifest.chunks.find(c=>c.id==='founder').url;

test('founder exterior winding points upward without modifying positions or texture coordinates',async()=>{
 const {root}=await geometryFixture(founderURL),m=root.getObjectByName(founderExteriorSource.mesh),g=m.geometry;
 const attrs=Object.fromEntries(['position','uv','uv1'].filter(k=>g.attributes[k]).map(k=>[k,g.attributes[k].array.slice()]));
 assert.equal(repairFounderExteriorWinding(root),344);assert.equal(repairFounderExteriorWinding(root),0);
 for(const [k,v]of Object.entries(attrs))assert.deepEqual(g.attributes[k].array,v);
 const p=g.attributes.position,i=g.index,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let top=0;
 for(const off of founderExteriorSource.triangleOffsets){a.fromBufferAttribute(p,i.getX(off)).applyMatrix4(m.matrixWorld);b.fromBufferAttribute(p,i.getX(off+1)).applyMatrix4(m.matrixWorld);c.fromBufferAttribute(p,i.getX(off+2)).applyMatrix4(m.matrixWorld);
  if(Math.abs(a.y)+Math.abs(b.y)+Math.abs(c.y)<1e-5){assert.ok(b.sub(a).cross(c.sub(a)).y>=0);top++;}
 }
 assert.ok(top>0);
});

test('receiver split conserves triangles, preserves source attributes, and rejects stale metadata before mutation',async()=>{
 const {root}=await geometryFixture(founderURL);repairFounderExteriorWinding(root);const m=root.getObjectByName(founderExteriorSource.mesh),g=m.geometry;
 const offsets=[...founderExteriorSource.triangleOffsets],before=g.index.array.slice(),count=before.length;
 const r={name:'test receiver',sourceMesh:m.name,material:m.material.name,triangleOffsets:offsets,signature:exteriorReceiverSignature(m,offsets),uvOffset:0,uvCount:offsets.length*6};
 const uvs=new Float32Array(r.uvCount).fill(.5),meta={atlas:'test',uv:'test',size:[2,2],receivers:[r]};
 assert.throws(()=>splitExteriorLightingReceivers(root,{...meta,receivers:[{...r,signature:'stale'}]},uvs),/mismatch/);assert.deepEqual(g.index.array,before);
 const [out]=splitExteriorLightingReceivers(root,meta,uvs);assert.equal(g.index.count+out.geometry.attributes.position.count,count);
 const ids=offsets.flatMap(o=>[before[o],before[o+1],before[o+2]]);
 for(const [name,a]of Object.entries(g.attributes))for(let k=0;k<ids.length;k++)for(let axis=0;axis<a.itemSize;axis++)assert.equal(out.geometry.attributes[name].getComponent(k,axis),a.getComponent(ids[k],axis),name);
 assert.deepEqual(out.geometry.attributes.uv2.array,uvs);
});

test('baked physical conversion retains custom stone nodes and reflection roughness',()=>{
 const original=asPhysicalNodeMaterial(new T.MeshStandardMaterial(),true);original.colorNode=vec3(.7);original.normalNode=vec3(0,1,0);original.roughnessNode=vec3(.5);original.roughness=.47;original.userData.sourceStone=true;
 const next=asPhysicalNodeMaterial(original,true);
 for(const key of ['colorNode','normalNode','roughnessNode','roughness'])assert.equal(next[key],original[key]);
 assert.equal(next.userData.sourceStone,true);assert.notEqual(next.userData,original.userData);
 original.dispose();next.dispose();
});

test('published exterior lighting matches final source geometry and preserves every triangle',async()=>{
 const {repairExteriorWinding,repairExteriorOverlap,repairExteriorGroove}=await import('../src/runtime/rendering/exteriorSurfaces.ts');
 const {repairEntranceApron}=await import('../src/runtime/rendering/entranceApron.ts');
 const root=new T.Group();for(const c of manifest.chunks.filter(c=>['entrance','shell','founder','studio','lounge'].includes(c.id)))root.add((await geometryFixture(c.url)).root);
 repairExteriorWinding(root);repairExteriorOverlap(root);repairExteriorGroove(root);repairEntranceApron(root);repairFounderExteriorWinding(root);root.updateMatrixWorld(true);
 const meta=JSON.parse(readReleaseAsset('lighting.json')),b=readReleaseAsset(meta.uv),uvs=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 assert.equal(meta.receivers.length,6);assert.equal(uvs.length,meta.receivers.reduce((sum,r)=>sum+r.uvCount,0));
 for(const v of uvs)assert.ok(Number.isFinite(v)&&v>=0&&v<=1,'finite atlas coordinates');
 let microscopicFacets=0;
 for(const r of meta.receivers){const mesh=root.getObjectByName(r.sourceMesh),p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let j=0;j<r.triangleOffsets.length;j++){const i=r.uvOffset+j*6,a=(uvs[i+2]-uvs[i])*(uvs[i+5]-uvs[i+1])-(uvs[i+4]-uvs[i])*(uvs[i+3]-uvs[i+1]);if(Math.abs(a)>1e-15)continue;
   // Two 0.83-micron cut facets are narrower than Float32 UV precision. They
   // legitimately sample one sub-texel strip; visible faces must have UV area.
   const off=r.triangleOffsets[j],v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index.getX(off+k)).applyMatrix4(mesh.matrixWorld)),longest=Math.max(v[0].distanceTo(v[1]),v[1].distanceTo(v[2]),v[2].distanceTo(v[0])),area=v[1].sub(v[0]).cross(v[2].sub(v[0])).length()/2;
   assert.ok(area>0&&area<1e-8&&2*area/longest<=1e-6,'only nonzero source facets ≤1 micron wide may collapse in UV precision');
   assert.equal(r.sourceMesh,'Box_Complete_foundation001_1');assert.ok(++microscopicFacets<=2,'only the two measured final groove-cut facets');
   assert.ok(Math.max(uvs[i],uvs[i+2],uvs[i+4])-Math.min(uvs[i],uvs[i+2],uvs[i+4])<1/meta.size[0]);
   assert.ok(Math.max(uvs[i+1],uvs[i+3],uvs[i+5])-Math.min(uvs[i+1],uvs[i+3],uvs[i+5])<1/meta.size[1]);
  }
 }
 let before=0;root.traverse(o=>{if(o.isMesh)before+=(o.geometry.index?.count??o.geometry.attributes.position.count)});
 const meshes=splitExteriorLightingReceivers(root,meta,uvs);let after=0;root.traverse(o=>{if(o.isMesh)after+=(o.geometry.index?.count??o.geometry.attributes.position.count)});
 assert.equal(after,before);assert.equal(meshes.length,6);assert.ok(meshes.every(m=>m.geometry.attributes.uv2.count===m.geometry.attributes.position.count));
});

test('encoded atlas contains finite linear irradiance and restores lit founder/apron tops',async()=>{
 const {EXRLoader}=await import('three/addons/loaders/EXRLoader.js');
 const meta=JSON.parse(readReleaseAsset('lighting.json')),bytes=readReleaseAsset(meta.atlas),decoded=new EXRLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.deepEqual([decoded.width,decoded.height],meta.size);
 const value=i=>decoded.type===T.HalfFloatType?T.DataUtils.fromHalfFloat(decoded.data[i]):decoded.data[i];
 for(let i=0;i<decoded.data.length;i++){const v=value(i);assert.ok(Number.isFinite(v)&&v>=0,'finite nonnegative linear signal');}
 const {repairExteriorWinding,repairExteriorOverlap,repairExteriorGroove}=await import('../src/runtime/rendering/exteriorSurfaces.ts');const {repairEntranceApron}=await import('../src/runtime/rendering/entranceApron.ts');
 const root=new T.Group();for(const c of manifest.chunks.filter(c=>['entrance','shell','founder','studio','lounge'].includes(c.id)))root.add((await geometryFixture(c.url)).root);
 repairExteriorWinding(root);repairExteriorOverlap(root);repairExteriorGroove(root);repairEntranceApron(root);repairFounderExteriorWinding(root);root.updateMatrixWorld(true);
 const b=readReleaseAsset(meta.uv),uv=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 for(const name of ['MD_EntranceExteriorApron',founderExteriorSource.mesh]){
  const r=meta.receivers.find(r=>r.sourceMesh===name),mesh=root.getObjectByName(name),p=mesh.geometry.attributes.position,index=mesh.geometry.index;let areaSum=0,lightSum=0;
  for(let j=0;j<r.triangleOffsets.length;j++){
   const off=r.triangleOffsets[j],v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index.getX(off+k)).applyMatrix4(mesh.matrixWorld)),cross=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])),area=cross.length()/2;
   if(cross.y<area*1.9||area<.01)continue;
   const u=r.uvOffset+j*6,x=Math.min(decoded.width-1,Math.max(0,Math.floor((uv[u]+uv[u+2]+uv[u+4])/3*decoded.width))),y=Math.min(decoded.height-1,Math.max(0,Math.floor((1-(uv[u+1]+uv[u+3]+uv[u+5])/3)*decoded.height)));
   const pixel=(y*decoded.width+x)*4,lum=value(pixel)*.2126+value(pixel+1)*.7152+value(pixel+2)*.0722;areaSum+=area;lightSum+=area*lum;
  }
  assert.ok(areaSum>1);assert.ok(lightSum/areaSum>.1,`${name} has real indirect illumination instead of the old zero bake`);
 }
 // Sample with actual final vertex UV interpolation and the runtime bilinear
 // texture transform. The former shared top/bevel chart collapsed to ~18% here.
 splitExteriorLightingReceivers(root,meta,uv);root.updateMatrixWorld(true);
 const sampleTop=(x,z)=>{
  const hit=new T.Raycaster(new T.Vector3(x,.1,z),new T.Vector3(0,-1,0),0,.2).intersectObject(root,true)[0];
  assert.ok(hit?.object.geometry.attributes.uv2,'join receiver uses new atlas');
  const mesh=hit.object,g=mesh.geometry,face=hit.face,p=mesh.worldToLocal(hit.point.clone()),v=[face.a,face.b,face.c].map(i=>new T.Vector3().fromBufferAttribute(g.attributes.position,i));
  const bary=new T.Triangle(...v).getBarycoord(p,new T.Vector3()),tex=[face.a,face.b,face.c].map(i=>new T.Vector2().fromBufferAttribute(g.attributes.uv2,i)),coord=tex[0].multiplyScalar(bary.x).addScaledVector(tex[1],bary.y).addScaledVector(tex[2],bary.z);
  const px=coord.x*decoded.width-.5,py=(1-coord.y)*decoded.height-.5,xx=Math.floor(px),yy=Math.floor(py),tx=px-xx,ty=py-yy;
  const lum=(x,y)=>{const i=(Math.max(0,Math.min(decoded.height-1,y))*decoded.width+Math.max(0,Math.min(decoded.width-1,x)))*4;return value(i)*.2126+value(i+1)*.7152+value(i+2)*.0722};
  return lum(xx,yy)*(1-tx)*(1-ty)+lum(xx+1,yy)*tx*(1-ty)+lum(xx,yy+1)*(1-tx)*ty+lum(xx+1,yy+1)*tx*ty;
 };
 for(const x of [-2,-1,0]){const near=sampleTop(x,-9.31799972+.001),inside=sampleTop(x,-9.31799972+.03);assert.ok(inside>.1);assert.ok(near/inside>.65,`flush apron seam at x=${x} must retain its top illumination; ratio=${near/inside}`);}});
