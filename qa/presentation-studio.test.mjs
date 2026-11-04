import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The override lets a reviewed test draft exercise the real working tree without
// copying runtime source or dependencies into the QA directory.
const project = process.env.MD_TEST_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = relative => import(pathToFileURL(join(project, relative)).href);
const { Scene, PerspectiveCamera, Mesh, PlaneGeometry, MeshBasicMaterial } = await source('node_modules/three/build/three.module.js');
const { createPresentationScreen } = await source('src/runtime/presentation/PresentationScreen.ts');
const { createCurvedInput } = await source('src/runtime/presentation/curvedInput.ts');
const { createLiveStudioSurface } = await source('src/runtime/presentation/LiveStudioSurface.ts');
const { screenHomography, mapScreenPoint } = await source('src/runtime/presentation/projection.ts');

function styleDeclaration() {
  const values = new Map();
  return new Proxy({}, {
    get(_, key) {
      if (key === Symbol.iterator) return () => values.keys();
      if (key === 'setProperty') return (name, value) => values.set(name, String(value));
      if (key === 'getPropertyValue') return name => values.get(name) || '';
      return values.get(key) || '';
    },
    set(_, key, value) { values.set(key, String(value)); return true; },
  });
}
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.connected = true; this.target = target; target.ownerDocument.observers.push(this); }
  disconnect() { this.connected = false; }
}
class FakeWindow extends EventTarget {
  messages = [];
  MutationObserver = FakeMutationObserver;
  postMessage(...args) { this.messages.push(args); }
  getComputedStyle(element) { return element.style; }
  matchMedia() { return { matches: true }; }
  requestAnimationFrame(callback) { return globalThis.requestAnimationFrame(callback); }
  cancelAnimationFrame(id) { globalThis.cancelAnimationFrame(id); }
}
class FakeElement extends EventTarget {
  style = styleDeclaration(); dataset = {}; childNodes = []; attrs = new Map();
  parentElement = null; parentNode = null; hidden = false; textContent = ''; value = '';
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; }
  get children() { return this.childNodes; }
  getAnimations() { return []; }
  append(...nodes) {
    for (const node of nodes) { node.remove(); this.childNodes.push(node); node.parentElement = node.parentNode = this; }
  }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) { node.remove(); this.childNodes.unshift(node); node.parentElement = node.parentNode = this; }
  }
  insertBefore(node, next) {
    node.remove(); const index = this.childNodes.indexOf(next);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node); node.parentElement = node.parentNode = this;
  }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentElement = node.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(node) { const parent = this.parentNode; if (parent) { parent.insertBefore(node, this); this.remove(); } }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  toggleAttribute(name, force = !this.attrs.has(name)) { if (force) this.attrs.set(name, ''); else this.attrs.delete(name); return force; }
  contains(target) { return this === target || this.childNodes.some(child => child.contains(target)); }
  querySelector(selector) {
    if (selector.startsWith('#') && this.getAttribute('id') === selector.slice(1)) return this;
    for (const child of this.childNodes) { const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  querySelectorAll(selector) {
    // There are no styled cards or active pseudo-classes in this lifecycle fixture.
    // Actual geometry, iframe identity, messages, events, and async builds are real.
    const found = selector.startsWith('#') ? this.querySelector(selector) : null;
    return found ? [found] : [];
  }
  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.ownerDocument);
    clone.attrs = new Map(this.attrs); clone.dataset = { ...this.dataset }; clone.textContent = this.textContent; clone.value = this.value;
    for (const key of this.style) clone.style[key] = this.style[key];
    if (deep) clone.append(...this.childNodes.map(child => child.cloneNode(true)));
    return clone;
  }
  attachShadow() { this.shadowRoot = new FakeElement('shadowroot', this.ownerDocument); return this.shadowRoot; }
  getBoundingClientRect() {
    const match = this.style.transform.match(/^translate3d\(([-\d.e]+)px,([-\d.e]+)px,0\)$/);
    const left = match ? Number(match[1]) : 0, top = match ? Number(match[2]) : 0;
    const width = parseFloat(this.style.width) || 1600, height = parseFloat(this.style.height) || 560;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  focus() { this.ownerDocument.activeElement = this; this.focused = true; }
  animate(keyframes, options) {
    let resolve, reject, done = false;
    const animation = { keyframes, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      finish() { if (!done) { done = true; resolve(); } },
      cancel() { if (!done) { done = true; reject(new Error('cancelled')); } } };
    this.ownerDocument.animations.push(animation); return animation;
  }
}
class FakeDocument extends FakeElement {
  hidden = false; pointerLockElement = null; styleSheets = []; baseURI = 'https://lounge.test/studio'; animations = []; observers = []; focused = true;
  constructor() {
    super('document', null); this.ownerDocument = this;
    this.defaultView = new FakeWindow(); this.body = new FakeElement('body', this); this.head = new FakeElement('head', this);
    this.append(this.head, this.body); this.activeElement = this.body;
  }
  createElement(tag) {
    const element = new FakeElement(tag, this);
    if (tag.toLowerCase() === 'iframe') {
      element.contentDocument = new FakeDocument(); element.contentWindow = element.contentDocument.defaultView;
      element.sourceAssignments = 0; let url = '';
      Object.defineProperty(element, 'src', { get: () => url, set(value) { url = value; element.sourceAssignments++; } });
    }
    return element;
  }
  hasFocus() { return this.focused; }
}
function globals(t) {
  const names = ['document', 'window', 'location', 'innerWidth', 'innerHeight', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const document = new FakeDocument(), window = document.defaultView;
  window.innerWidth = 800; window.innerHeight = 600;
  const scheduled = new Map(); let id = 0;
  Object.assign(globalThis, { document, window, location: { origin: 'https://lounge.test' }, innerWidth: 800, innerHeight: 600,
    CSSStyleSheet: class { replaceSync(css) { this.css = css; } },
    requestAnimationFrame(callback) { const key = ++id; scheduled.set(key, callback); queueMicrotask(() => { const cb = scheduled.get(key); scheduled.delete(key); cb?.(performance.now()); }); return key; },
    cancelAnimationFrame(key) { scheduled.delete(key); },
  });
  const restore = () => {
    scheduled.clear();
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  };
  return { document, window, restore };
}
function dispatch(target, type, values = {}, eventTarget = target) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(event, values); Object.defineProperty(event, 'target', { value: eventTarget }); target.dispatchEvent(event); return event;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate, message) {
  const deadline = performance.now() + 2000;
  while (!predicate()) { assert.ok(performance.now() < deadline, message || 'condition timed out'); await pause(); }
}
const findData = (parent, name) => parent.children.find(child => Object.hasOwn(child.dataset, name));
function surfaceFixture(t) {
  const env = globals(t), { document, window } = env;
  const canvas = document.createElement('canvas');
  const frames = [], opens = [], painters = [];
  const makePainter = ({ onPaint, document: doc }) => {
    const output = doc.createElement('canvas');
    const record = { visible: false, disposed: false, paints: 0 };
    painters.push(record);
    function draw() { record.paints++; onPaint(output); }
    return { canvas: output, ready: Promise.resolve(), invalidate: () => { if (record.visible) draw(); },
      setVisible(value) { if (record.visible === value) return; record.visible = value; if (value) queueMicrotask(() => { if (record.visible && !record.disposed) draw(); }); },
      dispose() { record.disposed = true; } };
  };
  const surface = createLiveStudioSurface({ canvas, aspect: 4 / 1.4, onFocus() {}, onExpand() { opens.push(true); },
    onFrame(frame) { frames.push(frame); }, sampleSurface(x, y) { return x >= 0 && y >= 0 ? {u:.5,v:.5} : null; }
  }, makePainter);
  const host = findData(document.body, 'liveStudio');
  const frame = () => host.children.find(child => child.tagName === 'IFRAME');
  const message = (type, origin = location.origin, sender = frame()?.contentWindow) => dispatch(window, 'message', { origin, source: sender, data: { type } });
  async function ready() {
    surface.update(true); surface.setInteractive(true);
    const iframe = frame();
    const root = iframe.contentDocument.createElement('main'); root.setAttribute('id', 'md-studio-root');
    const note = iframe.contentDocument.createElement('textarea'); note.value = 'Keep this brief'; root.append(note); iframe.contentDocument.body.append(root);
    iframe.dispatchEvent(new Event('load')); message('md-studio:ready');
    await until(() => frames.length > 0, 'first real paint should enable the TV');
    return { iframe, note };
  }
  t.after(() => { surface.dispose(); env.restore(); });
  return { ...env, canvas, surface, frame, frames, host, opens, painters, message, ready };
}

