import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, Vector4 } from 'three';
import { CanvasTarget } from 'three/webgpu';
import { createDrawingBufferResizer } from '../src/runtime/rendering/resizeDrawingBuffer.ts';

// Exercise pinned Three CanvasTarget itself, including resize events and canvas
// attribute assignments. A browser resets its drawing buffer on these writes.
function fixture(width = 1280, height = 720) {
  const counts = { widthWrites: 0, heightWrites: 0, resizeEvents: 0 };
  let physicalWidth = width, physicalHeight = height;
  const canvas = { style: { width: '100%', height: '100%' },
    get width() { return physicalWidth; }, set width(value) { counts.widthWrites++; physicalWidth = value; },
    get height() { return physicalHeight; }, set height(value) { counts.heightWrites++; physicalHeight = value; },
  };
  const target = new CanvasTarget(canvas);
  target.addEventListener('resize', () => counts.resizeEvents++);
  return { target, canvas, counts };
}
const oldResize = (renderer, width, height, ratio) => { renderer.setPixelRatio(ratio); renderer.setSize(width, height); };

test('unchanged viewport notifications cause zero canvas writes or resize invalidations', () => {
  const before = fixture(), after = fixture();
  const resize = createDrawingBufferResizer();
  for (let i = 0; i < 100; i++) {
    oldResize(before.target, 1280, 720, 1);
    assert.equal(resize(after.target, 1280, 720, 1), false);
  }
  assert.deepEqual(before.counts, { widthWrites: 100, heightWrites: 100, resizeEvents: 100 });
  assert.deepEqual(after.counts, { widthWrites: 0, heightWrites: 0, resizeEvents: 0 });
  assert.deepEqual(after.canvas.style, { width: '100%', height: '100%' });
});

test('simultaneous viewport and DPR changes resize once instead of twice', () => {
  const before = fixture(), after = fixture();
  oldResize(before.target, 800, 600, 1.5);
  assert.equal(createDrawingBufferResizer()(after.target, 800, 600, 1.5), true);
  assert.deepEqual(before.counts, { widthWrites: 2, heightWrites: 2, resizeEvents: 2 });
  assert.deepEqual(after.counts, { widthWrites: 1, heightWrites: 1, resizeEvents: 1 });
  assert.equal(after.canvas.width, 1200); assert.equal(after.canvas.height, 900);
  assert.deepEqual(after.target.getSize(new Vector2()), before.target.getSize(new Vector2()));
  assert.deepEqual(after.target.getDrawingBufferSize(new Vector2()), before.target.getDrawingBufferSize(new Vector2()));
  assert.deepEqual(after.target.getViewport(new Vector4()), before.target.getViewport(new Vector4()));
});

test('real viewport, quality and DPR transitions preserve exact buffer size and viewport', () => {
  const before = fixture(), after = fixture();
  const resize = createDrawingBufferResizer();
  const changes = [[800, 600, 1], [800, 600, 1.25], [600, 800, 1.25], [391, 844, 2], [391, 844, 1.3], [782, 1688, .65], [1, 1, 1]];
  for (const [width, height, ratio] of changes) {
    oldResize(before.target, width, height, ratio);
    assert.equal(resize(after.target, width, height, ratio), true);
    assert.equal(resize(after.target, width, height, ratio), false);
    assert.deepEqual(after.target.getSize(new Vector2()), before.target.getSize(new Vector2()));
    assert.deepEqual(after.target.getDrawingBufferSize(new Vector2()), before.target.getDrawingBufferSize(new Vector2()));
    assert.deepEqual(after.target.getViewport(new Vector4()), before.target.getViewport(new Vector4()));
    assert.equal(after.target.getPixelRatio(), before.target.getPixelRatio());
  }
  assert.equal(after.counts.resizeEvents, changes.length);
  assert.deepEqual(after.canvas.style, { width: '100%', height: '100%' }, 'CSS retains responsive sizing');
});

test('resizer uses current renderer state and reuses one size vector across calls', () => {
  const { target } = fixture();
  const resize = createDrawingBufferResizer();
  let firstVector;
  const renderer = {
    getSize(vector) { firstVector ??= vector; assert.equal(vector, firstVector); return target.getSize(vector); },
    getPixelRatio: () => target.getPixelRatio(),
    setDrawingBufferSize: (...args) => target.setDrawingBufferSize(...args),
  };
  assert.equal(resize(renderer, 1280, 720, 1), false);
  target.setDrawingBufferSize(640, 360, 2);
  assert.equal(resize(renderer, 1280, 720, 1), true, 'equal physical pixels must not conceal logical viewport/DPR changes');
  assert.equal(resize(renderer, 1280, 720, 1), false);
});