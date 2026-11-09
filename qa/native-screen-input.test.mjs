import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeScreenInput } from '../src/runtime/presentation/nativeScreenInput.ts';

function event(target, type, values = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, values); target.dispatchEvent(e); return e;
}
function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const win = new EventTarget(), child = new EventTarget(), doc = new EventTarget();
  Object.assign(doc, { hidden: false, pointerLockElement: null, hasFocus: () => true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  const canvas = { ownerDocument: doc, style: { pointerEvents: 'auto' }, focus() { doc.activeElement = canvas; } };
  const frame = { contentDocument: {}, contentWindow: child };
  doc.activeElement = frame;
  let rays = 0, focuses = 0;
  const input = createNativeScreenInput({ canvas, frame: () => frame, exclusive: true,
    hit: () => { rays++; return null; }, onFocus: () => { focuses++; doc.pointerLockElement = null; } });
  input.refreshFrame();
  t.after(() => { input.dispose(); if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  return { win, child, doc, canvas, frame, input, rays: () => rays, focuses: () => focuses };
}

test('seated native desktop takes input immediately, without hover or a second camera ray gate', t => {
  const f = fixture(t); f.doc.pointerLockElement = f.canvas;
  f.input.setEnabled(true);
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.canvas.style.pointerEvents, 'none');
  assert.equal(f.focuses(), 1);
  let clicks = 0;
  f.child.addEventListener('click', () => clicks++);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'wheel', 'contextmenu']) {
    const e = event(f.child, type, { clientX: 630, clientY: 670, button: 0, buttons: type === 'pointerdown' ? 1 : 0, pointerId: 1, detail: 1 });
    assert.equal(e.defaultPrevented, false, type);
  }
  assert.equal(clicks, 1); assert.equal(f.rays(), 0);
  // Neither a camera update nor passing over the HUD can steal the next app click.
  f.input.updateCamera(undefined);
  event(f.win, 'pointermove', { clientX: 20, clientY: 20, buttons: 0 });
  assert.equal(f.canvas.style.pointerEvents, 'none');
});

test('leaving or disposing the desktop restores room pointer input, including repeated sessions', async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    f.input.setEnabled(true); assert.equal(f.canvas.style.pointerEvents, 'none');
    f.input.setEnabled(false); assert.equal(f.canvas.style.pointerEvents, 'auto');
  }
  f.input.setEnabled(true);
  // Returning after switching browser tabs must restore native input ownership.
  f.doc.activeElement = f.canvas; event(f.win, 'blur'); await Promise.resolve();
  assert.equal(f.canvas.style.pointerEvents, 'auto');
  event(f.win, 'focus'); assert.equal(f.canvas.style.pointerEvents, 'none');
  f.input.dispose(); assert.equal(f.canvas.style.pointerEvents, 'auto');
  event(f.win, 'focus'); assert.equal(f.canvas.style.pointerEvents, 'auto');
});
