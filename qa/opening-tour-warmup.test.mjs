import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, BoxGeometry, PlaneGeometry, MeshBasicMaterial, PerspectiveCamera, HalfFloatType } from 'three';
import { RenderPipeline } from 'three/webgpu';
import { createGalleryMirror } from '../src/runtime/rendering/galleryMirror.ts';
import { createTemporalRenderer } from '../src/runtime/rendering/TemporalRenderer.ts';
import { OPENING_TOUR_SHADERS, openingTourShaderMeshes, warmOpeningTourShaders } from '../src/runtime/rendering/openingTourWarmup.ts';
import { UPPER_GALLERY_SHADERS } from '../src/runtime/rendering/upperGalleryShaders.ts';

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

test('opening renderer waits for the real reflection and has no redundant standalone compile', async t => {
  const events = [];
  t.mock.method(RenderPipeline.prototype, 'render', () => events.push('render'));
  const { scene, camera } = fixture();
  const renderer = {
    compileAsync() { assert.fail('the main pipeline must not compile the entire scene again'); },
    async readRenderTargetPixelsAsync() { events.push('fence'); },
  };
  const temporal = createTemporalRenderer(renderer, scene, camera);
  try {
    assert.deepEqual(events, []);
    events.push('reflection');
    temporal.render(); await temporal.finishFirstFrame();
    assert.deepEqual(events, ['reflection', 'render', 'fence']);
  } finally { temporal.dispose(); }
});

