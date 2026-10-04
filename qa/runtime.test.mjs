import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { Vector3, Quaternion } from 'three';
import { createAssetLoadGuard } from '../src/runtime/rendering/loadingGuard.ts';
import { resolveAssetDependency } from '../src/runtime/rendering/assets.ts';

// Execute the delivered runtime methods without a GPU or asset load. Only imports
// used by init/loadSource are omitted; the frame loop and transitions stay intact.
const source = fs.readFileSync(new URL('../src/runtime/SceneRuntime.ts', import.meta.url), 'utf8');
const threeImport = source.split(/\r?\n/)[0].replace("'three'", JSON.stringify(import.meta.resolve('three')));
const body = source.replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const cinematicImport = `import { CINEMATIC_SECONDS } from ${JSON.stringify(new URL('../src/runtime/rendering/cinematic.ts', import.meta.url).href)};`;
const { SceneRuntime } = await import(`data:text/javascript;base64,${Buffer.from(`${threeImport}\n${cinematicImport}\n${compiled}`).toString('base64')}`);

function fixture(mode = 'explore') {
  globalThis.document = { hidden: false, pointerLockElement: null };
  const runtime = new SceneRuntime({ clientWidth: 1280, clientHeight: 720 });
  const stats = { shadowPasses: 0, characterFrames: 0, samples: 0, mixerTimes: [] };
  const shadow = { needsUpdate: false };
  const controls = {
    enabled: true, visible: mode !== 'tour',
    update() { if (!this.enabled) return false; stats.characterFrames++; return true; },
    setEnabled(value) { this.enabled = value; },
    enterExplore() { this.visible = true; this.enabled = true; },
    exitExplore() { this.visible = false; this.enabled = false; },
  };
  runtime.mode = mode; runtime.controls = controls;
  runtime.inspectionEnabled = true;
  runtime.clock = { getDelta: () => 1 / 60 };
  runtime.lighting = { sun: { shadow }, refreshProbeLighting() {} };
  runtime.renderer = {
    domElement: { style: {} },
    render() { if (shadow.needsUpdate) { stats.shadowPasses++; shadow.needsUpdate = false; } },
  };
  runtime.manifest = { cameras: [{ id: 'audit', position: [3, 2, 1], target: [0, 1, 0], fov: 45 }] };
  runtime.cinematic = { sample(progress) { stats.samples++; return { position: new Vector3(progress, 2, 3), quaternion: new Quaternion(), fov: 54 }; } };
  runtime.quality = 'high';
  const frames = count => { for (let i = 0; i < count; i++) runtime.tick(); };
  return { runtime, controls, shadow, stats, frames };
}

test('moving and idle characters refresh shadows; reference, menu and disabled frames reuse them', () => {
  const { runtime, controls, stats, frames } = fixture();
  frames(12);
  assert.equal(stats.shadowPasses, 12);
  assert.equal(stats.characterFrames, 12, 'idle animation must continue advancing');
  runtime.setReferenceCamera('audit'); frames(12);
  assert.equal(stats.shadowPasses, 13, 'entering a reference view refreshes once');
  assert.equal(stats.characterFrames, 12, 'reference views must freeze the character');
  runtime.setReferenceCamera(''); frames(1);
  assert.equal(stats.shadowPasses, 14, 'returning to exploration refreshes the current pose');
  runtime.setPaused(true); frames(12);
  assert.equal(stats.shadowPasses, 14);
  runtime.setPaused(false); frames(1);
  assert.equal(stats.shadowPasses, 15);
  controls.setEnabled(false); frames(12);
  assert.equal(stats.shadowPasses, 15, 'disabled controller update must not mark a static shadow dirty');
});

