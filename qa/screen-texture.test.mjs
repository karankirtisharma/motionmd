import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { createScreenTexture } from '../src/runtime/presentation/screenTexture.ts';
import { sampleScreenSurface } from '../src/runtime/presentation/curvedSurface.ts';

test('Studio UVs agree with pointer rays across the shipped curved TV and use normal scene occlusion', async () => {
  const { root } = await geometryFixture('/assets/architecture-v16/lounge.glb');
  const meshes = [];
  root.traverse(mesh => {
    if (mesh.isMesh && (mesh.userData.sourceName ?? mesh.name) === 'PL78 | curved LED pixel surface') meshes.push(mesh);
  });
  assert.ok(meshes.length);
  const original = meshes[0].material;
  const screen = createScreenTexture(meshes);
  assert.equal(meshes[0].material, original, 'the authored display remains during initial loading');
  screen.paint({ width: 1600, height: 558 });
  const material = meshes[0].material;
  assert.equal(material.map.flipY, false);
  assert.equal(material.map.colorSpace, SRGBColorSpace);
  assert.deepEqual([material.transparent, material.depthTest, material.depthWrite, material.toneMapped], [false, true, true, false]);
  const front = new Vector3(0, 0, 1);
  for (const u of [.05, .28, .5, .72, .95]) for (const v of [.05, .5, .95]) {
    const point = sampleScreenSurface(meshes, u, v, front);
    const ray = new Raycaster(point.clone().addScaledVector(front, .25), front.clone().negate());
    const hit = ray.intersectObjects(meshes, false)[0];
    assert.ok(hit, 'the display must be visible and interactive from the room');
    const textureUV = material.map.transformUv(hit.uv.clone());
    assert.ok(textureUV.distanceTo(new Vector2(u, v)) < 1e-5);
  }
  screen.dispose();
  assert.equal(meshes[0].material, original);
});

test('texture updates are driven by paints, keep one GPU allocation per size and release on teardown', () => {
  const original = new MeshBasicMaterial(), secondOriginal = [new MeshBasicMaterial()];
  const meshes = [new Mesh(undefined, original), new Mesh(undefined, secondOriginal)];
  const screen = createScreenTexture(meshes);
  const canvas = { width: 0, height: 0 };
  screen.paint(canvas);
  assert.equal(screen.takeDirty(), false);
  assert.equal(meshes[0].material, original);

  Object.assign(canvas, { width: 1600, height: 558 });
  screen.paint(canvas);
  const material = meshes[0].material, first = material.map;
  assert.equal(meshes[1].material, material);
  const version = first.version;
  assert.equal(screen.takeDirty(), true);
  assert.equal(screen.takeDirty(), false, 'camera-only frames cannot re-upload the texture');
  screen.paint(canvas);
  assert.equal(material.map, first);
  assert.equal(material.map.version, version + 1);

  let firstDisposals = 0, secondDisposals = 0, materialDisposals = 0;
  first.addEventListener('dispose', () => firstDisposals++);
  canvas.width *= 2; canvas.height *= 2;
  screen.paint(canvas);
  assert.notEqual(material.map, first, 'resizing the same canvas replaces immutable GPU storage');
  assert.equal(firstDisposals, 1);
  material.map.addEventListener('dispose', () => secondDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  screen.dispose(); screen.dispose(); screen.paint(canvas);
  assert.deepEqual([firstDisposals, secondDisposals, materialDisposals], [1, 1, 1]);
  assert.deepEqual(meshes.map(mesh => mesh.material), [original, secondOriginal]);
  assert.equal(screen.takeDirty(), false, 'a late capture cannot resurrect a disposed TV');
});
