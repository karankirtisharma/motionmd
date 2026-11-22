import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeInteractionGLB, loadCollisionGLBs, loadInteractionGLB } from '../src/runtime/interaction/interactionGLB.ts';

const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
function fixture(name, uri) {
  const json = { asset:{version:'2.0'}, scene:0, scenes:[{name,nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0}}]}], accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],
    bufferViews:[{buffer:0,byteLength:positions.byteLength}], buffers:[{byteLength:positions.byteLength,...(uri?{uri}:{})}] };
  const text = Buffer.from(JSON.stringify(json)), length = (text.length + 3) & ~3;
  const bytes = Buffer.alloc(20 + length + (uri ? 0 : 8 + positions.byteLength));
  bytes.write('glTF'); bytes.writeUInt32LE(2,4); bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(length,12); bytes.writeUInt32LE(0x4e4f534a,16); bytes.fill(32,20,20+length); text.copy(bytes,20);
  if (!uri) { bytes.writeUInt32LE(positions.byteLength,20+length); bytes.writeUInt32LE(0x004e4942,24+length); Buffer.from(positions.buffer).copy(bytes,28+length); }
  return bytes;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pathOf = input => typeof input === 'string' ? input : input.url;

test('visitor transfer retries transient HTTP and keeps relative buffers beside the original CDN GLB', async t => {
  if (!globalThis.ProgressEvent) {
    globalThis.ProgressEvent = class extends Event { constructor(type, init) { super(type); Object.assign(this, init); } };
    t.after(() => { delete globalThis.ProgressEvent; });
  }
  const old = process.env.NEXT_PUBLIC_ASSET_BASE_URL;
  process.env.NEXT_PUBLIC_ASSET_BASE_URL = 'https://assets.test/releases/march';
  t.after(() => { if (old === undefined) delete process.env.NEXT_PUBLIC_ASSET_BASE_URL; else process.env.NEXT_PUBLIC_ASSET_BASE_URL = old; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = pathOf(input); calls.push(url);
    if (calls.length === 1) return new Response(null, {status:503});
    return new Response(url.endsWith('/mesh.bin') ? positions.buffer : fixture('visitor', 'mesh.bin'));
  });
  const gltf = await loadInteractionGLB('/assets/people/person.glb?v=7');
  assert.deepEqual(calls, ['https://assets.test/releases/march/assets/people/person.glb?v=7',
    'https://assets.test/releases/march/assets/people/person.glb?v=7','https://assets.test/releases/march/assets/people/mesh.bin']);
  assert.deepEqual([...gltf.scene.children[0].geometry.attributes.position.array], [...positions]);
  disposeInteractionGLB(gltf);
});

test('collider imports cap transfer concurrency and preserve input order', async t => {
  const names=['one','two','three','four','five','six'];
  let active=0, peak=0;
  t.mock.method(globalThis, 'fetch', async input => {
    const name=pathOf(input).split('/').pop();peak=Math.max(peak,++active);
    await delay(name==='one'?30:5);active--;return new Response(fixture(name));
  });
  const assets=await loadCollisionGLBs(names.map(name=>'/models/'+name));
  assert.equal(peak,2);
  assert.deepEqual(assets.map(g=>g.scene.name),names);
  assets.forEach(disposeInteractionGLB);
});

test('a permanent collider failure cancels its active sibling, skips queued files and disposes completed models', async t => {
  const calls=[]; const disposed=t.mock.method(THREE.BufferGeometry.prototype,'dispose');
  let unstick;
  const running=new Promise(resolve=>{unstick=resolve});
  t.mock.method(globalThis,'fetch',async (input,{signal})=>{
    const name=pathOf(input);calls.push(name);
    if(name==='/models/good') return new Response(fixture('ok'));
    if(name==='/models/missing') {await running;return new Response(null,{status:404});}
    unstick();
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  await assert.rejects(loadCollisionGLBs(['/models/good','/models/missing','/models/active','/models/queued']), /HTTP 404/);
  assert.deepEqual(calls,['/models/good','/models/missing','/models/active']);
  assert.equal(disposed.mock.callCount(),1);
});

test('caller cancellation stops a transfer and a fresh visit succeeds',async t=>{
  let first=true, begin;
  const started=new Promise(resolve=>{begin=resolve});
  t.mock.method(globalThis,'fetch',async (_, {signal})=>{
    if(!first)return new Response(fixture('reentered'));
    first=false;begin();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  const controller=new AbortController(), pending=loadCollisionGLBs(['/models/a','/models/b','/models/c'],controller.signal);
  await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});
  const [model]=await loadCollisionGLBs(['/models/a']);
  assert.equal(model.scene.name,'reentered');disposeInteractionGLB(model);
});

test('abort during parse releases decoded resources and keeps a partial visitor out of the scene',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(fixture('late')));
  const original=GLTFLoader.prototype.parseAsync, controller=new AbortController();
  const disposed=t.mock.method(THREE.BufferGeometry.prototype,'dispose');
  t.mock.method(GLTFLoader.prototype,'parseAsync',async function(...args){
    const gltf=await original.apply(this,args);controller.abort();return gltf;
  });
  await assert.rejects(loadInteractionGLB('/models/test',controller.signal),{name:'AbortError'});
  assert.equal(disposed.mock.callCount(),1);
});

test('a dependency failure still rejects a resolved GLTF and disposes all its private scenes',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(fixture('guard')));
  t.mock.method(console,'error',()=>{});
  const disposed=t.mock.method(THREE.BufferGeometry.prototype,'dispose');
  const original=GLTFLoader.prototype.parseAsync;
  t.mock.method(GLTFLoader.prototype,'parseAsync',async function(...args){
    const gltf=await original.apply(this,args);
    gltf.scenes.push(new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry())));
    this.manager.itemError('/missing.png');return gltf;
  });
  await assert.rejects(loadInteractionGLB('/models/test'),/texture could not be loaded/);
  assert.equal(disposed.mock.callCount(),2);
});
