import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The override lets a reviewed test draft exercise the real working tree without
// copying runtime source or dependencies into the QA directory.
const project = process.env.MD_TEST_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = relative => import(pathToFileURL(join(project, relative)).href);
const { Scene, PerspectiveCamera, Mesh, PlaneGeometry, MeshBasicMaterial, NoBlending } = await source('node_modules/three/build/three.module.js');
const { createPresentationScreen } = await source('src/runtime/presentation/PresentationScreen.ts');
const { createCurvedInput } = await source('src/runtime/presentation/curvedInput.ts');
const { createCurvedStudioView } = await source('src/runtime/presentation/CurvedStudioView.ts');
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
function fixture(t) {
  const env = globals(t), { document, window } = env;
  const viewport = document.createElement('div'), canvas = document.createElement('canvas'); viewport.append(canvas);
  const scene = new Scene(), original = new MeshBasicMaterial({ color: 0x987654 });
  const geometry = new PlaneGeometry(4, 2, 32, 1), position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) { uv.setY(i, 1 - uv.getY(i)); const x = position.getX(i); position.setZ(i, -.35 * (1 - x * x / 4)); }
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, original); mesh.name = 'PL78 | curved LED pixel surface'; scene.add(mesh);
  const founder = new Mesh(new PlaneGeometry(3, 2), new MeshBasicMaterial()); founder.name = 'Founder | curved LED pixel surface'; scene.add(founder);
  const founderOriginal = founder.material; scene.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 4 / 3, .1, 100); camera.position.z = 5; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const opens = []; let clear = true, inView = true;
  const display = createPresentationScreen({ scene, camera, canvas, objectName: mesh.name, onOpen: bounds => opens.push(bounds), isUnobstructed: () => clear, isInView: () => inView });
  const host = findData(document.body, 'liveStudio'), visual = findData(document.body, 'liveStudioVisual');
  const frame = () => host.children.find(child => child.tagName === 'IFRAME');
  const message = (type, origin = location.origin, sender = frame()?.contentWindow) => dispatch(window, 'message', { origin, source: sender, data: { type } });
  const move = (x = 400, y = 300) => dispatch(window, 'pointermove', { clientX: x, clientY: y, buttons: 0 }, canvas);
  const ready = async () => {
    display.update(); const iframe = frame(); assert.ok(iframe, 'visible screen creates an iframe');
    const root = iframe.contentDocument.createElement('main'); root.setAttribute('id', 'md-studio-root');
    const note = iframe.contentDocument.createElement('textarea'); note.value = 'Keep this brief'; root.append(note); iframe.contentDocument.body.append(root);
    iframe.dispatchEvent(new Event('load')); message('md-studio:ready');
    await until(() => visual.style.visibility === 'visible', 'curved visual should finish its asynchronous build');
    return { iframe, root, note };
  };
  t.after(() => { display.dispose(); geometry.dispose(); original.dispose(); founder.geometry.dispose(); founder.material.dispose(); env.restore(); });
  return { ...env, display, host, visual, frame, message, move, ready, mesh, original, founder, founderOriginal, canvas, camera, opens,
    setClear: value => { clear = value; }, setInView: value => { inView = value; } };
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

test('visible screen retains authored curved geometry, depth occlusion and one live app', async t => {
  const f = fixture(t), geometry = f.mesh.geometry; assert.equal(f.frame(), undefined);
  f.display.setActive(true); const { iframe } = await f.ready();
  for (let i = 0; i < 120; i++) f.display.update();
  assert.equal(f.frame(), iframe); assert.equal(iframe.sourceAssignments, 1);
  assert.equal(f.host.children.filter(child => child.tagName === 'IFRAME').length, 1);
  assert.equal(f.mesh.geometry, geometry); assert.equal(f.founder.material, f.founderOriginal);
  assert.equal(f.mesh.material.blending, NoBlending); assert.equal(f.mesh.material.depthTest, true); assert.equal(f.mesh.material.depthWrite, true);
  assert.ok(findData(f.visual, 'curvedStudioView').children.length > 1, 'curved surface uses multiple visual fragments');
});

test('fragment roots inherit visibility so hidden camera patches cannot paint through their hosts', async t => {
  const f = fixture(t); f.display.setActive(true); await f.ready();
  const view = findData(f.visual, 'curvedStudioView');
  for (const slice of view.children) {
    assert.equal(slice.shadowRoot.children[0].style.visibility, 'inherit');
    assert.match(slice.shadowRoot.adoptedStyleSheets[0].css, /\[data-tv-slice-culled\]\s*\{display:none!important\}/,
      'off-strip content must release painted/filter surfaces; the real iframe retains layout');
  }
  f.camera.lookAt(0, 0, 10); f.display.update();
  for (const slice of view.children) {
    assert.equal(slice.style.visibility, 'hidden');
    assert.equal(slice.shadowRoot.children[0].style.visibility, 'inherit');
  }
});

