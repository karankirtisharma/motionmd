import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.env.MD_PROJECT_ROOT ? pathToFileURL(process.env.MD_PROJECT_ROOT.replace(/[\\/]?$/, '/')) : new URL('../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const ts = require('typescript');
const controllerSource = fs.readFileSync(process.env.MD_CONTROLLER_SOURCE ?? new URL('src/runtime/interaction/InteractionController.ts', root), 'utf8');
const pageSource = fs.readFileSync(new URL('src/components/LoungeHome.tsx', root), 'utf8');
const controller = ts.createSourceFile('InteractionController.ts', controllerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const page = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(); let consume, unlock;
function scanController(node) {
  if (ts.isFunctionDeclaration(node) && ['resetInput', 'releaseCursor', 'exitExplore'].includes(node.name?.text)) functions.set(node.name.text, node.getText(controller));
  if (ts.isMethodDeclaration(node) && node.name.getText(controller) === 'consumeIntentionalUnlock') consume = node.body.getText(controller);
  ts.forEachChild(node, scanController);
}
function scanPage(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'unlock') unlock = node.initializer.getText(page);
  ts.forEachChild(node, scanPage);
}
scanController(controller); scanPage(page);
assert.equal(functions.size, 3); assert.ok(consume); assert.ok(unlock);
const compiled = ts.transpileModule(`${[...functions.values()].join('\n')}
function consumeIntentionalUnlock() ${consume}
const unlock = ${unlock};
exports.api = { exitExplore, releaseCursor, consumeIntentionalUnlock, unlock };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(locked = true) {
  const queue = [], canvas = {}, calls = [];
  const context = { exports: {}, canvas, intentionalUnlock: false, enabled: true, dragging: true, chairPointer: {},
    keys: new Set(['KeyW']), virtual: { x: 1, y: 1, sprint: true }, avatar: { root: { visible: true }, setBodyView: value => calls.push(['body', value]) },
    physics: { setDeskClearance: value => calls.push(['desk', value]) }, lift: { reset: () => calls.push(['lift']) },
    display: { setActive: value => calls.push(['display', value]) }, options: { onScreenMode: value => calls.push(['screen', value]) },
    prompt: value => calls.push(['prompt', value]), runtime: { current: null }, modeRef: { current: 'explore' },
    menus: 0, paused: false,
  };
  context.document = { pointerLockElement: locked ? canvas : null,
    exitPointerLock() { this.pointerLockElement = null; queue.push(() => context.exports.api.unlock()); } };
  context.openMenu = () => { context.menus++; context.paused = true; };
  vm.runInNewContext(compiled, context);
  context.runtime.current = { consumeIntentionalUnlock: context.exports.api.consumeIntentionalUnlock };
  return { context, api: context.exports.api, calls, flush: () => { while (queue.length) queue.shift()(); } };
}

test('navigation exit/re-entry does not mistake the queued intentional unlock for user Escape', () => {
  const { context, api, flush } = fixture();
  api.exitExplore();
  assert.equal(context.document.pointerLockElement, null); assert.equal(context.enabled, false); assert.equal(context.avatar.root.visible, false);
  assert.equal(context.keys.size, 0); assert.equal(context.virtual.x, 0); assert.equal(context.virtual.y, 0); assert.equal(context.dragging, false);
  // An inspection reset or scene transition re-enters before the browser dispatches pointerlockchange.
  context.enabled = true; context.avatar.root.visible = true; context.modeRef.current = 'explore';
  flush();
  assert.equal(context.menus, 0); assert.equal(context.paused, false); assert.equal(api.consumeIntentionalUnlock(), false, 'the marker is consumed exactly once');
  // The next native Escape is still allowed to open the menu.
  context.document.pointerLockElement = context.canvas; context.document.exitPointerLock(); flush();
  assert.equal(context.menus, 1); assert.equal(context.paused, true);
});

test('ordinary Escape release remains non-intentional and opens the exploration menu', () => {
  const { context, api, flush } = fixture(); api.releaseCursor(); flush();
  assert.equal(context.menus, 1); assert.equal(context.paused, true);
});

test('exit while already unlocked does not suppress a later genuine unlock', () => {
  const { context, api, flush } = fixture(false); api.exitExplore(); flush();
  assert.equal(api.consumeIntentionalUnlock(), false); assert.equal(context.menus, 0);
  context.document.pointerLockElement = context.canvas; context.document.exitPointerLock(); flush();
  assert.equal(context.menus, 1);
});
