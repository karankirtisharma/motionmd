import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { restoreStairLandingGlass, STAIR_LANDING_GUARD_NAME } from '../src/runtime/rendering/stairLandingGlass.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const sourceURL = manifest.chunks.find(chunk => chunk.id === 'v13').url;
const collisionURL = manifest.collisions.additionalUrls.find(url => url.endsWith('_additional-solids.glb'));
const worldTriangles = mesh => {
  const p = mesh.geometry.attributes.position, index = mesh.geometry.index, result = [], point = new T.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < (index?.count ?? p.count); i++) result.push(...point.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld).toArray());
  return result;
};

test('omitted upper landing glass is restored exactly from the shipping collision pane', async () => {
  const { root } = await geometryFixture(sourceURL);
  const { root: colliders } = await geometryFixture(collisionURL);
  let collider;
  colliders.traverse(object => { if (object.userData.sourceName === 'WG53 raised studio void guard glass') collider = object; });
  assert.ok(collider, 'retain the independently exported source pane as the geometry reference');
  const neighbor = root.getObjectByName('WEB_v13_architecture_14'), original = neighbor.geometry, material = neighbor.material;
  const ray = new T.Raycaster();
  // This ray falls inside the missing upper landing span, beyond the existing slope.
  ray.set(new T.Vector3(4.8, 4.8, -24), new T.Vector3(0, 0, -1)); ray.far = 1.5;
  assert.equal(ray.intersectObject(neighbor).length, 0, 'regression must reproduce the visible-export omission');
  assert.equal(restoreStairLandingGlass(root), 1);
  const pane = root.getObjectByName(STAIR_LANDING_GUARD_NAME);
  assert.deepEqual(worldTriangles(pane), worldTriangles(collider), 'all twelve source triangles and their winding must match collision exactly');
  assert.equal(pane.material, material, 'reuse source tint, IOR, roughness and transmission');
  assert.equal(neighbor.geometry, original, 'do not alter the existing sloped or curved glass');
  assert.equal(pane.userData.castShadow, false);
  root.updateMatrixWorld(true);
  for (const x of [3.65, 4.2, 4.8, 5.4, 5.95]) for (const y of [4.4, 4.8, 5.2]) for (const sign of [-1, 1]) {
    ray.set(new T.Vector3(x, y, sign > 0 ? -25.6 : -24), new T.Vector3(0, 0, sign));
    const hits = ray.intersectObject(pane);
    assert.equal(hits.length, 2, 'both faces close the previously missing span');
    assert.ok(Math.abs(hits[1].distance - hits[0].distance - .012) < .00001, 'retain 12 mm source thickness');
    assert.ok(Math.abs(hits[0].normal.z) > .999, 'broad-face reflections remain planar');
  }
});

test('landing restoration is idempotent and scoped to the original glass primitive', async () => {
  assert.equal(restoreStairLandingGlass(new T.Group()), 0);
  const { root } = await geometryFixture(sourceURL);
  assert.equal(restoreStairLandingGlass(root), 1);
  const pane = root.getObjectByName(STAIR_LANDING_GUARD_NAME), geometry = pane.geometry, material = pane.material;
  assert.equal(restoreStairLandingGlass(root), 0);
  assert.equal(pane.geometry, geometry);
  assert.equal(pane.material, material);
  let count = 0;
  root.traverse(object => { if (object.name === STAIR_LANDING_GUARD_NAME) count++; });
  assert.equal(count, 1, 'repeated material preparation must not duplicate the pane');
});