test('overflow resync preserves guarded source offsets after returning to the same camera pose', async t => {
  const f = fixture(t); f.display.setActive(true); const { iframe, root } = await f.ready();
  const view = findData(f.visual, 'curvedStudioView'), before = view.children.map(slice => slice.shadowRoot.children[0]);
  const observer = iframe.contentDocument.observers.find(item => item.connected && item.target === root);
  assert.ok(observer, 'source DOM has a live mutation observer');
  f.camera.lookAt(0, 0, 10); f.display.update();
  const added = Array.from({ length: 1001 }, () => iframe.contentDocument.createElement('span'));
  root.append(...added);
  observer.callback(added.map(node => ({ type: 'childList', target: root, addedNodes: [node], removedNodes: [], nextSibling: null })));
  f.camera.lookAt(0, 0, 0); f.display.update();
  const offset = index => `${16 - index * 1600 / view.children.length}px`;
  await until(() => view.children.every((slice, index) => slice.shadowRoot.children[0] !== before[index] && slice.shadowRoot.children[0].style.left === offset(index)),
    'all resynced roots must recover the constant guard without requiring another camera movement');
  for (const [index, slice] of view.children.entries()) {
    assert.equal(slice.shadowRoot.children[0].style.left, offset(index));
    assert.equal(slice.shadowRoot.children[0].style.visibility, 'inherit');
  }
});
test('hover and native form state tolerate sparse clone rows during incremental build', async t => {
  const env = globals(t), sourceDocument = new FakeDocument();
  const root = sourceDocument.createElement('main'); root.setAttribute('id', 'md-studio-root'); sourceDocument.body.append(root);
  const parent = env.document.createElement('div'); env.document.body.append(parent);
  const visual = createCurvedStudioView({ parent, document: sourceDocument, width: 1600, height: 558 });
  t.after(() => { visual.dispose(); env.restore(); });
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  visual.update(Array.from({ length: 4 }, (_, index) => ({ matrix, visible: true, left: index * 400, width: 400 })));
  const view = findData(parent, 'curvedStudioView');
  assert.equal(view.children.length, 2, 'first build yields after two fragments');

  const field = sourceDocument.createElement('input'); field.setAttribute('id', 'late-field'); field.value = 'Initial'; root.append(field);
  const observer = sourceDocument.observers.find(item => item.connected && item.target === root);
  observer.callback([{ type: 'childList', target: root, addedNodes: [field], removedNodes: [], nextSibling: null }]);
  await visual.ready;
  const clones = () => view.children.map(slice => slice.shadowRoot.querySelector('#late-field'));
  assert.deepEqual(clones().map(Boolean), [false, false, true, true], 'new source child has holes in its copy row until queued reconciliation');

  let hovered = true;
  const originalQuery = root.querySelectorAll.bind(root);
  root.querySelectorAll = selector => selector === ':hover' ? (hovered ? [field] : []) : originalQuery(selector);
  visual.setVisible(true);
  // A real input event can arrive before the next RAF reconciles early fragments.
  dispatch(sourceDocument, 'pointerover', {}, field);
  Object.assign(field, { value: 'Edited during build', checked: true, scrollTop: 19, scrollLeft: 7 });
  dispatch(sourceDocument, 'input', {}, field);
  for (const clone of clones().slice(2)) {
    assert.equal(clone.hasAttribute('data-tv-hover'), true, 'existing later copies still receive hover');
    assert.equal(clone.value, field.value); assert.equal(clone.checked, true);
    assert.equal(clone.scrollTop, 19); assert.equal(clone.scrollLeft, 7);
  }
  await Promise.resolve();
  assert.ok(clones().every(Boolean), 'queued child mutation fills the earlier fragments');
  for (const clone of clones()) assert.equal(clone.hasAttribute('data-tv-hover'), true,
    'late reconciled fragments inherit the held hover without a second pointer event');
  hovered = false; dispatch(sourceDocument, 'pointerout', {}, field);
  field.value = 'Final'; field.checked = false; dispatch(sourceDocument, 'change', {}, field);
  for (const clone of clones()) {
    assert.equal(clone.hasAttribute('data-tv-hover'), false);
    assert.equal(clone.value, 'Final'); assert.equal(clone.checked, false);
  }
});
test('native TV proxy is gated by active mode, ray visibility and occlusion', async t => {
  const f = fixture(t); f.display.setActive(true); await f.ready();
  f.move(); assert.equal(f.host.style.pointerEvents, 'auto'); assert.equal(f.host.style.opacity, '0');
  assert.equal(f.canvas.style.pointerEvents, '', 'canvas is never relinquished globally');
  f.display.setActive(false); f.move(); assert.equal(f.host.style.pointerEvents, 'none');
  f.display.setActive(true); f.setClear(false); f.move(); assert.equal(f.host.style.pointerEvents, 'none');
  f.setClear(true); f.move(0, 0); assert.equal(f.host.style.pointerEvents, 'none');
});

test('offscreen studio suspends, refuses hidden expansion and resumes without reload', async t => {
  const f = fixture(t); f.display.setActive(true); const { iframe } = await f.ready();
  f.camera.lookAt(0, 0, 10); f.display.update();
  assert.equal(f.host.style.visibility, 'hidden'); assert.equal(iframe.contentWindow.messages.at(-1)[0].type, 'md-studio:suspend');
  f.display.setAction('studio'); assert.equal(f.opens.length, 0);
  f.camera.lookAt(0, 0, 0); f.display.update();
  assert.equal(f.frame(), iframe); assert.equal(iframe.contentWindow.messages.at(-1)[0].type, 'md-studio:resume');
});

