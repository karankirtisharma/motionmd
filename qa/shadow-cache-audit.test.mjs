import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils, DirectionalLight, HalfFloatType, PerspectiveCamera, RenderTarget, Scene } from 'three';
import { auditShadowCache, compareShadowReadbacks } from '../src/runtime/rendering/shadowCacheAudit.ts';

const half = values => new Uint16Array(values.map(value => DataUtils.toHalfFloat(value)));
function fixture(failure) {
  const shadow = new DirectionalLight().shadow;
  shadow.needsUpdate = false;
  let enabled = true, target = { original: true }, mrt = { original: true }, read = 0, renders = 0, compiles = 0, disposed = 0, shadowCalls = 0, stockPasses = 0, dynamicPasses = 0;
  const originalTarget = target, originalMRT = mrt, events = [], auditTargets = new Set();
  const cache = { get stats() { return { enabled, cacheHits: Math.max(0, dynamicPasses-1), stockPasses, dynamicPasses }; }, setEnabled(value) { enabled = value; shadow.needsUpdate = true; events.push(['cache', value]); }, updateShadow(frame) { assert.equal(frame.renderer,renderer); shadowCalls++; if(enabled)dynamicPasses++; else stockPasses++; renderer.info.render.drawCalls += enabled ? 2 : 7; renderer.info.render.triangles += enabled ? 200 : 700; } };
  const renderer = {
    autoClear: false, expectedMRT: null, info: { render: { drawCalls: 100, triangles: 1000 } },
    getDrawingBufferSize: size => size.set(3, 2),
    getRenderTarget: () => target, getMRT: () => mrt,
    setMRT: value => { mrt = value; },
    setRenderTarget(value) {
      target = value;
      if (value?.isRenderTarget && !auditTargets.has(value)) { auditTargets.add(value); value.addEventListener('dispose', () => disposed++); }
    },
    async compileAsync() { compiles++; if (failure === 'compile') throw new Error('compile failed'); },
    render() { renders++; assert.equal(shadow.needsUpdate, false); assert.equal(shadow.autoUpdate, false); assert.equal(mrt, renderer.expectedMRT); assert.equal(renderer.autoClear, true); renderer.info.render.drawCalls += 10; renderer.info.render.triangles += 1000; },
    async readRenderTargetPixelsAsync(renderTarget, x, y, width, height) {
      read++; assert.equal(renderTarget, target); assert.deepEqual([x,y,width,height],read<=2?[0,0,3,2]:[0,0,1,1]);
      assert.equal(target.texture.type, HalfFloatType); assert.equal(target.samples, 0);
      if (failure === 'read' || (failure === 'benchmark-read' && read===3)) throw new Error('read failed');
      return half(Array.from({ length: width*height*4 }, (_, i) => i / 8));
    },
  };
  return { renderer, shadow, cache, scene: new Scene(), camera: new PerspectiveCamera(), events,
    counts: () => ({ read, renders, compiles, disposed }),
    shadowCalls: () => shadowCalls,
    assertRestored(expectedDisposals=1) { assert.equal(enabled, true); assert.equal(target, originalTarget); assert.equal(mrt, originalMRT); assert.equal(renderer.autoClear, false); assert.equal(shadow.needsUpdate, false); assert.equal(shadow.autoUpdate, true); assert.equal(disposed, expectedDisposals); },
  };
}

test('fixed-pose audit warms both paths, compares decoded HDR, and restores every owner', async () => {
  const f = fixture(), result = await auditShadowCache(f);
  assert.equal(result.withinTolerance, true); assert.equal(result.differentPixels, 0); assert.equal(result.maxAbsDifference, 0);
  assert.deepEqual(f.counts(), { read: 2, renders: 4, compiles: 2, disposed: 1 });
  assert.deepEqual(f.events, [['cache', false], ['cache', true], ['cache', true]]);
  assert.deepEqual(result.stockRender,{drawCalls:17,triangles:1700});assert.deepEqual(result.cachedRender,{drawCalls:12,triangles:1200});
  assert.equal(f.shadowCalls(),4); assert.equal(result.throughput,undefined);
  f.assertRestored();
});

for (const failure of ['compile','read']) test(`audit cleans target and restores state after ${failure} failure`, async () => {
  const f = fixture(failure); await assert.rejects(auditShadowCache(f), new RegExp(`${failure} failed`)); f.assertRestored();
});

