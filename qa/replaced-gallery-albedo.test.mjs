import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {omitReplacedGalleryAlbedo,createReplacedGalleryAlbedoPlugin,GALLERY_ALBEDO_CHUNK,REPLACED_GALLERY_ALBEDO} from '../src/runtime/rendering/replacedGalleryAlbedo.ts';

const bytes=fs.readFileSync(new URL('../public'+GALLERY_ALBEDO_CHUNK,import.meta.url));
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
const names=['gallery__EH54 | scanned cream limestone panels','gallery__EH54 | polished warm-grey cloud marble'];

test('only the two superseded gallery albedo references change; source payload stays unchanged',()=>{
 const value=structuredClone(json),expected=structuredClone(json);
 for(const material of expected.materials)if(names.includes(material.name))delete material.pbrMetallicRoughness.baseColorTexture;
 assert.equal(omitReplacedGalleryAlbedo(value,GALLERY_ALBEDO_CHUNK),2);
 assert.deepEqual(value,expected,'geometry, normals, ORM, UVs, factors and all other metadata remain exact');
 assert.equal(fs.statSync(new URL('../public'+REPLACED_GALLERY_ALBEDO,import.meta.url)).size,13660809);
 assert.equal(omitReplacedGalleryAlbedo(value,GALLERY_ALBEDO_CHUNK),0,'idempotent');
 assert.deepEqual(JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),json,'source bytes never rewritten');
});

test('unexpected chunks, names, image URIs or extra texture consumers retain every source binding',()=>{
 const cases=[
  [value=>{},'/assets/architecture-v16/lounge.glb'],
  [value=>{value.materials[0].name+=' changed';},GALLERY_ALBEDO_CHUNK],
  [value=>{value.images[1].uri+='?changed';},GALLERY_ALBEDO_CHUNK],
  [value=>{value.materials[2].emissiveTexture={index:1};},GALLERY_ALBEDO_CHUNK],
  [value=>{value.materials[0].extensions={SOME_future_extension:{texture:{index:4}}};},GALLERY_ALBEDO_CHUNK],
  [value=>{value.textures[1].source=2;},GALLERY_ALBEDO_CHUNK],
 ];
 for(const[edit,url]of cases){const value=structuredClone(json);edit(value);const expected=structuredClone(value);assert.equal(omitReplacedGalleryAlbedo(value,url),0);assert.deepEqual(value,expected);}
});

// Compile the real material pipeline, replacing only network/image decoding.
// All source triplanar reconstruction and material replacement functions run.
const moduleURL=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modules=new Map();
const assets=moduleURL(`import {Texture} from ${JSON.stringify(import.meta.resolve('three'))};export async function loadTexture(url){const t=new Texture({width:4,height:4});t.name=url;return t;}`);
function compile(relative){
 const file=new URL(relative,import.meta.url);
 if(modules.has(file.href))return modules.get(file.href);
 let source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 source=source.replace(/from (['"])([^'"]+)\1/g,(full,quote,specifier)=>{
  let target;
  if(specifier==='./assets'||specifier==='./assets.ts')target=assets;
  else if(specifier.startsWith('.')){const dependency=new URL(specifier,file);if(!path.extname(dependency.pathname))dependency.pathname+='.ts';target=compile(dependency.href);}
  else target=import.meta.resolve(specifier);
  return 'from '+JSON.stringify(target);
 });
 const result=moduleURL(source);modules.set(file.href,result);return result;
}
const {applyMaterialManifest}=await import(compile('../src/runtime/rendering/materials.ts'));
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
async function fixture(prune){
 const requested=[];
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader({
  load(url,onLoad){requested.push(url);const texture=new THREE.Texture({width:4,height:4});texture.name=url;queueMicrotask(()=>onLoad(texture));return texture;},
 });
 if(prune)loader.register(createReplacedGalleryAlbedoPlugin(GALLERY_ALBEDO_CHUNK));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 const owned=await applyMaterialManifest(gltf.scene,manifest);
 return {root:gltf.scene,requested,dispose(){const materials=new Set(),textures=new Set(owned);gltf.scene.traverse(o=>{if(!o.isMesh)return;o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
function materialState(root){
 const records=[];
 root.traverse(object=>{if(!object.isMesh)return;for(const material of Array.isArray(object.material)?object.material:[object.material]){
  const textures=Object.fromEntries(Object.entries(material).filter(([,value])=>value?.isTexture).map(([slot,value])=>[slot,{name:value.name,channel:value.channel,flipY:value.flipY,repeat:value.repeat.toArray()}]));
  records.push({name:material.name,side:material.side,color:material.color?.toArray(),roughness:material.roughness,metalness:material.metalness,userData:material.userData,textures,colorNode:material.colorNode?.constructor.name,roughnessNode:material.roughnessNode?.constructor.name,normalNode:material.normalNode?.constructor.name});
 }});return records;
}

test('real gallery parsing omits one image request and finishes with the same source wall/floor materials',async context=>{
 const priorSelf=globalThis.self;globalThis.self=globalThis;context.after(()=>{if(priorSelf===undefined)delete globalThis.self;else globalThis.self=priorSelf;});
 const original=await fixture(false),optimized=await fixture(true);
 try{
  assert.equal(original.requested.filter(url=>url===REPLACED_GALLERY_ALBEDO).length,1);
  assert.equal(optimized.requested.includes(REPLACED_GALLERY_ALBEDO),false);
  assert.deepEqual(optimized.requested.sort(),original.requested.filter(url=>url!==REPLACED_GALLERY_ALBEDO).sort());
  assert.deepEqual(materialState(optimized.root),materialState(original.root),'real source graph restoration is independent of omitted atlas');
  const states=materialState(optimized.root);
  const wall=states.find(state=>state.name===names[0]),floor=states.find(state=>state.name===names[1]);
  assert.equal(wall.userData.sourceWallRestored,true);assert.equal(floor.userData.sourceFloorRestored,true);
  assert.equal(wall.textures.map,undefined);assert.equal(floor.textures.map,undefined);
  assert.equal(wall.textures.mdStoneAlbedo.name,'/assets/source-walls/cream-stone-original.png');
  assert.equal(floor.textures.mdMarbleAlbedo.name,'/assets/source-walls/greige-marble-original.png');
  assert.ok(wall.colorNode&&floor.colorNode);
  context.diagnostic('Avoided 13,660,809 source bytes and one 4096x4096/13-mip KTX2 decode; GPU savings not asserted.');
 }finally{original.dispose();optimized.dispose();}
});