test('only the matching iframe origin/source can request expansion', async t => {
  const f = fixture(t); f.display.setActive(true); await f.ready();
  f.message('md-studio:expand', 'https://other.test'); f.message('md-studio:expand', location.origin, {}); assert.equal(f.opens.length, 0);
  f.message('md-studio:expand'); assert.equal(f.opens.length, 1); assert.ok(f.opens[0].width > 100);
});

test('fullscreen preserves session/form state and keeps a complete visual through both fades', async t => {
  const f = fixture(t); f.display.setActive(true); const { iframe, note } = await f.ready();
  const oldView = findData(f.visual, 'curvedStudioView'); note.value = 'Draft survives fullscreen';
  dispatch(f.window, 'md-studio:layout', { detail: { open: true, reducedMotion: false } });
  assert.equal(f.frame(), iframe); assert.equal(f.host.getAttribute('aria-modal'), 'true');
  assert.equal(f.visual.style.visibility, 'visible', 'opening fade must retain its curved background');
  f.document.animations.at(-1).finish(); await Promise.resolve();
  assert.equal(f.host.style.width, '100vw'); assert.equal(f.visual.style.visibility, 'hidden');
  const count = f.document.animations.length;
  dispatch(f.window, 'md-studio:layout', { detail: { open: false, reducedMotion: false } });
  assert.equal(f.host.style.opacity, '1', 'same native iframe covers preparation');
  assert.equal(f.visual.style.visibility, 'hidden', 'stale TV fragments stay frozen while source viewport changes');
  assert.equal(oldView.parentNode, f.visual, 'old visual must remain until replacement is complete');
  await until(() => f.document.animations.length > count, 'closing animation waits for new visual readiness');
  assert.equal(oldView.parentNode, null); assert.equal(f.visual.style.visibility, 'visible');
  f.document.animations.at(-1).finish(); await Promise.resolve();
  assert.equal(f.host.style.zIndex, '2'); assert.equal(f.host.style.opacity, '0');
  assert.equal(f.frame(), iframe); assert.equal(iframe.sourceAssignments, 1); assert.equal(note.value, 'Draft survives fullscreen');
});

test('reopening during return cancels pending visual work without replacing the app', async t => {
  const f = fixture(t); f.display.setActive(true); const { iframe } = await f.ready();
  dispatch(f.window, 'md-studio:layout', { detail: { open: true, reducedMotion: false } });
  f.document.animations.at(-1).finish(); await Promise.resolve();
  dispatch(f.window, 'md-studio:layout', { detail: { open: false, reducedMotion: false } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.visual.children.length, 2, 'old and in-progress replacement coexist during return');
  dispatch(f.window, 'md-studio:layout', { detail: { open: true, reducedMotion: false } });
  assert.equal(f.visual.children.length, 1, 'interrupted replacement is disposed');
  f.document.animations.at(-1).finish(); await Promise.resolve(); await pause();
  assert.equal(f.frame(), iframe); assert.equal(iframe.sourceAssignments, 1); assert.equal(f.host.style.opacity, '1');
});
test('disposal restores materials and releases both visual/input DOM exactly once', async t => {
  const f = fixture(t); f.display.setActive(true); await f.ready(); let disposals = 0;
  f.mesh.material.addEventListener('dispose', () => disposals++); f.display.dispose(); f.display.dispose();
  assert.equal(disposals, 1); assert.equal(f.mesh.material, f.original); assert.equal(f.document.body.children.length, 0);
  assert.equal(f.document.head.children.length, 0, 'copied font styles are released');
  f.move(); f.message('md-studio:expand'); assert.equal(f.opens.length, 0); assert.equal(f.canvas.style.pointerEvents, '');
});

test('wall-obscured screen defers app loading until sightline clears', t => {
  const f = fixture(t); f.setInView(false); f.display.update();
  assert.equal(f.frame(), undefined); assert.equal(f.host.style.visibility, 'hidden');
  f.setInView(true); f.camera.position.x = .1; f.display.update();
  assert.ok(f.frame()); assert.equal(f.host.style.visibility, 'visible');
});

test('nearby oblique camera views keep partially visible curved TV depth opening', t => {
  const f = fixture(t); f.display.update(); const iframe = f.frame();
  f.camera.position.set(0, 0, .35); f.camera.lookAt(1, 0, 0); f.camera.updateMatrixWorld(true); f.display.update();
  assert.equal(f.host.style.visibility, 'visible'); assert.equal(f.frame(), iframe);
  f.mesh.onBeforeRender(undefined, undefined, f.camera, undefined, undefined, undefined); assert.equal(f.mesh.material.opacity, 0);
  f.camera.lookAt(0, 0, 10); f.camera.updateMatrixWorld(true); f.display.update(); assert.equal(f.host.style.visibility, 'hidden');
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
