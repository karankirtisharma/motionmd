import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, BoxGeometry, PlaneGeometry, MeshBasicMaterial, PerspectiveCamera, HalfFloatType } from 'three';
import { RenderPipeline } from 'three/webgpu';
import { createGalleryMirror } from '../src/runtime/rendering/galleryMirror.ts';
import { createTemporalRenderer } from '../src/runtime/rendering/TemporalRenderer.ts';
import { OPENING_TOUR_SHADERS, openingTourShaderMeshes, warmOpeningTourShaders } from '../src/runtime/rendering/openingTourWarmup.ts';

function fixture() {
  const scene = new Scene(), parent = new Group(), camera = new PerspectiveCamera(); scene.add(parent);
  parent.position.set(4, 3, 2);
  const targets = OPENING_TOUR_SHADERS.map(([name, materialName], i) => {
    const material = new MeshBasicMaterial({ name: materialName });
    const mesh = new Mesh(new BoxGeometry(), material); mesh.name = name; mesh.frustumCulled = i % 2 === 0;
    mesh.position.set(i, 0, -50); parent.add(mesh); return mesh;
  });
  scene.updateMatrixWorld(true);
  return { scene, parent, camera, targets };
}

test('temporal warmup compiles the HDR pass but only submits after the real opening reflection', async t => {
  const events = [];
  t.mock.method(RenderPipeline.prototype, 'render', () => events.push('render'));
  const { scene, camera } = fixture();
  const initialTarget = {}, initialMRT = {};
  let target = initialTarget, mrt = initialMRT;
  const renderer = {
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getMRT: () => mrt, setMRT: value => { mrt = value; },
    async compileAsync(root, view) {
      assert.equal(root, scene); assert.equal(view, camera);
      assert.notEqual(target, initialTarget); assert.notEqual(mrt, initialMRT);
      events.push('compile');
    },
    async readRenderTargetPixelsAsync() { events.push('fence'); },
  };
  const temporal = createTemporalRenderer(renderer, scene, camera);
  try {
    await temporal.warmup();
    assert.deepEqual(events, ['compile']);
    assert.equal(target, initialTarget); assert.equal(mrt, initialMRT);
    events.push('reflection');
    temporal.render(); await temporal.finishFirstFrame();
    assert.deepEqual(events, ['compile', 'reflection', 'render', 'fence']);
  } finally { temporal.dispose(); }
});

test('opening warmup selects only the twenty-two measured object/material pairs and preserves hierarchy, state and actual render context', async () => {
  const { scene, parent, camera, targets } = fixture();
  const wrongMaterial = targets[0].clone(); wrongMaterial.material = new MeshBasicMaterial({ name: 'Unrelated gold' }); parent.add(wrongMaterial);
  const wrongObject = targets[1].clone(); wrongObject.name += ' Unmeasured object'; parent.add(wrongObject);
  const hidden = new Group(); hidden.visible = false; hidden.add(targets[2].clone()); scene.add(hidden);
  assert.equal(OPENING_TOUR_SHADERS.length, 22); assert.deepEqual(openingTourShaderMeshes(scene), targets);
  const states = targets.map(mesh => ({ parent: mesh.parent, culled: mesh.frustumCulled, visible: mesh.visible, geometry: mesh.geometry, material: mesh.material, world: mesh.matrixWorld.clone() }));
  const calls = [], progress = [];
  const renderer = { target: { name: 'actual HDR and velocity' }, mrt: {}, async compileAsync(selection, view, targetScene, report) {
    assert.equal(view, camera); assert.equal(targetScene, scene); assert.equal(selection.parent, null);
    assert.equal(selection.matrixWorldAutoUpdate, false); assert.deepEqual(selection.children, targets);
    for (const mesh of selection.children) {
      assert.equal(mesh.parent, parent); assert.equal(mesh.frustumCulled, false); assert.equal(mesh.visible, true);
    }
    report({lengthComputable: true, loaded: 22, total: 22});
    calls.push(selection);
  } };
  const target = renderer.target, mrt = renderer.mrt;
  assert.equal(await warmOpeningTourShaders(renderer, scene, camera, undefined, (...p) => progress.push(p)), 22);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].children, []);
  assert.equal(renderer.target, target); assert.equal(renderer.mrt, mrt);
  assert.deepEqual(progress[0], [0, 22]); assert.deepEqual(progress.at(-1), [22, 22]);
  targets.forEach((mesh, i) => {
    const state = states[i];
    for (const key of ['parent', 'visible', 'geometry', 'material']) assert.equal(mesh[key], state[key]);
    assert.equal(mesh.frustumCulled, state.culled); assert.ok(mesh.matrixWorld.equals(state.world));
  });
});