function inputFixture(t) {
  const env = globals(t), { document, window } = env;
  const canvas = document.createElement('canvas'), host = document.createElement('div'), frame = document.createElement('iframe');
  Object.assign(host.style, { opacity: '0', pointerEvents: 'none', clipPath: 'none', transform: 'none', width: '1600px', height: '560px' }); host.append(frame);
  let clear = true, focusCount = 0, frameCurrent = frame;
  const hit = (x, y) => clear && x >= 100 && x <= 500 && y >= 100 && y <= 400 ? { x: (x - 100) / 400, y: (y - 100) / 300 } : null;
  const input = createCurvedInput({ canvas, host, getFrame: () => frameCurrent, width: 1600, height: 560, hit, onFocus: () => { focusCount++; } });
  input.setEnabled(true);
  const move = (x = 300, y = 250, target = canvas) => dispatch(window, 'pointermove', { clientX: x, clientY: y, buttons: 0 }, target);
  const childEvent = (type, values = {}) => dispatch(frame.contentWindow, type, { clientX: 800, clientY: 280, pointerId: 7, button: 0, buttons: 0, detail: 1, ...values });
  t.after(() => { input.dispose(); env.restore(); });
  return { ...env, input, canvas, host, frame, move, childEvent, hit, focuses: () => focusCount, setClear: value => { clear = value; }, setFrame: value => { frameCurrent = value; } };
}

