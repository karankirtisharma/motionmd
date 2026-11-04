import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { Mesh, BoxGeometry, Scene, Texture } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { filterSourceSpecular } from '../src/runtime/rendering/specularFiltering.ts';

const source = fs.readFileSync(new URL('../src/runtime/rendering/diagnostics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replaceAll("'three'", JSON.stringify(import.meta.resolve('three')))
  .replaceAll("'three/webgpu'", JSON.stringify(import.meta.resolve('three/webgpu')))
  .replaceAll("'three/tsl'", JSON.stringify(import.meta.resolve('three/tsl')))
  .replaceAll("'./specularFiltering'", JSON.stringify(new URL('../src/runtime/rendering/specularFiltering.ts', import.meta.url).href));
const { RenderDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('a baked-light review uses the reconstructed lightmap graph instead of the raw packed page',()=>{
  const map=new Texture(),source=new MeshPhysicalNodeMaterial(),packed=vec3(.2,.3,.1);
  source.lightMap=map;source.packedLightNode=packed;
  const mesh=new Mesh(new BoxGeometry(),source),review=new RenderDiagnostics(new Scene().add(mesh));
  review.setMode('baked');
  let found=false;mesh.material.colorNode.traverse(node=>{if(node===packed)found=true;});
  assert.ok(found);
  review.dispose();assert.equal(mesh.material,source);source.dispose();map.dispose();mesh.geometry.dispose();
});

test('diagnostic isolation restores source materials and removes normal-dependent roughness',()=>{
  const material=new MeshPhysicalNodeMaterial();
  const baseRoughness=float(.28);material.roughnessNode=baseRoughness;material.normalNode=vec3(0,0,1);
  const lightMap=new Texture();lightMap.channel=1;lightMap.repeat.y=-1;lightMap.offset.y=1;
  material.lightMap=lightMap;material.lightMapIntensity=Math.PI;
  const mesh=new Mesh(new BoxGeometry(),material),root=new Scene().add(mesh);
  filterSourceSpecular(root);const filtered=material.roughnessNode;
  assert.notEqual(filtered,baseRoughness);
  const review=new RenderDiagnostics(root);
  review.setMode('no-normals');assert.equal(mesh.material.normalNode,null);assert.equal(mesh.material.roughnessNode,baseRoughness);
  assert.equal(mesh.material.lightMap,lightMap);
  review.setMode('no-gi');assert.equal(mesh.material.lightMap,null);assert.equal(mesh.material.normalNode,material.normalNode);
  review.setMode('no-reflections');assert.equal(mesh.material.envMapIntensity,0);assert.equal(mesh.material.lightMap,lightMap);
  review.setMode('baked');const samplers=[];
  mesh.material.colorNode.traverse(n=>{if(n.isTextureNode)samplers.push(n);});
  assert.ok(samplers.some(n=>n.value===lightMap&&n.updateMatrix),'diagnostic must preserve the production EXR UV transform');
  review.setMode('full');assert.equal(mesh.material,material);assert.equal(material.roughnessNode,filtered);
  assert.equal(lightMap.repeat.y,-1);assert.equal(lightMap.offset.y,1);
  review.dispose();mesh.geometry.dispose();material.dispose();lightMap.dispose();
});

test('restoring a review preserves a live material installed after inspection began', () => {
  const authored = new MeshPhysicalNodeMaterial(), live = new MeshPhysicalNodeMaterial();
  const mesh = new Mesh(new BoxGeometry(), authored);
  const review = new RenderDiagnostics(new Scene().add(mesh));
  review.setMode('full');
  review.setMode('no-reflections');
  mesh.material = live;
  review.setMode('full');
  assert.equal(mesh.material, live);
  review.setMode('no-normals');
  review.dispose();
  assert.equal(mesh.material, live);
  mesh.geometry.dispose(); live.dispose(); authored.dispose();
});
