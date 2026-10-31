import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { createPresentationScreen } from '../src/runtime/presentation/PresentationScreen.ts';

function fixture(t) {
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const savedImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const images = [], draws = [], texts = [];
  const context = { fillRect() {}, drawImage(...args) { draws.push(args); }, fillText(text, x, y) { texts.push({ text, x, y, align: this.textAlign }); }, createLinearGradient() { return { addColorStop() {} }; } };
  const surface = { width: 0, height: 0, getContext: () => context };
  class ImageFixture {
    complete = false; naturalWidth = 0; naturalHeight = 0; requests = [];
    constructor() { images.push(this); }
    set src(value) { this.requests.push(value); }
    removeAttribute(name) { if (name === 'src') this.removed = true; }
    load() { this.complete = true; this.naturalWidth = 1600; this.naturalHeight = 900; this.onload?.(); }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(name) { assert.equal(name, 'canvas'); return surface; } } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: ImageFixture });
  t.after(() => {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
    if (savedImage) Object.defineProperty(globalThis, 'Image', savedImage); else delete globalThis.Image;
  });
  const canvas = new EventTarget(); canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
  const scene = new Scene(), original = new MeshBasicMaterial({ color: 0x987654 });
  const mesh = new Mesh(new PlaneGeometry(4, 2), original);
  mesh.name = 'PL78 | curved LED pixel surface'; scene.add(mesh);
  const founderOriginal = new MeshBasicMaterial({ color: 0x334455 });
  const founder = new Mesh(new PlaneGeometry(3, 2), founderOriginal);
  founder.name = 'Founder | curved LED pixel surface'; founder.position.set(8, 0, 0);
  scene.add(founder); scene.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 800 / 600, .1, 100);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const opens = [];
  const display = createPresentationScreen({ scene, camera, canvas, objectName: mesh.name, onOpen: rect => opens.push(rect) });
  const send = (type, x = 400, y = 300, extra = {}) => {
    const event = new Event(type);
    Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: y, ...extra });
    canvas.dispatchEvent(event);
  };
  const click = (x = 400, y = 300) => { send('pointerdown', x, y); send('pointerup', x, y); };
  t.after(() => { display.dispose(); mesh.geometry.dispose(); original.dispose(); founder.geometry.dispose(); founderOriginal.dispose(); });
  return { display, mesh, original, founder, founderOriginal, canvas, surface, images, draws, texts, opens, click, send };
}

test('TV pointer hits use actual geometry, ignore misses and drags, and report a usable overlay rectangle', t => {
  const {display,canvas,opens,click,send} = fixture(t);
  click(); assert.equal(opens.length, 0, 'the poster is not interactive before sitting');
  display.setActive(true);
  send('pointermove'); assert.equal(canvas.style.cursor, 'pointer');
  click(); assert.equal(opens.length, 1);
  const rect = opens[0];
  assert.ok(rect.width > 100 && rect.height > 100);
  assert.ok(rect.x > 0 && rect.y > 0 && rect.x + rect.width < 800 && rect.y + rect.height < 600);
  send('pointermove', 0, 0); assert.equal(canvas.style.cursor, 'default');
  click(0,0); assert.equal(opens.length, 1, 'clicking away from the TV must not open it');
  send('pointerdown'); send('pointermove', 430, 300); send('pointerup', 430, 300);
  assert.equal(opens.length, 1, 'dragging is not a click');
  send('pointerdown'); send('pointerup', 400, 300, {pointerId: 2});
  assert.equal(opens.length, 1, 'another pointer cannot finish the click');
});

test('a drag that returns to its start and a cancelled pointer never activate the TV', t => {
  const {display,opens,send} = fixture(t);
  display.setActive(true);
  send('pointerdown'); send('pointermove', 440, 300); send('pointermove'); send('pointerup');
  assert.equal(opens.length, 0, 'pointer travel must be tracked even when its final coordinate matches the start');
  send('pointerdown'); send('pointercancel'); send('pointerup');
  assert.equal(opens.length, 0, 'a cancelled touch cannot leave an armed click behind');
});

test('the presentation poster replaces earth immediately and persists across input state changes without extra uploads', t => {
  const {display,mesh,original,images,draws,opens,click} = fixture(t);
  const posterMaterial = mesh.material;
  assert.notEqual(posterMaterial, original, 'the presentation TV must show the portal before anyone sits');
  assert.deepEqual(images[0].requests, ['/studio/media/plate/wall-ledge-marble.jpg']);
  images[0].load(); assert.equal(draws.length, 1);
  const version = display.texture.version;
  for (let i=0;i<120;i++) display.update();
  assert.equal(display.texture.version, version, 'the still poster must not upload a texture every frame');
  display.setActive(false);
  assert.equal(mesh.material, posterMaterial);
  click(); display.setAction('studio'); assert.equal(opens.length, 0, 'covered/paused input is disabled');
  display.setActive(true); display.setAction('studio'); assert.equal(opens.length, 1);
  display.setActive(false);
  assert.equal(mesh.material, posterMaterial, 'standing or replaying the tour must not bring the earth back');
  display.setActive(true);
  assert.equal(mesh.material, posterMaterial); assert.equal(images[0].requests.length, 1);
});

test('only the named presentation TV changes; the similar-named founder screen keeps its authored material', t => {
  const {display,mesh,founder,founderOriginal} = fixture(t);
  assert.deepEqual(display.meshes, [mesh], 'a generic curved-LED name match would also replace the founder screen');
  assert.equal(founder.material, founderOriginal);
  display.setActive(true); assert.equal(founder.material, founderOriginal);
  display.setActive(false); assert.equal(founder.material, founderOriginal);
  display.dispose(); assert.equal(founder.material, founderOriginal);
});

test('presentation title and action are centered together in the middle of the TV', t => {
  const {texts,surface} = fixture(t);
  const title = texts.find(item => item.text === 'motiondesign.ad');
  const action = texts.find(item => item.text === 'Click to open');
  assert.ok(title && action, 'the TV must explain both the destination and click action');
  for (const text of [title,action]) {
    assert.equal(text.align, 'center');
    assert.equal(text.x, surface.width / 2);
    assert.ok(text.y > surface.height * .35 && text.y < surface.height * .65, 'text belongs in the central area, not the old top band');
  }
  assert.ok(action.y > title.y);
  assert.ok(Math.abs((title.y + action.y) / 2 - surface.height / 2) < surface.height * .08);
});

test('TV disposal restores materials, releases its texture/material and detaches input and image callbacks', t => {
  const {display,mesh,original,canvas,images,opens,click,send} = fixture(t);
  display.setActive(true);
  let textureDisposals = 0, materialDisposals = 0;
  display.texture.addEventListener('dispose', () => textureDisposals++);
  mesh.material.addEventListener('dispose', () => materialDisposals++);
  display.dispose();
  assert.equal(mesh.material, original);
  assert.equal(textureDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(images[0].onload, null); assert.equal(images[0].onerror, null); assert.equal(images[0].removed, true);
  canvas.style.cursor = 'sentinel';
  click(); send('pointermove'); display.setAction('studio');
  assert.equal(opens.length, 0); assert.equal(canvas.style.cursor, 'sentinel');
});
