import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Box3, Matrix4, PerspectiveCamera, Vector2, Vector3, Vector4, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { reflectionCrop, cropReflectionCamera } from '../src/runtime/rendering/reflectionCrop.ts';
import { createLoadQueue } from '../src/runtime/rendering/loadQueue.ts';
import { loadEXRInWorker } from '../src/runtime/rendering/exrDecode.ts';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

test('cropped reflection preserves UV projection and physical depth on both APIs', () => {
  for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversed of [false,true]) {
    const camera = new PerspectiveCamera(50,1.6,.1,100);
    camera.coordinateSystem=api; camera._reversedDepth=reversed; camera.updateProjectionMatrix();
    const crop=new Vector4(.2,.15,.4,.6), full=camera.clone();
    cropReflectionCamera(camera,crop);
    for(const p of [new Vector3(-.3,.2,-3),new Vector3(.4,-.5,-8)]){
      const a=p.clone().project(full),b=p.clone().project(camera);
      assert.ok(Math.abs((b.x+1)/2-((a.x+1)/2-crop.x)/crop.z)<1e-12);
      assert.ok(Math.abs((1-b.y)/2-((1-a.y)/2-crop.y)/crop.w)<1e-12);
      assert.ok(Math.abs(a.z-b.z)<1e-12,'oblique depth row must not change');
    }
  }
});
test('mirror target covers the entire projected pane with original texel density',()=>{
  const view=new PerspectiveCamera(50,1.6,.1,100);view.updateMatrixWorld();
  const bounds=new Box3(new Vector3(-1,-1,-8),new Vector3(1,1,-8));
  const full=new Vector2(1536,960), crop=reflectionCrop(bounds,new Matrix4(),view,full,new Vector2(1,1),new Vector4());
  assert.ok(crop.z<.5&&crop.w<.5,'small pane should not render a screen-sized reflection');
  for(const x of [-1,1])for(const y of [-1,1]){
    const p=new Vector3(x,y,-8).project(view),u=(1-p.x)/2,v=(1-p.y)/2;
    assert.ok(u>=crop.x&&u<=crop.x+crop.z);assert.ok(v>=crop.y&&v<=crop.y+crop.w);
  }
  const near=reflectionCrop(new Box3(new Vector3(-1,-1,-.15),new Vector3(1,1,.1)),new Matrix4(),view,full,new Vector2(1,1),new Vector4());
  assert.deepEqual(near.toArray(),[0,0,1,1]);
});
test('texture prefetch is bounded and failures do not strand later loads',async()=>{
  const enqueue=createLoadQueue(2),release=[];let active=0,peak=0;
  const jobs=Array.from({length:5},(_,i)=>enqueue(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>release.push(r));active--;if(i===1)throw Error('texture unavailable');return i;}));
  await Promise.resolve();assert.equal(peak,2);
  for(let i=0;i<5;i++){while(!release.length)await new Promise(r=>setTimeout(r,0));release.shift()();await new Promise(r=>setTimeout(r,0));}
  const result=await Promise.allSettled(jobs);
  assert.equal(peak,2);assert.equal(result[1].status,'rejected');assert.equal(result[4].value,4);
});
test('background EXR preserves decoded half-float pixels and sampler semantics',async t=>{
  const file=new URL('../public/assets/surface-v23/lighting/founder-floor-indirect.exr',import.meta.url);
  const bytes=fs.readFileSync(file),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  let terminated=0;
  class FakeWorker{
    terminate(){terminated++;}
    postMessage(value){queueMicrotask(()=>this.onmessage({data:{result:new EXRLoader().parse(value)}}));}
  }
  t.mock.method(globalThis,'fetch',async()=>new Response(buffer));
  const previous=globalThis.Worker;globalThis.Worker=FakeWorker;t.after(()=>{globalThis.Worker=previous;});
  const texture=await loadEXRInWorker('/light.exr',new AbortController().signal);
  const original=new EXRLoader().createDataTexture(buffer);
  assert.deepEqual(texture.image.data,original.image.data);
  for(const key of ['type','format','colorSpace','flipY','minFilter','magFilter','generateMipmaps'])assert.equal(texture[key],original[key],key);
  assert.equal(terminated,1);texture.dispose();original.dispose();
});
test('cancelling a lighting decode terminates its worker and rejects promptly',async t=>{
  let terminated=0,started;
  const start=new Promise(r=>{started=r;});
  class FakeWorker{terminate(){terminated++;}postMessage(){started();}}
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1])));
  const previous=globalThis.Worker;globalThis.Worker=FakeWorker;t.after(()=>{globalThis.Worker=previous;});
  const controller=new AbortController(),pending=loadEXRInWorker('/light.exr',controller.signal);
  await start;controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,1);
});

test('progress downloads preserve bytes for valid, missing, encoded and inaccurate lengths', async t=>{
  const {fetchBuffer}=await import('../src/runtime/rendering/assets.ts');
  for(const [length,encoding] of [['6',null],[null,null],['2',null],['10',null],['2','gzip']]){
    const headers=new Headers();if(length)headers.set('content-length',length);if(encoding)headers.set('content-encoding',encoding);
    const chunks=[new Uint8Array([0,1]),new Uint8Array([2,3,4]),new Uint8Array([5])],seen=[];
    t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){for(const c of chunks)controller.enqueue(c);controller.close();}}),{headers}));
    const result=await fetchBuffer('/test.glb',new AbortController().signal,n=>seen.push(n));
    assert.deepEqual([...new Uint8Array(result)],[0,1,2,3,4,5]);
    assert.deepEqual(seen,[2,5,6]);
  }
});
