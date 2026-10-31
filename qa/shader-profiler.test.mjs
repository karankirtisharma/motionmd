import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { PerformanceObserver } from 'node:perf_hooks';
import { observeShaderBuilds } from '../src/runtime/rendering/shaderBuildObserver.ts';
import { guardShaderCompilation } from '../src/runtime/rendering/shaderValidation.ts';

const profilerPath = new URL('../src/runtime/rendering/RuntimeProfiler.ts', import.meta.url);
const source = fs.readFileSync(profilerPath, 'utf8').replace("'./shaderBuildObserver.ts'", JSON.stringify(new URL('../src/runtime/rendering/shaderBuildObserver.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { RuntimeProfiler } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function rendererFixture() {
  const calls = [];
  const originalBuilder = (...args) => calls.push(args);
  const originalError = () => {};
  const renderer = { debug: { onNodeBuilderCreated: originalBuilder, onShaderError: originalError }, info: { memory: { programs: 10 } }, backend: {} };
  return { renderer, calls, originalBuilder, originalError };
}
function build(renderer, name = 'surface', shadow = false) {
  const record = { material: { name, isShadowPassMaterial: shadow }, object: { name: 'mesh' } };
  renderer.debug.onNodeBuilderCreated({}, record);
  return record;
}

test('public shader observer chains the real validation guard and restores callbacks', () => {
  const { renderer, calls, originalBuilder, originalError } = rendererFixture();
  const validation = guardShaderCompilation(renderer, () => assert.fail('valid render record should not fail validation'));
  const validationBuilder = renderer.debug.onNodeBuilderCreated;
  const validationError = renderer.debug.onShaderError;
  let now = 42;
  const observer = observeShaderBuilds(renderer, () => now++);
  build(renderer, 'startup');
  assert.deepEqual(observer.totals(), { buildsStarted: 1, activePrograms: 10 });
  assert.equal(observer.takeFrame().builds, 0, 'startup does not allocate captured event details');
  assert.equal(observer.start(), 10);
  build(renderer, 'stone'); build(renderer, 'shadow', true);
  renderer.info.memory.programs = 12;
  assert.deepEqual(observer.takeFrame(), { builds: 2, events: [
    { atMs: 42, material: 'stone', object: 'mesh', shadowPass: false },
    { atMs: 43, material: 'shadow', object: 'mesh', shadowPass: true },
  ], dropped: 0, activePrograms: 12 });
  validation.assertCompiled();
  assert.equal(calls.length, 3);
  assert.equal(renderer.debug.onShaderError, validationError, 'profiler never replaces validation/error callback');
  observer.dispose(); observer.dispose();
  assert.equal(renderer.debug.onNodeBuilderCreated, validationBuilder);
  validation.dispose();
  assert.equal(renderer.debug.onNodeBuilderCreated, originalBuilder);
  assert.equal(renderer.debug.onShaderError, originalError);
});

test('shader event details are bounded while aggregate build counts remain exact', () => {
  const { renderer } = rendererFixture();
  const observer = observeShaderBuilds(renderer);
  observer.start();
  for (let i = 0; i < 500; i++) build(renderer);
  const frame = observer.takeFrame();
  assert.equal(frame.builds, 500); assert.equal(frame.events.length, 256); assert.equal(frame.dropped, 244);
  assert.equal(observer.takeFrame().builds, 0);
  observer.stop(); build(renderer);
  assert.equal(observer.takeFrame().events.length, 0);
  assert.equal(observer.totals().buildsStarted, 501);
  observer.dispose();
});

test('disposing does not clobber observers installed later or stop original validation', () => {
  const { renderer, calls } = rendererFixture();
  const observer = observeShaderBuilds(renderer);
  const inner = renderer.debug.onNodeBuilderCreated;
  let laterCalls = 0;
  const later = (...args) => { laterCalls++; inner(...args); };
  renderer.debug.onNodeBuilderCreated = later;
  observer.dispose();
  assert.equal(renderer.debug.onNodeBuilderCreated, later);
  build(renderer);
  assert.equal(laterCalls, 1); assert.equal(calls.length, 1); assert.equal(observer.totals().buildsStarted, 0);
});

function profilerFixture(t) {
  const oldDocument = globalThis.document;
  const oldObserver = globalThis.PerformanceObserver;
  globalThis.document = { hidden: false };
  globalThis.PerformanceObserver = PerformanceObserver;
  const reports = [];
  const { renderer, calls } = rendererFixture();
  const profiler = new RuntimeProfiler(report => reports.push(JSON.parse(report)), () => ({ test: true }));
  profiler.attachRenderer(renderer);
  t.after(() => { profiler.dispose(); globalThis.document = oldDocument; globalThis.PerformanceObserver = oldObserver; });
  return { profiler, renderer, calls, reports };
}

test('actual profiler correlates build frames and following RAF intervals without claiming GPU compilation time', t => {
  const { profiler, renderer, calls, reports } = profilerFixture(t);
  profiler.start('build correlation');
  build(renderer, 'one'); build(renderer, 'two'); renderer.info.memory.programs = 12;
  profiler.frame(16, 1, 0, 28, true);
  profiler.frame(31, 1, 0, 2, true);
  profiler.frame(31, 1, 0, 2, true);
  build(renderer, 'three'); renderer.info.memory.programs = 13;
  profiler.frame(29, 1, 0, 2, true);
  profiler.finish();
  const capture = reports.at(-1).capture;
  const builds = capture.shaderBuilds;
  assert.equal(builds.started, 3); assert.equal(builds.framesWithBuilds, 2);
  assert.equal(builds.framesOver25MsWithSameOrPriorBuild, 2);
  assert.equal(builds.framesOver25MsWithoutRecentBuild, 1);
  assert.equal(builds.renderSubmissionsOver25MsWithBuilds, 1);
  assert.equal(builds.activeProgramsStart, 10); assert.equal(builds.activeProgramsEnd, 13); assert.equal(builds.activeProgramsPeak, 13);
  assert.equal(builds.programCountNetChange, 3); assert.equal(builds.pipelineCreations, null);
  assert.equal(builds.events.length, 3); assert.ok(builds.events.every(event => event.atMs >= 0));
  assert.equal(calls.length, 3); assert.equal(capture.callbackCadence.suitableForMatchedComparison, true);
});

test('sparse callback captures preserve raw timings but flag comparisons without assuming a cause', t => {
  const { profiler, reports } = profilerFixture(t);
  profiler.start('sparse callbacks');
  for (let i = 0; i < 18; i++) profiler.frame(1000, 1, 0, 4, true);
  profiler.finish();
  const capture = reports.at(-1).capture;
  assert.equal(capture.frames, 18); assert.equal(capture.frameMs.p50, 1000);
  assert.equal(capture.hiddenDuringCapture, false);
  assert.equal(capture.callbackCadence.intervalsAtLeast250Ms, 18);
  assert.equal(capture.callbackCadence.sparseIntervalsWithLowCpuSubmission, 18);
  assert.equal(capture.callbackCadence.suitableForMatchedComparison, false);
  assert.match(capture.callbackCadence.warning, /possible throttling, scheduling or GPU stall/);
});