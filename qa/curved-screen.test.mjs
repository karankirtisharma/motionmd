import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, PerspectiveCamera, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { sampleScreenSurface, curvedScreenPatches } from '../src/runtime/presentation/curvedSurface.ts';
import { projectScreenPlane, mapScreenPoint } from '../src/runtime/presentation/projection.ts';

test('16- and 32-fragment curved TVs retain authored geometry and registration at identical close camera poses', async t => {
  const { root } = await geometryFixture('/assets/architecture-v16/lounge.glb'), meshes = [];
  root.traverse(object => { if (object.isMesh && (object.userData.sourceName ?? object.name) === 'PL78 | curved LED pixel surface') meshes.push(object); });
  assert.ok(meshes.length);
  const arrays = meshes.map(mesh => Array.from(mesh.geometry.attributes.position.array));
  const front = new Vector3(0, 0, 1), center = sampleScreenSurface(meshes, .5, .5, front), edge = sampleScreenSurface(meshes, 0, 0, front);
  assert.ok(edge.z - center.z > .7, 'fixture must retain its actual 714mm curvature');
  assert.ok(Math.abs(center.y - 1.945) < 1e-5);
  assert.equal(curvedScreenPatches(meshes, front).length, 32, 'helper default remains 32; runtime may choose an explicit count');
  const poses = [
    [[11.6, 1.8, -9.8], [11.6, 2.8, -10.33]],
    [[11.6, 3.5, -9.3], [11.6, .8, -10.33]],
    [[8.4, 1.8, -9.1], [10.2, 2, -10.2]],
    [[14.9, 1.8, -9.1], [13.6, 1.1, -10.2]],
    [[11.6, 1.8, -5], [11.6, 1.95, -10.33]],
  ];
  for (const [count, tolerance] of [[16, .003], [32, .001]]) {
    const patches = curvedScreenPatches(meshes, front, count), sourceWidth = 1600 / count;
    assert.equal(patches.length, count);
    const maxFacetError = Math.max(...patches.map(patch => sampleScreenSurface(meshes, patch.u + patch.width / 2, .5, front).distanceTo(patch.center)));
    assert.ok(maxFacetError < tolerance, `${count} fragments: ${maxFacetError}m exceeds ${tolerance}m facet tolerance`);
    let checks = 0;
    for (const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversed of [false, true]) for (const [position, target] of poses) {
      const camera = new PerspectiveCamera(65, 16 / 9, .05, 100);
      camera.coordinateSystem = api; camera._reversedDepth = reversed; camera.updateProjectionMatrix();
      camera.position.fromArray(position); camera.lookAt(...target); camera.updateMatrixWorld(true);
      const projected = patches.map(patch => projectScreenPlane(patch.corners, camera, 1920, 1080, sourceWidth, 558));
      assert.ok(projected.some(patch => patch.visible), `${count} fragments must retain a visible portion at every pose`);
      for (let i = 0; i < patches.length; i++) for (const v of [0, .5, 1]) {
        const world = patches[i].corners[0].clone().lerp(patches[i].corners[3], v).project(camera);
        const actual = mapScreenPoint(projected[i].matrix, 0, 558 * v);
        assert.ok(Math.hypot(actual.x - (world.x + 1) * 960, actual.y - (1 - world.y) * 540) < 1e-4); checks++;
        if (i) {
          const previous = mapScreenPoint(projected[i - 1].matrix, sourceWidth, 558 * v);
          assert.ok(Math.hypot(actual.x - previous.x, actual.y - previous.y) < 1e-4, `${count} fragment boundary ${i} stays registered`);
        }
      }
    }
    assert.equal(checks, count * 3 * poses.length * 4);
    t.diagnostic(JSON.stringify({ fragments: count, maximumFacetErrorMm: maxFacetError * 1000, boundaryChecks: checks }));
  }
  meshes.forEach((mesh, index) => assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), arrays[index]));
});
