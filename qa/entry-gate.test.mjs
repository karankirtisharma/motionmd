import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { isAndroidPhone } from '../src/studio/lib/entryDevice.ts';

const require = createRequire(import.meta.url);
const phone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const tablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

function componentHarness(name, device, saved = '3d', search = '?mode=3d&debug=1') {
  const state = [], effects = [], replacements = [];
  let index = 0, initialized = false, storageReads = 0;
  const source = fs.readFileSync(new URL(`../src/studio/components/${name}.tsx`, import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exported = {};
  const context = {
    exports: exported, require, isAndroidPhone,
    navigator: device,
    location: { search, replace: url => replacements.push(url) },
    localStorage: { getItem() { storageReads++; return saved; } },
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
    useEffect(effect) { if (!initialized) effects.push(effect); },
    useRef(value) { return { current: value }; },
    usePlayer() { return { setPlaying() {} }; },
  };
  vm.runInNewContext(compiled, context);
  const Component = exported.default ?? exported.LoungeBridge;
  const child = { id: 'expensive-scene-sentinel' };
  const render = () => { index = 0; return Component({ children: child, embedded: false }); };
  return { render, child, replacements, flush() { initialized = true; effects.splice(0).forEach(effect => effect()); }, get storageReads() { return storageReads; } };
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [tree, ...[children].flat(Infinity).flatMap(elements)];
}

test('Android phones are direct studio visitors; Android tablets, iPads and desktop are not', () => {
  assert.equal(isAndroidPhone({ userAgent: phone }), true);
  assert.equal(isAndroidPhone({ userAgent: tablet }), false);
  assert.equal(isAndroidPhone({ userAgent: 'Android; Tablet; Mobile', userAgentData: { mobile: true } }), false);
  assert.equal(isAndroidPhone({ userAgent: 'reduced', userAgentData: { platform: 'Android', mobile: true } }), true);
  assert.equal(isAndroidPhone({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18)' }), false);
  assert.equal(isAndroidPhone({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false);
});

test('saved preferences and old direct-3D URLs cannot mount the lounge before an explicit click', () => {
  for (const saved of ['3d', 'light', null]) {
    for (const ua of [tablet, 'Mozilla/5.0 (Windows NT 10.0)']) {
      const h = componentHarness('LoungeEntry', { userAgent: ua }, saved);
      assert.notEqual(h.render(), h.child);
      h.flush();
      const tree = h.render();
      assert.notEqual(tree, h.child);
      assert.equal(h.storageReads, 0);
      assert.deepEqual(h.replacements, []);
      assert.ok(elements(tree).some(e => e.type === 'a' && e.props.href === '/studio?entry=direct'));
      const explore = elements(tree).find(e => e.type === 'button');
      assert.ok(explore, 'desktop/tablet can opt into 3D');
      explore.props.onClick();
      assert.equal(h.render(), h.child, 'only the explicit click mounts the real lounge child');
    }
  }
});

test('Android phone redirects before offering or mounting 3D, even with saved 3D and mode=3d', () => {
  const h = componentHarness('LoungeEntry', { userAgent: phone });
  assert.equal(elements(h.render()).some(e => e.type === 'button'), false);
  h.flush();
  assert.deepEqual(h.replacements, ['/studio?entry=direct']);
  assert.notEqual(h.render(), h.child);
  assert.equal(elements(h.render()).some(e => e.type === 'button'), false);
  assert.equal(h.storageReads, 0);
});

test('standalone studio never offers a 3D link to Android phones, including the first render', () => {
  for (const ua of [phone, tablet, 'Mozilla/5.0 (Windows NT 10.0)']) {
    const h = componentHarness('LoungeBridge', { userAgent: ua });
    assert.equal(h.render(), null);
    h.flush();
    const result = h.render();
    if (ua === phone) assert.equal(result, null);
    else assert.equal(result.props.href, '/?mode=3d');
  }
});