test('perspective mapping preserves all screen corners and interior coordinates', () => {
  for (const quad of [[{ x: 20, y: 40 }, { x: 820, y: 40 }, { x: 820, y: 440 }, { x: 20, y: 440 }],
    [{ x: -100, y: 120 }, { x: 1100, y: 20 }, { x: 950, y: 600 }, { x: 40, y: 500 }]]) {
    const matrix = screenHomography(quad, 1600, 560);
    for (const [index, [x, y]] of [[0, [0, 0]], [1, [1600, 0]], [2, [1600, 560]], [3, [0, 560]]]) {
      const point = mapScreenPoint(matrix, x, y); assert.ok(Math.hypot(point.x - quad[index].x, point.y - quad[index].y) < 1e-8);
    }
    assert.ok(Number.isFinite(mapScreenPoint(matrix, 800, 280).x));
  }
  assert.equal(screenHomography(Array(4).fill({ x: 0, y: 0 }), 1600, 560), null);
});

test('camera-only movement retains one iframe and requests no new UI paint', async t => {
  const f = surfaceFixture(t);
  assert.equal(f.frame(), undefined);
  const { iframe } = await f.ready();
  for (let i = 0; i < 120; i++) f.surface.update(true, [i]);
  assert.equal(f.frame(), iframe); assert.equal(iframe.sourceAssignments, 1);
  assert.equal(f.painters.length, 1); assert.equal(f.frames.length, 1);
  f.surface.update(false);
  assert.equal(f.host.style.visibility, 'hidden'); assert.equal(f.painters[0].visible, false);
  assert.equal(iframe.contentWindow.messages.at(-1)[0].type, 'md-studio:suspend');
  f.surface.update(true); await pause();
  assert.equal(f.frames.length, 2); assert.equal(iframe.contentWindow.messages.at(-1)[0].type, 'md-studio:resume');
});