test('abort during asynchronous GPU preparation restores state without drawing', async () => {
  const f = fixture(), abort = new AbortController();
  f.renderer.compileAsync = async () => { abort.abort(); };
  await assert.rejects(auditShadowCache({ ...f, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(f.counts().renders, 0); f.assertRestored();
});

test('WebGPU half-float row padding is ignored, and comparison uses actual float values', () => {
  const width=3,height=2, row=width*4, stride=128;
  const packed=half(Array.from({length:row*height},(_,i)=>i/8));
  const padded=new Uint16Array(stride+row); padded.fill(DataUtils.toHalfFloat(42));
  padded.set(packed.subarray(0,row),0);padded.set(packed.subarray(row),stride);
  assert.equal(compareShadowReadbacks(packed,padded,width,height).differentPixels,0);
  padded[stride+1]=DataUtils.toHalfFloat(2.125);
  const result=compareShadowReadbacks(packed,padded,width,height,.01);
  assert.equal(result.differentPixels,1);assert.equal(result.differentComponents,1);
  assert.equal(result.maxAbsDifference,.5);assert.equal(result.meanAbsDifference,.5/24);assert.equal(result.withinTolerance,false);
});

test('float readback comparison rejects non-finite output rather than hiding invalid pixels', () => {
  const result=compareShadowReadbacks(new Float32Array([1,2,3,1]),new Float32Array([1,2,NaN,1]),1,1);
  assert.equal(result.nonFiniteComponents,1);assert.equal(result.withinTolerance,false);
  assert.throws(()=>compareShadowReadbacks(new Float32Array(3),new Float32Array(4),1,1),/readback length/);
});

test('existing scene-pass target and MRT are reused and never disposed', async () => {
  const f=fixture(), target=new RenderTarget(3,2,{type:HalfFloatType,samples:0}), mrt={scenePass:true};
  f.renderer.expectedMRT=mrt;
  const result=await auditShadowCache({...f,pass:{target,mrt}});
  assert.equal(result.context,'existing scene-pass target and MRT'); f.assertRestored(0);target.dispose();
});

test('bounded ABBA benchmark submits every explicit shadow pass and fences each batch', async () => {
  const f=fixture(), result=await auditShadowCache({...f,benchmarkFrames:16});
  assert.deepEqual(f.counts(),{read:6,renders:68,compiles:2,disposed:1});assert.equal(f.shadowCalls(),68);
  assert.deepEqual(result.throughput.batches.map(b=>b.path),['stock','cached','cached','stock']);
  for(const b of result.throughput.batches){
    assert.equal(b.frames,16);assert.equal(b.cpuSubmissionMsPerFrame.length,16);assert.equal(b.renderCountsPerFrame.length,16);
    assert.ok(b.cpuSubmissionMsPerFrame.every(ms=>Number.isFinite(ms)&&ms>=0));
    assert.ok(b.completionWithReadbackMs>=b.submissionTotalMs);
    assert.ok(b.renderCountsPerFrame.every(c=>c.drawCalls===(b.path==='stock'?17:12)));
  }
  assert.match(result.throughput.note,/not display FPS/);f.assertRestored();
});

test('benchmark fence failure restores target and original shadow update policy',async()=>{
  const f=fixture('benchmark-read');await assert.rejects(auditShadowCache({...f,benchmarkFrames:2}),/read failed/);f.assertRestored();
});

test('invalid benchmark limits fail before rendering or allocating a target',async()=>{
  for(const benchmarkFrames of [-1,.5,33,Infinity]){
    const f=fixture();await assert.rejects(auditShadowCache({...f,benchmarkFrames}),/benchmarkFrames/);
    assert.deepEqual(f.counts(),{read:0,renders:0,compiles:0,disposed:0});
  }
});
test('RGB evidence distinguishes blank equality from a nonblank scene, excluding alpha and padding', () => {
  const blank=half([0,0,0,1]), lit=half([1,2,3,1]);
  const empty=compareShadowReadbacks(blank,blank,1,1);
  assert.equal(empty.withinTolerance,true);assert.equal(empty.stockRgbEnergy,0);assert.equal(empty.cachedNonZeroRgbPixels,0);
  const result=compareShadowReadbacks(lit,lit,1,1);
  assert.equal(result.stockRgbEnergy,6);assert.equal(result.cachedRgbEnergy,6);
  assert.equal(result.stockNonZeroRgbPixels,1);assert.equal(result.cachedNonZeroRgbPixels,1);
  assert.equal(result.stockMeanAbsRgb,2);assert.equal(result.cachedMeanAbsRgb,2);
});