test('failed or cancelled targeted compilation restores every original culling flag', async () => {
  for (const kind of ['failure', 'abort']) {
    const { scene, camera, targets } = fixture(); const controller = new AbortController();
    let calls = 0;
    const renderer = { async compileAsync(selection, view, targetScene, report) {
      calls++;
      if (kind === 'failure') throw Error('device lost');
      controller.abort();
      report({ lengthComputable: true, loaded: 1, total: 22 });
      assert.fail('aborted compile must stop at its next progress callback');
    } };
    await assert.rejects(warmOpeningTourShaders(renderer, scene, camera, controller.signal), kind === 'failure' ? /device lost/ : { name: 'AbortError' });
    assert.equal(calls, 1); targets.forEach((mesh, i) => assert.equal(mesh.frustumCulled, i % 2 === 0));
  }
});

test('renamed or absent source assets do not broaden the warmup', async () => {
  let calls = 0;
  const count = await warmOpeningTourShaders({ async compileAsync() { calls++; } }, new Scene(), new PerspectiveCamera());
  assert.equal(count, 0); assert.equal(calls, 0);
});


test('mirror warmup uses the actual reflection camera, MSAA target and no MRT; restores everything on failure and never renders', async () => {
  for (const failed of [false, true]) {
    const { scene, parent, camera: view, targets } = fixture();
    const assembly = new Group(), pane = new Mesh(new PlaneGeometry(4, 3), new MeshBasicMaterial());
    pane.userData.mdPlanarMirror = true; assembly.add(pane); scene.add(assembly);
    // Facing away makes the mirror invisible: warmup must still prepare its
    // future framebuffer/cache without rendering an offscreen scene.
    view.position.set(0, 1, 5); view.lookAt(0, 1, 10); view.updateMatrixWorld();
    const mirror = createGalleryMirror(assembly), initialTarget = {}, initialMRT = {};
    let target = initialTarget, mrt = initialMRT, calls = 0, mirrorTarget, mirrorCamera;
    const renderer = { autoClear: false, getRenderTarget: () => target, getMRT: () => mrt,
      setRenderTarget: value => { target = value; }, setMRT: value => { mrt = value; },
      getDrawingBufferSize: value => value.set(1280, 720), render: () => assert.fail('warmup cannot submit a frame'),
      async compileAsync(selection, camera, contextScene) {
        calls++; assert.equal(contextScene, scene); assert.deepEqual(selection.children, targets);
        assert.ok(targets.every(mesh => mesh.parent === parent)); assert.equal(pane.visible, false);
        assert.equal(mrt, null); assert.equal(target.samples, 4); assert.equal(target.texture.type, HalfFloatType);
        assert.equal(target.texture.name, 'Gallery mirror reflection'); assert.notEqual(camera, view);
        if (mirrorTarget) { assert.equal(target, mirrorTarget); assert.equal(camera, mirrorCamera); }
        mirrorTarget = target; mirrorCamera = camera;
        if (failed) throw Error('test compile failed');
      }
    };
    if (failed) await assert.rejects(mirror.warmup(renderer, scene, view), /test compile failed/);
    else assert.equal(await mirror.warmup(renderer, scene, view), 22);
    assert.equal(calls, 1); assert.equal(pane.visible, true);
    assert.equal(target, initialTarget); assert.equal(mrt, initialMRT); assert.equal(renderer.autoClear, false);
    assert.equal(targets[0].frustumCulled, true); mirror.dispose();
  }
});
