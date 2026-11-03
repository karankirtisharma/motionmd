import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Plane, Vector3, Vector4, WebGPUCoordinateSystem, WebGLCoordinateSystem } from 'three';
import { createMirrorCameraUpdater } from '../src/runtime/rendering/galleryMirror.ts';

// Retain the previous formulas as an independent parity oracle. Optimizing the
// scratch allocations must not move the reflection or change oblique clipping.
function previous(source, camera, point, normal) {
  source.updateMatrixWorld(); camera.copy(source, false);
  const position = source.getWorldPosition(new Vector3()), direction = source.getWorldDirection(new Vector3());
  camera.position.copy(position).addScaledVector(normal, -2 * position.clone().sub(point).dot(normal));
  camera.up.copy(source.up).transformDirection(source.matrixWorld).reflect(normal);
  camera.lookAt(camera.position.clone().add(direction.reflect(normal))); camera.updateMatrixWorld();
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(camera.matrixWorldInverse);
  const clip = new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const reversed = source.reversedDepth, glForward = source.coordinateSystem === WebGLCoordinateSystem && !reversed;
  const far = new Vector4(Math.sign(clip.x) || 1, Math.sign(clip.y) || 1, reversed ? 0 : 1, 1).applyMatrix4(source.projectionMatrixInverse);
  clip.multiplyScalar((glForward ? 2 : 1) / clip.dot(far));
  const p = camera.projectionMatrix.elements;
  for (let column = 0; column < 4; column++) { const c = clip.getComponent(column), w = p[column * 4 + 3]; p[column * 4 + 2] = reversed ? w - c : glForward ? c - w : c; }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); camera._reversedDepth = reversed;
  return camera;
}

test('retained mirror scratch produces exactly the previous camera and clip planes on both APIs/depth conventions', () => {
  const update = createMirrorCameraUpdater(), other = createMirrorCameraUpdater();
  const source = new PerspectiveCamera(), expected = new PerspectiveCamera(), actual = new PerspectiveCamera();
  let poses = 0;
  for (const coordinateSystem of [WebGPUCoordinateSystem, WebGLCoordinateSystem]) for (const reversed of [false, true]) {
    source.coordinateSystem = coordinateSystem; source._reversedDepth = reversed;
    for (let i = 0; i < 128; i++) {
      source.fov = 35 + i % 40; source.aspect = .7 + (i % 12) / 8;
      source.near = .05 + (i % 4) * .05; source.far = 1800;
      source.position.set(3 + Math.cos(i * .13) * 8, 1 + (i % 9) * .4, 2 + Math.sin(i * .13) * 8);
      source.lookAt(.5, 1.2, -.5); source.updateProjectionMatrix();
      const point = new Vector3(.3, .8, -1), normal = new Vector3(Math.sin(i * .04), 0, Math.cos(i * .04));
      previous(source, expected, point, normal); update(source, actual, point, normal);
      for (const key of ['matrixWorld', 'matrixWorldInverse', 'projectionMatrix', 'projectionMatrixInverse'])
        assert.deepEqual(actual[key].elements, expected[key].elements, `${coordinateSystem}/${reversed}/${i}/${key}`);
      other(source, new PerspectiveCamera(), point.negate(), normal.negate());
      poses++;
    }
  }
  assert.equal(poses, 512);
});