test('expanded Studio and the curved TV retain the same document and unfinished form', async t => {
  const f = surfaceFixture(t), { iframe, note } = await f.ready();
  note.value = 'Draft survives fullscreen';
  dispatch(f.window, 'md-studio:layout', { detail: { open: true, reducedMotion: false } });
  assert.equal(f.host.getAttribute('aria-modal'), 'true');
  assert.equal(f.painters[0].visible, false);
  f.document.animations.at(-1).finish(); await Promise.resolve();
  assert.equal(f.host.style.width, '100vw');
  dispatch(f.window, 'md-studio:layout', { detail: { open: false, reducedMotion: false } });
  f.document.animations.at(-1).finish(); await pause();
  assert.equal(f.host.style.opacity, '0'); assert.equal(f.painters[0].visible, true);
  assert.equal(f.frame(), iframe); assert.equal(iframe.sourceAssignments, 1);
  assert.equal(note.value, 'Draft survives fullscreen');
});

test('reopened or disposed Studio cannot be changed by stale transition completion', async t => {
  const f = surfaceFixture(t), { iframe } = await f.ready();
  for (const open of [true, false, true]) dispatch(f.window, 'md-studio:layout', { detail: { open, reducedMotion: true } });
  f.document.animations.at(-1).finish(); await pause();
  assert.equal(f.host.style.opacity, '1'); assert.equal(f.frame(), iframe); assert.equal(f.painters.length, 1);
  f.surface.dispose(); f.surface.dispose();
  assert.equal(f.painters[0].disposed, true); assert.equal(f.document.body.children.length, 0);
});

test('only the matching iframe origin and source can request expansion', async t => {
  const f = surfaceFixture(t); await f.ready();
  f.message('md-studio:expand', 'https://other.test'); f.message('md-studio:expand', location.origin, {});
  assert.equal(f.opens.length, 0); f.message('md-studio:expand'); assert.equal(f.opens.length, 1);
});

test('wall occlusion defers iframe loading; looking away preserves the last physical TV', t => {
  const env = globals(t), scene = new Scene(), original = new MeshBasicMaterial();
  const geometry = new PlaneGeometry(4, 2, 16, 1);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const mesh = new Mesh(geometry, original); mesh.name = 'TV'; scene.add(mesh); scene.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 4 / 3, .1, 100); camera.position.z = 5; camera.lookAt(0,0,0);
  let inView = false;
  const display = createPresentationScreen({ scene, camera, canvas: env.document.createElement('canvas'), objectName: 'TV',
    isInView: () => inView });
  t.after(() => { display.dispose(); original.dispose(); mesh.geometry.dispose(); env.restore(); });
  const host = findData(env.document.body, 'liveStudio');
  display.update(); assert.equal(host.children.some(child => child.tagName === 'IFRAME'), false);
  inView = true; camera.position.x = .1; display.update();
  assert.equal(host.children.some(child => child.tagName === 'IFRAME'), true);
  camera.lookAt(0,0,10); display.update(); assert.equal(host.style.visibility, 'hidden');
  assert.equal(mesh.material, original, 'before first valid paint keep the authored screen instead of revealing a black hole');
});

