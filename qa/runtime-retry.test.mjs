import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual effect, including its cleanup, with deferred GPU teardown.
// Only the import and external browser/React bindings are replaced.
const source = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[1]?.getText(ast) === '[generation]') effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(effect);
const compiled = ts.transpileModule(`exports.effect = ${effect.replace("import('@/runtime/SceneRuntime')", 'Promise.resolve({ SceneRuntime })')};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

test('rapid retries and StrictMode cleanup never overlap old/new GPU lifetimes or dispose a newer instance', async () => {
  const instances = [], setters = [];
  class SceneRuntime {
    constructor(_container, callbacks) { this.callbacks = callbacks; this.initialized = deferred(); this.gpu = deferred(); this.disposals = 0; instances.push(this); }
    setQuality() {} setReducedMotion() {}
    init() { this.initStarted = true; return this.initialized.promise; }
    dispose() {
      if (!this.disposal) { this.disposals++; this.disposal = this.initialized.promise.then(() => this.gpu.promise); }
      return this.disposal;
    }
  }
  const context = { exports: {}, SceneRuntime, Promise, URLSearchParams,
    window: { matchMedia: () => ({ matches: false }), location: { search: '?mode=3d' } },
    viewport: { current: {} }, runtime: { current: null }, teardown: { current: Promise.resolve() },
    loadingPublisher: { current: null }, modeRef: { current: 'loading' }, menuRef: { current: false },
    transitionRef: { current: false }, welcomeRef: { current: true }, studioOpenRef: { current: false },
    studioOpener: { current: null }, quality: 'high', tourProgress: { set() {} }, tourCompleteRef: { current: false },
    createLoadingProgressPublisher: () => ({ push() {}, flush() {}, dispose() {} }),
  };
  for (const name of new Set(effect.match(/\bset[A-Z]\w*(?=\()/g))) if (!['setQuality', 'setReducedMotion', 'setPaused'].includes(name))
    context[name] = value => setters.push([name, value]);
  context.setReducedMotion = value => setters.push(['setReducedMotion', value]);
  vm.runInNewContext(compiled, context);
  const run = context.exports.effect;
  const firstCleanup = run(); await flush();
  assert.equal(instances.length, 1); assert.equal(instances[0].initStarted, true);
  const parentCommitsBefore = setters.length;
  for (let i = 1; i < 100; i++) instances[0].callbacks.onTourProgress(i / 100);
  assert.equal(setters.length, parentCommitsBefore, 'intermediate tour progress must not update parent React state');
  instances[0].callbacks.onTourProgress(1);
  assert.deepEqual(setters.at(-1), ['setTourComplete', true], 'end-of-tour handoff still updates immediately');
  instances[0].callbacks.onTourProgress(.4);
  assert.deepEqual(setters.at(-1), ['setTourComplete', false], 'seeking away from the end restores the cinematic UI');
  firstCleanup();
  const cancelledCleanup = run(); await flush(); cancelledCleanup();
  const lastCleanup = run(); await flush();
  assert.equal(instances.length, 1, 'both retries must wait for the pending initializer');
  instances[0].initialized.resolve(); await flush();
  assert.equal(instances.length, 1, 'a resolved initializer is not a released GPU');
  instances[0].gpu.resolve(); await flush();
  assert.equal(instances.length, 2, 'the cancelled middle attempt must never allocate a renderer');
  assert.equal(context.runtime.current, instances[1]);
  assert.equal(instances[0].disposals, 1, 'initialization completion and effect cleanup share teardown');
  assert.equal(instances[1].disposals, 0);
  instances[1].initialized.resolve(); await flush(); lastCleanup();
  assert.equal(context.runtime.current, null);
  instances[1].gpu.resolve(); await context.teardown.current;
  assert.equal(instances[1].disposals, 1);
});
