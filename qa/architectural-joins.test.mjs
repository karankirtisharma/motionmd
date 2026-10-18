import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Raycaster,DoubleSide,Mesh,PlaneGeometry,MeshPhysicalMaterial} from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {repairArchitecturalJoins} from '../src/runtime/rendering/architecturalJoins.ts';
import {repairStudioThreshold} from '../src/runtime/rendering/floorThreshold.ts';
import {repairCollapsedBrushFrame} from '../src/runtime/rendering/brushTangents.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const fixture=id=>geometryFixture(manifest.chunks.find(c=>c.id===id).url);
function height(root,x,z){root.traverse(o=>{if(o.isMesh)o.material.side=DoubleSide;});return new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(root,true).filter(h=>h.object.material.name.includes('polished'))[0]?.point.y;}

test('actual founder floor closes the gap without moving the finished height or changing light UVs',async()=>{
 const {root}=await fixture('founder');
 const uvs=[];root.traverse(o=>{if(o.isMesh&&o.geometry.attributes.uv1)uvs.push([o.geometry,[...o.geometry.attributes.uv1.array]]);});
 assert.ok(repairArchitecturalJoins(root)>0);
 for(const x of [4,8,12])for(const z of [-2.44,-2.42,-2.399]) assert.ok(Math.abs(height(root,x,z)-4.23)<.0001,`${x},${z}`);
 for(const x of [3.616,3.63,13.008]) assert.ok(Math.abs(height(root,x,-9.7)-4.23)<.0001,`side join ${x}`);
 for(const [g,before] of uvs)assert.deepEqual([...g.attributes.uv1.array],before);
 assert.equal(repairArchitecturalJoins(root),0,'repeat initialization is idempotent');
});

test('actual studio entrance is continuous and keeps the furniture floor height',async()=>{
 const {root}=await fixture('studio');
 assert.equal(repairStudioThreshold(root),1);
 for(const z of [-23.401,-23.43,-23.48,-23.52,-24,-30]) {
  const expected=.015-.0125*Math.max(0,Math.min(1,(z+23.52)/.12));
  assert.ok(Math.abs(height(root,12,z)-expected)<.00001,`${z}`);
 }
 assert.equal(repairStudioThreshold(root),0);
});

test('collapsed anisotropy UVs receive a frame while authored UVs are preserved',()=>{
 const material=new MeshPhysicalMaterial({anisotropy:.23});
 const valid=new Mesh(new PlaneGeometry(),material);
 assert.equal(repairCollapsedBrushFrame(valid),false);
 const broken=new Mesh(new PlaneGeometry(),material);broken.geometry.attributes.uv.array.fill(0);
 assert.equal(repairCollapsedBrushFrame(broken),true);
 const tangent=broken.geometry.attributes.tangent;
 assert.ok([...tangent.array].every(Number.isFinite));
 assert.equal(repairCollapsedBrushFrame(broken),false);
 assert.equal(broken.geometry.attributes.tangent,tangent);
});

test('actual ceiling fascia clears the canopy underside and retains its structural top',async()=>{
 const {root}=await fixture('shell');
 root.updateMatrixWorld(true);
 const samples=[];
 root.traverse(o=>{
  if(!o.isMesh||o.material.name!=='shell__EH54 | scanned cream limestone panels')return;
  const p=o.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   const v=new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
   if(v.x>=3.210&&v.x<=3.780&&v.z>=-11.063&&v.z<=-2.136&&v.y>=3.8799&&v.y<=4.2001)samples.push([o,i,v.y]);
  }
 });
 assert.ok(samples.some(([, ,y])=>Math.abs(y-3.88)<.0001));
 repairArchitecturalJoins(root);
 for(const [o,i,y] of samples){
  const actual=new Vector3().fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld).y;
  assert.ok(Math.abs(actual-(3.9+(y-3.88)*(.3/.32)))<.00001);
 }
 assert.equal(repairArchitecturalJoins(root),0);
});
