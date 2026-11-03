import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { curvedSliceClip } from '../src/runtime/presentation/sliceClip.ts';
import { projectScreenPlane, mapScreenPoint } from '../src/runtime/presentation/projection.ts';

const SOURCE_WIDTH = 50, SOURCE_HEIGHT = 558, SOURCE_LEFT = 650;
const patch = [new Vector3(-.12, 1.2, -5), new Vector3(.12, 1.2, -5), new Vector3(.12, -1.2, -5), new Vector3(-.12, -1.2, -5)];
const poses = [
  { position: [0, 0, 0], target: [0, 0, -5], fov: 65 },
  { position: [1.2, .4, -2], target: [0, 0, -5], fov: 55 },
  { position: [-1.8, -.7, -3.2], target: [0, 0, -5], fov: 90 },
  { position: [.05, .1, -4.85], target: [.8, .1, -5], fov: 65 },
];
function projections() {
  const results = [];
  for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reverse of [false, true]) {
    for (const [width, height] of [[1920, 1080], [390, 844], [2560, 1440]]) for (const pose of poses) {
      const camera = new PerspectiveCamera(pose.fov, width / height, .05, 100);
      camera.coordinateSystem = api; camera._reversedDepth = reverse; camera.updateProjectionMatrix();
      camera.position.fromArray(pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true);
      const projection = projectScreenPlane(patch, camera, width, height, SOURCE_WIDTH, SOURCE_HEIGHT);
      assert.ok(projection?.matrix, 'valid source patch always has its projective transform');
      results.push({ camera, width, height, matrix: projection.matrix });
    }
  }
  return results;
}
function closePoint(actual, expected, message) {
  assert.ok(Number.isFinite(actual.x) && Number.isFinite(actual.y), `${message}: finite projected point`);
  const tolerance = Math.max(1, Math.abs(expected.x), Math.abs(expected.y)) * 1e-10;
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < tolerance, message);
}

test('camera motion and viewport changes keep the slice raster width and source offset constant', () => {
  const layouts = new Set(), transforms = new Set();
  for (const { matrix } of projections()) {
    const clipped = curvedSliceClip(matrix, SOURCE_WIDTH, SOURCE_HEIGHT);
    // These are the layout values consumed by CurvedStudioView.applyPatch.
    layouts.add(`${SOURCE_WIDTH + clipped.overlap * 2}|${-SOURCE_LEFT + clipped.overlap}`);
    transforms.add(clipped.matrix.join(','));
  }
  assert.ok(transforms.size >= 12, 'exercise all twelve camera/viewport combinations; depth conventions may share the same 2D projection');
  assert.deepEqual([...layouts], ['82|-634'], 'fixed 16px guard must not trigger camera-dependent width/left layouts');
});

test('guard origin shift preserves every sampled source UV under perspective, without mutating the camera matrix', () => {
  let checks = 0;
  for (const { matrix } of projections()) {
    const original = Object.freeze(Array.from(matrix));
    const clipped = curvedSliceClip(original, SOURCE_WIDTH, SOURCE_HEIGHT);
    assert.notEqual(clipped.matrix, original, 'output must not alias the source matrix');
    for (const x of [-16, 0, SOURCE_WIDTH * .25, SOURCE_WIDTH * .5, SOURCE_WIDTH, SOURCE_WIDTH + 16]) for (const y of [0, SOURCE_HEIGHT * .5, SOURCE_HEIGHT]) {
      const expected = mapScreenPoint(original, x, y);
      const actual = mapScreenPoint(clipped.matrix, x + clipped.overlap, y);
      closePoint(actual, expected, `source (${x},${y}) must not move when its clip window expands`); checks++;
    }
    assert.deepEqual(original, matrix, 'the next camera update must retain its original projection');
  }
  assert.equal(checks, 864);
});

test('neighboring curved facets retain their exact shared UV edge after the guard is added', () => {
  const camera = new PerspectiveCamera(65, 16 / 9, .05, 100);
  camera.position.set(.8, .3, -1); camera.lookAt(0, 0, -5); camera.updateMatrixWorld(true);
  const sharedTop = new Vector3(0, 1.2, -5), sharedBottom = new Vector3(0, -1.2, -5);
  const left = [new Vector3(-.24, 1.2, -4.97), sharedTop, sharedBottom, new Vector3(-.24, -1.2, -4.97)];
  const right = [sharedTop, new Vector3(.24, 1.2, -4.97), new Vector3(.24, -1.2, -4.97), sharedBottom];
  const a = curvedSliceClip(projectScreenPlane(left, camera, 1920, 1080, SOURCE_WIDTH, SOURCE_HEIGHT).matrix, SOURCE_WIDTH, SOURCE_HEIGHT);
  const b = curvedSliceClip(projectScreenPlane(right, camera, 1920, 1080, SOURCE_WIDTH, SOURCE_HEIGHT).matrix, SOURCE_WIDTH, SOURCE_HEIGHT);
  for (const y of [0, SOURCE_HEIGHT * .2, SOURCE_HEIGHT * .5, SOURCE_HEIGHT]) {
    closePoint(mapScreenPoint(a.matrix, SOURCE_WIDTH + a.overlap, y), mapScreenPoint(b.matrix, b.overlap, y), 'adjacent UV boundaries must stay registered');
  }
});

test('unprojectable slices are null-safe and allocate no invalid matrix', () => {
  assert.deepEqual(curvedSliceClip(null, SOURCE_WIDTH, SOURCE_HEIGHT), { matrix: null, overlap: 0 });
  assert.deepEqual(curvedSliceClip(null, 0, 0), { matrix: null, overlap: 0 });
});
