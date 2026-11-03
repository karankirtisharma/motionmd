import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { projectScreenPlane, mapScreenPoint, screenHomography } from '../src/runtime/presentation/projection.ts';

const W = 1280, H = 720, DW = 1600, DH = 560;
const domCorners = [[0, 0], [DW, 0], [DW, DH], [0, DH]];
const eps = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function camera(api = WebGLCoordinateSystem, reversed = false) {
  const result = new PerspectiveCamera(55, W / H, .1, 50);
  result.coordinateSystem = api; result._reversedDepth = reversed; result.updateProjectionMatrix(); result.updateMatrixWorld(true);
  return result;
}
function rect(z = -5) { return [new Vector3(-2, .7, z), new Vector3(2, .7, z), new Vector3(2, -.7, z), new Vector3(-2, -.7, z)]; }
function projected(point, view, w = W, h = H) { const p = point.clone().project(view); return { x: (p.x + 1) * w / 2, y: (1 - p.y) * h / 2 }; }

test('world-plane CSS mapping matches each authored corner and interior point at oblique camera angles', () => {
  const points = rect();
  for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversed of [false, true]) {
    const view = camera(api, reversed); view.position.set(.8, .2, 1.3); view.lookAt(0, 0, -5); view.updateMatrixWorld(true);
    const result = projectScreenPlane(points, view, W, H, DW, DH);
    assert.ok(result?.visible);
    const old = screenHomography(points.map(p => projected(p, view)), DW, DH);
    for (const [i, xy] of domCorners.entries()) {
      const actual = mapScreenPoint(result.matrix, ...xy), expected = projected(points[i], view);
      eps(actual.x, expected.x); eps(actual.y, expected.y);
      const oldPoint = mapScreenPoint(old, ...xy); eps(actual.x, oldPoint.x); eps(actual.y, oldPoint.y);
    }
    const world = points[0].clone().lerp(points[1], .3).add(points[3].clone().sub(points[0]).multiplyScalar(.6));
    const actual = mapScreenPoint(result.matrix, DW * .3, DH * .6), expected = projected(world, view);
    eps(actual.x, expected.x); eps(actual.y, expected.y);
    assert.notEqual(result.matrix[15], 1, 'homogeneous W must not be normalized away');
  }
});

test('one corner pair crossing the near or eye plane never hides the remaining visible TV', () => {
  for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversed of [false, true]) {
    const view = camera(api, reversed);
    for (const leftZ of [-.05, 0, .2]) {
      const points = [new Vector3(-.15, .5, leftZ), new Vector3(1.2, .5, -2), new Vector3(1.2, -.5, -2), new Vector3(-.15, -.5, leftZ)];
      const result = projectScreenPlane(points, view, W, H, DW, DH);
      assert.ok(result?.visible, `partial panel must survive ${api}, reversed=${reversed}, z=${leftZ}`);
      assert.ok(result.bounds.width > 10 && result.bounds.height > 10);
      assert.ok(result.bounds.x >= 0 && result.bounds.y >= 0);
      assert.ok(result.bounds.x + result.bounds.width <= W && result.bounds.y + result.bounds.height <= H);
      // The un-clipped DOM projection agrees with the world plane wherever W>0.
      const actual = mapScreenPoint(result.matrix, DW, DH / 2), expected = projected(points[1].clone().lerp(points[2], .5), view);
      eps(actual.x, expected.x); eps(actual.y, expected.y);
      if (leftZ > 0) assert.ok(result.matrix[15] < 0, 'behind-eye corners keep their negative W');
    }
  }
});

test('depth clipping rejects panels wholly behind the eye, before near, or beyond far on both depth conventions', () => {
  for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversed of [false, true]) {
    const view = camera(api, reversed);
    for (const z of [2, .1, -.03, -60]) {
      const result = projectScreenPlane(rect(z), view, W, H, DW, DH);
      assert.equal(result?.visible, false, `${api}, reversed=${reversed}, z=${z}`);
      assert.equal(result.bounds.width, 0);
    }
    assert.ok(projectScreenPlane(rect(-1), view, W, H, DW, DH)?.visible);
  }
});

test('offscreen clipping keeps a partially visible panel and excludes a wholly offscreen panel', () => {
  const view = camera(), partial = rect().map(p => p.add(new Vector3(5, 0, 0)));
  const result = projectScreenPlane(partial, view, W, H, DW, DH);
  assert.ok(result.visible); eps(result.bounds.x + result.bounds.width, W);
  assert.equal(projectScreenPlane(rect().map(p => p.add(new Vector3(20, 0, 0))), view, W, H, DW, DH).visible, false);
});

test('resizing the viewport and DOM resolution preserves the screen registration', () => {
  const view = camera(), points = rect();
  const first = projectScreenPlane(points, view, W, H, DW, DH);
  const resized = projectScreenPlane(points, view, W / 2, H / 2, DW / 2, DH / 2);
  const a = mapScreenPoint(first.matrix, DW * .6, DH * .4), b = mapScreenPoint(resized.matrix, DW * .3, DH * .2);
  eps(b.x, a.x / 2); eps(b.y, a.y / 2);
  eps(resized.bounds.width, first.bounds.width / 2); eps(resized.bounds.height, first.bounds.height / 2);
  view.aspect = 9 / 16; view.updateProjectionMatrix();
  const portrait = projectScreenPlane(points, view, 540, 960, DW, DH);
  const actual = mapScreenPoint(portrait.matrix, DW * .5, DH * .5), expected = projected(new Vector3(0, 0, -5), view, 540, 960);
  eps(actual.x, expected.x); eps(actual.y, expected.y); assert.ok(portrait.visible);
});

test('invalid sizes and nonfinite geometry return null; degenerate panels are not visible', () => {
  const view = camera();
  assert.equal(projectScreenPlane(rect(), view, 0, H, DW, DH), null);
  assert.equal(projectScreenPlane(rect(), view, W, H, NaN, DH), null);
  assert.equal(projectScreenPlane([new Vector3(NaN, 0, 0), ...rect().slice(1)], view, W, H, DW, DH), null);
  assert.equal(projectScreenPlane([new Vector3(0, 0, -2), new Vector3(0, 0, -2), new Vector3(0, 0, -2), new Vector3(0, 0, -2)], view, W, H, DW, DH).visible, false);
});
