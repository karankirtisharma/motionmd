import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Scene, PerspectiveCamera } from 'three';
import { prepareRenderAsync, skippedPreparationDraws } from '../src/runtime/rendering/prepareRenderAsync.ts';

function fixture() {
  const records = new Map(), built = new Map(), ready = new Set(), calls = [], scene = new Scene(), camera = new PerspectiveCamera();
  const contexts = [{ id: 0 }, { id: 1 }, { id: 2 }], material = new MeshBasicMaterial(), mesh = new Mesh(undefined, material);
  let target = { name: 'original' }, mrt = { name: 'original' }, active = 0;
  const r = {
    backend: { isWebGPUBackend: true },
    _currentRenderContext: contexts[0], _currentSourceMaterial: null, _isPreCompiling: false,
    toneMapping: 0, outputColorSpace: 'srgb',
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getMRT: () => mrt, setMRT: value => { mrt = value; },
    _objects: { get(object, mat, scene, camera, lights, context, clipping, pass) {
      const key = context.id + ':' + mat.side + ':' + pass;
      if (!records.has(key)) records.set(key, { key, object, material: mat, side: mat.side, target, mrt, context });
      return records.get(key);
    } },
    _nodes: {
      get: record => built.get(record) || {},
      async getForRenderAsync(record) {
        assert.equal(++active, 1, 'TSL builds must be serial');
        assert.equal(material.side, record.side); assert.equal(target, record.target); assert.equal(mrt, record.mrt);
        assert.equal(r._currentRenderContext, record.context);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(r._isPreCompiling, false, 'precompile flag cannot leak across a yield');
        built.set(record, { nodeBuilderState: {} }); active--;
      },
      updateBefore() { assert.fail('render-dependent updates require an active encoder'); },
      updateForRender() {}, updateAfter() { assert.fail('render-after requires a real draw'); },
    },
    _geometries: { updateForRender() {} }, _bindings: { updateForRender() {} },
    _pipelines: { isReady: record => ready.has(record), getForRender(record, promises) {
      promises.push(Promise.resolve().then(() => ready.add(record)));
    } },
    _renderObjectDirect(object, mat, sc, cam, lights, group, clipping, pass) {
      calls.push(r._objects.get(object, mat, sc, cam, lights, r._currentRenderContext, clipping, pass));
    },
  };
  return { r, contexts, records, built, ready, calls, mesh, material, scene, camera };
}

test('exact nested contexts, shadow overrides and transmission sides prepare serially before a complete draw', async () => {
  const f = fixture(), { r, material, contexts } = f, original = r._renderObjectDirect;
  const originalTarget = r.getRenderTarget(), originalMRT = r.getMRT();
  const materialKeys = Object.keys(material);
  let waves = 0;
  const result = await prepareRenderAsync(r, async () => {
    waves++;
    const before = f.calls.length;
    for (const context of contexts) for (const side of [0, 1]) {
      r._currentRenderContext = context; material.side = side;
      const oldTarget = r.getRenderTarget(), oldMRT = r.getMRT();
      r.setRenderTarget(context); r.setMRT(context.id ? context : null);
      r._renderObjectDirect(f.mesh, material, f.scene, f.camera, {}, null, {}, side === 1 ? 'backSide' : null);
      r.setRenderTarget(oldTarget); r.setMRT(oldMRT);
    }
    material.side = 0; r._currentRenderContext = contexts[0];
    assert.equal(f.calls.length - before, waves === 1 ? 0 : 6, 'never synchronously draw a missing program');
  });
  assert.deepEqual(Object.keys(material), materialKeys, 'must not add undefined node overrides to ordinary materials');
  assert.equal(result, true); assert.equal(waves, 2); assert.equal(f.records.size, 6);
  assert.equal(r._renderObjectDirect, original); assert.equal(r.getRenderTarget(), originalTarget);
  assert.equal(r.getMRT(), originalMRT); assert.equal(material.side, 0); assert.equal(skippedPreparationDraws(r), 0);
});

for (const outcome of ['abort', 'builder failure', 'pipeline failure', 'draw failure'])
test(`all borrowed renderer/material state restores after ${outcome}`, async () => {
  const f = fixture(), r = f.r, controller = new AbortController(), original = r._renderObjectDirect;
  const target = r.getRenderTarget(), mrt = r.getMRT();
  if (outcome === 'builder failure') r._nodes.getForRenderAsync = async () => { throw Error(outcome); };
  if (outcome === 'pipeline failure') r._pipelines.getForRender = () => { throw Error(outcome); };
  if (outcome === 'abort') r._nodes.getForRenderAsync = async () => controller.abort();
  await assert.rejects(prepareRenderAsync(r, async () => {
    f.material.side = 1;
    r._renderObjectDirect(f.mesh, f.material, f.scene, f.camera, {}, null, {}, 'backSide');
    f.material.side = 0;
    if (outcome === 'draw failure') throw Error(outcome);
  }, controller.signal));
  assert.equal(r._renderObjectDirect, original); assert.equal(r.getRenderTarget(), target);
  assert.equal(r.getMRT(), mrt); assert.equal(f.material.side, 0); assert.equal(r._isPreCompiling, false);
  assert.equal(skippedPreparationDraws(r), 0);
});