// These tests exercise proxy routing/lifecycle with real EventTarget dispatch.
// They cannot prove native browser hit-testing, CSS :hover, drag selection or IME;
// those interactions require the companion real-browser verification.
test('curved input positions UV under cursor and clips the transparent hit area', t => {
  const f = inputFixture(t); f.move();
  assert.equal(f.host.style.transform, 'translate3d(-500px,-30px,0)');
  assert.equal(f.host.style.clipPath, 'inset(270px 790px 270px 790px)');
  assert.equal(f.host.style.pointerEvents, 'auto'); assert.equal(f.canvas.style.pointerEvents, '');
  const ui = f.document.createElement('button'); f.move(300, 250, ui); assert.equal(f.host.style.pointerEvents, 'none');
});

test('curved input allows focused keyboard activation but blocks occluded pointer input', t => {
  const f = inputFixture(t); f.move(); f.setClear(false);
  assert.equal(f.childEvent('click', { detail: 0 }).defaultPrevented, false);
  assert.equal(f.childEvent('click').defaultPrevented, true); assert.equal(f.host.style.pointerEvents, 'none');
});

test('native drag keeps coordinates stable until pointerup finishes', async t => {
  const f = inputFixture(t); f.move(); const before = f.host.style.transform;
  f.childEvent('pointerdown', { buttons: 1 }); assert.equal(f.host.style.clipPath, 'none'); assert.equal(f.focuses(), 1);
  f.childEvent('pointermove', { clientX: 900, clientY: 300, buttons: 1 }); f.input.updateCamera();
  assert.equal(f.host.style.transform, before);
  f.childEvent('pointerup', { clientX: 900, clientY: 300 }); assert.equal(f.host.style.transform, before, 'keep pointerup/click coordinate space stable');
  await pause(); assert.notEqual(f.host.style.transform, before); assert.notEqual(f.host.style.clipPath, 'none');
});

test('first touch focuses the native session without synthesizing activation', t => {
  const f = inputFixture(t); let clicks = 0;
  f.frame.contentWindow.addEventListener('click', () => clicks++);
  const event = dispatch(f.window, 'pointerdown', { clientX: 300, clientY: 250, button: 0, buttons: 1, pointerType: 'touch' }, f.canvas);
  assert.equal(event.defaultPrevented, true); assert.equal(f.focuses(), 1); assert.equal(f.document.activeElement, f.frame); assert.equal(clicks, 0);
});

test('fullscreen releases proxy styles and disabled input never changes the owner layout', t => {
  const f = inputFixture(t); f.move(); f.input.setExpanded(true);
  assert.equal(f.host.style.transform, 'none'); assert.equal(f.host.style.clipPath, 'none');
  f.host.style.transform = 'fullscreen-owner'; f.host.style.opacity = '1'; f.host.style.pointerEvents = 'auto';
  f.move(350, 280); f.input.updateCamera(); assert.equal(f.host.style.transform, 'fullscreen-owner');
  f.input.setEnabled(false); assert.equal(f.host.style.opacity, '1');
});

test('iframe focus does not cancel native input; browser blur and hidden page do', async t => {
  const f = inputFixture(t); f.move(); f.document.activeElement = f.frame;
  dispatch(f.window, 'blur'); await Promise.resolve(); assert.equal(f.host.style.pointerEvents, 'auto');
  f.document.focused = false; dispatch(f.window, 'blur'); await Promise.resolve(); assert.equal(f.host.style.pointerEvents, 'none');
  f.document.focused = true; f.move(); f.document.hidden = true; dispatch(f.document, 'visibilitychange'); assert.equal(f.host.style.pointerEvents, 'none');
});

test('camera occlusion and pointer cancellation retract proxy without stale listeners after dispose', t => {
  const f = inputFixture(t); f.move(); f.setClear(false); f.input.updateCamera(); assert.equal(f.host.style.pointerEvents, 'none');
  f.setClear(true); f.move(); f.childEvent('pointerdown', { buttons: 1 }); f.childEvent('pointercancel'); assert.equal(f.host.style.pointerEvents, 'none');
  f.input.dispose(); f.host.style.transform = 'owner-restored'; f.move(); f.childEvent('pointermove'); assert.equal(f.host.style.transform, 'owner-restored');
});