test('opening warmup preserves the original twenty-two exact object/material matches, hierarchy and actual render context', async () => {
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

test('opening visitor preparation renders to its own target and restores a clean tour even on a hidden-tab frame', async t => {
  for (const outcome of ['same-frame', 'next-frame', 'abort-before', 'abort-at-fence', 'draw-failed']) {
    const { scene, camera } = fixture(), visitor = new Group(), shadow = { needsUpdate: false };
    visitor.visible = false; scene.add(visitor);
    const controller = new AbortController(), initialTarget = {}, initialMRT = {}, events = [];
    let target = initialTarget, mrt = initialMRT, disposed = 0;
    const projection = camera.projectionMatrix.clone();
    const renderer = {
      xr: { enabled: true }, toneMapping: 3, outputColorSpace: 'srgb', info: { frame: 4 },
      getRenderTarget: () => target, setRenderTarget: v => { target = v; },
      getMRT: () => mrt, setMRT: v => { mrt = v; },
      async readRenderTargetPixelsAsync(rt) {
        assert.notEqual(rt, initialTarget);
        assert.equal(visitor.visible, false); assert.equal(shadow.needsUpdate, true);
        assert.equal(target, initialTarget); assert.equal(mrt, initialMRT);
        events.push('fence');
        if (outcome === 'next-frame') this.info.frame++;
        if (outcome === 'abort-at-fence') controller.abort();
      },
    };
    const temporal = createTemporalRenderer(renderer, scene, camera);
    const render = t.mock.method(RenderPipeline.prototype, 'render', () => {
      if (visitor.visible) {
        events.push('warm');
        assert.equal(target.width, 1); assert.equal(target.height, 1); assert.equal(mrt, null);
        target.addEventListener('dispose', () => disposed++);
        renderer.toneMapping = 0; renderer.outputColorSpace = 'working'; renderer.xr.enabled = false;
        camera.setViewOffset(100, 100, 1, 0, 100, 100); shadow.needsUpdate = false;
        if (outcome === 'draw-failed') throw Error('failed warm pass');
      } else {
        events.push('clean');
        assert.equal(target, initialTarget); assert.equal(mrt, initialMRT);
        assert.equal(shadow.needsUpdate, true); assert.ok(camera.projectionMatrix.equals(projection));
      }
    });
    try {
      if (outcome === 'abort-before') controller.abort();
      const result = temporal.renderOpeningFrame(visitor, shadow, controller.signal);
      if (outcome === 'same-frame' || outcome === 'next-frame') await result; else await assert.rejects(result);
      const expected = outcome === 'abort-before' ? [] : outcome === 'draw-failed' ? ['warm'] :
        outcome === 'abort-at-fence' ? ['warm', 'fence'] : ['warm', 'fence', 'clean'];
      assert.deepEqual(events, expected); assert.equal(disposed, expected.length ? 1 : 0);
      assert.equal(visitor.visible, false); assert.equal(visitor.parent, scene);
      assert.equal(renderer.toneMapping, 3); assert.equal(renderer.outputColorSpace, 'srgb'); assert.equal(renderer.xr.enabled, true);
      assert.equal(target, initialTarget); assert.equal(mrt, initialMRT); assert.ok(camera.projectionMatrix.equals(projection));
    } finally { render.mock.restore(); temporal.dispose(); }
  }
});

test('upper-gallery reflection preparation deduplicates the measured route and admits the hidden visitor only for compilation', async () => {
  const { scene, camera, targets } = fixture(), visitor = new Group();
  visitor.visible = false;
  scene.add(visitor);
  const expected = [...targets];
  assert.equal(UPPER_GALLERY_SHADERS.length, 102);
  for (const [name, materialName] of UPPER_GALLERY_SHADERS) {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ name: materialName }));
    mesh.name = name;
    if (/^m005_/.test(materialName)) { mesh.isSkinnedMesh = true; visitor.add(mesh); }
    else scene.add(mesh);
    expected.push(mesh);
  }
  const actual = openingTourShaderMeshes(scene);
  assert.equal(actual.length, new Set(actual).size);
  assert.deepEqual(new Set(actual), new Set(expected));
  const culled = new Map(actual.map(mesh => [mesh, mesh.frustumCulled]));
  await assert.rejects(warmOpeningTourShaders({ async compileAsync(group) {
    assert.equal(visitor.visible, false);
    assert.deepEqual(new Set(group.children), new Set(expected));
    assert.ok(group.children.every(mesh => !mesh.frustumCulled));
    throw Error('gallery compile cancelled');
  } }, scene, camera), /gallery compile cancelled/);
  assert.equal(visitor.visible, false);
  assert.ok(actual.every(mesh => mesh.frustumCulled === culled.get(mesh)));
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

test('measured reflection and visitor draws use the real mirror target and restore the room on every exit', async () => {
  for (const outcome of ['ok', 'throw', 'abort']) {
    const { scene, camera, targets: [wall] } = fixture(), assembly = new Group();
    const pane = new Mesh(new PlaneGeometry(4, 3), new MeshBasicMaterial());
    pane.userData.mdPlanarMirror = true; assembly.add(pane); scene.add(assembly);
    const visitor = new Group(), skin = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    skin.isSkinnedMesh = true; visitor.add(skin); visitor.visible = false; scene.add(visitor);
    const unrelated = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); scene.add(unrelated);
    camera.position.set(0, 1, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    const mirror = createGalleryMirror(assembly), controller = new AbortController();
    const initialTarget = {}, initialMRT = {}, rendered = [], shadow = { needsUpdate: false };
    const source = object => rendered.push(object);
    let target = initialTarget, mrt = initialMRT, filter = source, frames = 0, reflectedView;
    const renderer = { autoClear: false, shadowMap: { enabled: true },
      getRenderTarget:()=>target, setRenderTarget:value=>{target=value;},
      getMRT:()=>mrt, setMRT:value=>{mrt=value;},
      getRenderObjectFunction:()=>filter, setRenderObjectFunction:value=>{filter=value;},
      getDrawingBufferSize:v=>v.set(1280,720),
      async compileAsync(selection, view) { reflectedView = view; assert.equal(visitor.visible, false); },
      render(root, view) {
        frames++;
        assert.equal(root, scene); assert.equal(view, reflectedView); assert.notEqual(view, camera);
        assert.equal(visitor.visible, true); assert.equal(pane.visible, false); assert.equal(shadow.needsUpdate, true);
        assert.equal(this.autoClear, true); assert.equal(target.texture.name, 'Gallery mirror reflection'); assert.equal(mrt, null);
        assert.equal(wall.frustumCulled, false);
        filter(wall); filter(unrelated); filter(skin); shadow.needsUpdate = false;
        if (outcome === 'throw') throw Error('simulated GPU failure');
        if (outcome === 'abort') controller.abort();
      },
    };
    try {
      const result = mirror.warmup(renderer, scene, camera, controller.signal, undefined, { root: visitor, sun: { shadow } });
      if (outcome === 'throw' || outcome === 'abort') await assert.rejects(result); else await result;
      assert.equal(frames, 1); assert.deepEqual(rendered, [wall, skin]); assert.equal(wall.frustumCulled, true);
      assert.equal(filter, source); assert.equal(renderer.autoClear, false); assert.equal(shadow.needsUpdate, true);
      assert.equal(target, initialTarget); assert.equal(mrt, initialMRT); assert.equal(visitor.visible, false); assert.equal(pane.visible, true);
      if (outcome === 'ok') {
        renderer.render = () => frames++;
        mirror.update(renderer, scene, camera, 0);
        assert.equal(frames, 2, 'the opening screen redraws its true reflection instead of displaying the warmup target');
      }
    } finally { mirror.dispose(); }
  }
});