test('unsupported renderers leave dispatch untouched for the bounded public fallback', async () => {
  const r = {}; assert.equal(await prepareRenderAsync(r, async () => assert.fail('must not draw')), false);
});

test('pass light lists survive Lighting.finishRender and restore after compilation', async () => {
  const f = fixture(), r = f.r, sunlight = [{ castShadow: true }], outside = [];
  let list = outside;
  const lights = { getLights: () => list, setLights: value => { list = value; } };
  const build = r._nodes.getForRenderAsync;
  r._nodes.getForRenderAsync = async record => {
    assert.deepEqual(list, sunlight, 'compile with the lights present inside the real pass');
    await build(record); assert.deepEqual(list, sunlight);
  };
  await prepareRenderAsync(r, async () => {
    list = sunlight;
    r._renderObjectDirect(f.mesh, f.material, f.scene, f.camera, lights, null, {}, null);
    list = outside; // Lighting.finishRender restores the previous list.
  });
  assert.equal(list, outside);
});

test('GPU compilation overlaps within a four-pipeline bound and joins before the complete draw', async () => {
  const f = fixture(), r = f.r;
  let active = 0, maximum = 0;
  r._pipelines.getForRender = (record, promises) => {
    active++; maximum = Math.max(maximum, active);
    promises.push(new Promise(resolve => setTimeout(() => { active--; f.ready.add(record); resolve(); }, 35)));
  };
  await prepareRenderAsync(r, async () => {
    for (const context of f.contexts) for (const side of [0,1]) {
      r._currentRenderContext = context; f.material.side = side;
      r._renderObjectDirect(f.mesh, f.material, f.scene, f.camera, {}, null, {}, String(side));
    }
    f.material.side = 0; r._currentRenderContext = f.contexts[0];
  });
  assert.ok(maximum > 1 && maximum <= 4); assert.equal(active, 0); assert.equal(f.calls.length, 6);
});

test('asynchronous driver failure restores dispatch and rejects readiness', async () => {
  const f = fixture(), r = f.r, original = r._renderObjectDirect;
  r._pipelines.getForRender = (record, promises) => promises.push(Promise.reject(Error('driver failure')));
  await assert.rejects(prepareRenderAsync(r, async () => {
    r._renderObjectDirect(f.mesh, f.material, f.scene, f.camera, {}, null, {}, null);
  }), /driver failure/);
  assert.equal(r._renderObjectDirect, original); assert.equal(r._isPreCompiling, false);
});

test('WebGL fallback keeps its existing public preparation and never waits for a WebGPU handle', async () => {
  const { r } = fixture(), original = r._renderObjectDirect;
  r.backend = { isWebGLBackend: true };
  assert.equal(await prepareRenderAsync(r, async () => assert.fail('must use public fallback')), false);
  assert.equal(r._renderObjectDirect, original);
  assert.equal(skippedPreparationDraws(r), 0);
});

test('a slow GPU job cannot hold completed compilation slots idle', async () => {
  const f = fixture(), r = f.r; let started = 0, active = 0, peak = 0, firstComplete = false, fifthBeforeFirst = false;
  r._pipelines.getForRender = (record, promises) => {
    const id = started++; active++; peak = Math.max(peak, active);
    if (id === 4) fifthBeforeFirst = !firstComplete;
    promises.push(new Promise(resolve => setTimeout(() => {
      active--; if (id === 0) firstComplete = true; f.ready.add(record); resolve();
    }, id === 0 ? 140 : 15)));
  };
  await prepareRenderAsync(r, async () => {
    for (const context of f.contexts) for (const side of [0,1]) {
      r._currentRenderContext = context; f.material.side = side;
      r._renderObjectDirect(f.mesh, f.material, f.scene, f.camera, {}, null, {}, String(side));
    }
    f.material.side = 0; r._currentRenderContext = f.contexts[0];
  });
  assert.equal(fifthBeforeFirst, true); assert.ok(peak <= 4); assert.equal(active, 0); assert.equal(f.calls.length, 6);
});
