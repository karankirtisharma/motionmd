import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createTourProgressStore } from '../src/runtime/tourProgress.ts';

const source = fs.readFileSync(new URL('../src/components/TourProgress.tsx', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported, require: createRequire(import.meta.url), useSyncExternalStore: (_subscribe, snapshot) => snapshot() });
const elements = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)];

test('timeline subscriptions preserve every progress sample and release listeners on unmount', () => {
  const store = createTourProgressStore(), samples = [];
  const unsubscribe = store.subscribe(() => samples.push(store.getSnapshot()));
  for (const value of [.001, .2, .345, .9, 1, 0]) store.set(value);
  assert.deepEqual(samples, [.001, .2, .345, .9, 1, 0]);
  store.set(0); store.set(NaN); assert.equal(samples.length, 6);
  unsubscribe(); store.set(.2); assert.equal(samples.length, 6);
  assert.equal(store.getSnapshot(), .2); assert.equal(store.getServerSnapshot(), 0);
});

test('isolated timeline and diagnostic slider retain labels, exact values, seeking and non-store compatibility', () => {
  const store = createTourProgressStore(); store.set(.345);
  let nodes = elements(exported.TourTimeline({ store, duration: 90 }));
  const progress = nodes.find(node => node.type === 'progress');
  assert.equal(progress.props.value, .345); assert.equal(progress.props['aria-label'], 'Cinematic progress');
  assert.equal(nodes.find(node => node.props.className === 'timeline-index').props.children.join(''), '31s');
  assert.equal(nodes.find(node => node.props.className === 'timeline-end').props.children.join(''), '90s');
  assert.equal(elements(exported.TourTimeline({ progress: .4, duration: 90 })).find(node => node.type === 'progress').props.value, .4);
  let seek;
  nodes = elements(exported.TourInspectionProgress({ store, duration: 90, showPreview: true, onSeek: value => seek = value }));
  const slider = nodes.find(node => node.type === 'input');
  assert.equal(slider.props.value, .345 * 90); assert.equal(slider.props['aria-label'], 'Tour preview seconds');
  slider.props.onChange({ target: { value: '45' } }); assert.equal(seek, .5);
  assert.equal(elements(exported.TourInspectionProgress({ store, duration: 90, showPreview: false, onSeek() {} })).some(node => node.type === 'input'), false);
});