test('hiding and showing the character refreshes once during each frozen fade', () => {
  const { runtime, controls, stats, frames } = fixture();
  runtime.returnToTour(); frames(44);
  assert.equal(runtime.mode, 'tour'); assert.equal(controls.visible, false);
  assert.equal(stats.shadowPasses, 1, 'the disappearing character cannot leave a stale shadow');
  runtime.exploreDirectly(); frames(41);
  assert.equal(controls.visible, true);
  assert.equal(controls.enabled, false, 'the second half of the fade still freezes simulation');
  assert.equal(stats.shadowPasses, 2, 'the appearing character gets a shadow before controls resume');
  frames(4);
  assert.equal(controls.enabled, true);
  assert.ok(stats.shadowPasses > 2, 'active character animation resumes shadow updates');
});

test('stopped cinematic poses are sampled once; source animation and material changes refresh shadows', () => {
  const { runtime, stats, frames } = fixture('tour');
  runtime.mixers = [{ duration: 4, mixer: { setTime(time) { stats.mixerTimes.push(time); } } }];
  frames(12);
  assert.equal(stats.samples, 1); assert.equal(stats.mixerTimes.length, 1); assert.equal(stats.shadowPasses, 1);
  runtime.setTourProgress(0.5); frames(12);
  assert.equal(stats.samples, 2); assert.equal(stats.shadowPasses, 2);
  runtime.setReferenceCamera('audit'); frames(1);
  runtime.setReferenceCamera(''); frames(1);
  assert.equal(stats.samples, 3, 'restoring the tour forcibly reapplies its cached pose');
  assert.equal(stats.shadowPasses, 4);
  runtime.setReferenceCamera('audit'); frames(1);
  runtime.returnToTour(); frames(1);
  assert.equal(stats.samples, 4, 'returning through the tour action also restores a stopped camera');
  assert.equal(runtime.camera.position.x, 0.5);
  runtime.diagnostics = { setMode() {} };
  runtime.setDiagnosticMode('albedo'); frames(12);
  assert.equal(stats.shadowPasses, 7, 'a material diagnostic switch refreshes once');
  runtime.setCinematicPlaying(true); frames(5);
  assert.equal(stats.shadowPasses, 12, 'changing source clips retain animated shadows');
  runtime.setTourProgress(1); frames(1);
  runtime.setCinematicPlaying(true); frames(1);
  assert.equal(runtime.cinematicPlaying, false, 'a cached final pose still stops playback');
});

test('a swallowed glTF image failure prevents readiness while a fresh retry is clean', context => {
  context.mock.method(console, 'error', () => {});
  const guard = createAssetLoadGuard();
  guard.manager.itemStart('/assets/required-normal.ktx2');
  guard.manager.itemError('/assets/required-normal.ktx2');
  guard.manager.itemEnd('/assets/required-normal.ktx2');
  assert.throws(() => guard.assertLoaded(), /scene texture could not be loaded/);
  assert.doesNotThrow(() => createAssetLoadGuard().assertLoaded());
});

test('root-relative glTF dependencies retain the external asset release prefix', () => {
  const base = 'https://cdn.example.com/releases/lounge-2026';
  const page = 'https://lounge.example.com/';
  assert.equal(resolveAssetDependency('/assets/v2/a.ktx2', base, page), `${base}/assets/v2/a.ktx2`);
  assert.equal(resolveAssetDependency('https://cdn.example.com/assets/v2/a.ktx2?v=3', base, page), `${base}/assets/v2/a.ktx2?v=3`);
  assert.equal(resolveAssetDependency(`${base}/assets/v2/a.ktx2`, base, page), `${base}/assets/v2/a.ktx2`);
  assert.equal(resolveAssetDependency('https://other.example.com/assets/a.jpg', base, page), 'https://other.example.com/assets/a.jpg');
  assert.equal(resolveAssetDependency('blob:local-image', base, page), 'blob:local-image');
  assert.equal(resolveAssetDependency('/assets/v2/a.ktx2', '', page), '/assets/v2/a.ktx2');
  const guard = createAssetLoadGuard(url => resolveAssetDependency(url, base, page));
  assert.equal(guard.manager.resolveURL('https://cdn.example.com/assets/a.ktx2'), `${base}/assets/a.ktx2`);
});
