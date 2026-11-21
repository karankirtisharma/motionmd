import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { closeEntryStairJoint } from '../src/runtime/rendering/entryStairJoint.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
async function chunk(id) {
  let b = fs.readFileSync(new URL(`../public${manifest.chunks.find(c => c.id === id).url}`, import.meta.url));
  const length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers; json.materials = json.materials.map(m => ({ name: m.name }));
  let e = Buffer.from(JSON.stringify(json)); e = Buffer.concat([e, Buffer.alloc((4 - e.length % 4) % 4, 32)]);
  const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + e.length + b.length - 20 - length, 8); h.writeUInt32LE(e.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  b = Buffer.concat([h, e, b.subarray(20 + length)]);
  const scene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene;
  // As in the site: these stone materials are double-sided (the exported entry blocks' tops are wound downwards).
  scene.traverse(o => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
  return scene;
}
const top = (root, x, z) => { const hit = new THREE.Raycaster(new THREE.Vector3(x, .5, z), new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(root, true)[0]; return hit && { y: hit.point.y, up: Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y) }; };

test('the front entry stair meets the terrace flush: no dark notch along the joint, its exposed tread nose untouched', async () => {
  const root = new THREE.Group(); root.add(await chunk('shell'), await chunk('entrance')); root.updateMatrixWorld(true);
  for (const z of [-18.5, -17, -15.6]) assert.ok(top(root, -5.8015, z).y < -.015, `the notch is there before the repair (z ${z})`);
  const cornerBefore = top(root, -6.146, -15.002);
  assert.ok(closeEntryStairJoint(root) > 0);
  for (const z of [-19.1, -18.5, -17, -15.6, -15.1]) for (const x of [-5.8085, -5.805, -5.8015]) {
    const hit = top(root, x, z);
    assert.ok(Math.abs(hit.y + .01) < 1e-4 && hit.up > .999, `flush and level at (${x}, ${z}): ${hit.y}, normal y ${hit.up}`);
  }
  const cornerAfter = top(root, -6.146, -15.002);
  assert.ok(Math.abs(cornerAfter.y - cornerBefore.y) < 1e-6, 'the corner facing the sand keeps its rounded edge');
  assert.equal(closeEntryStairJoint(root), 0, 'idempotent');
});

test('one flush surface across the left facade junction and the entry stair, after the lightmap split', async t => {
  const { geometryFixture } = await import('./helpers/geometry-fixture.mjs');
  const { repairExteriorWinding, repairExteriorOverlap, repairExteriorGroove } = await import('../src/runtime/rendering/exteriorSurfaces.ts');
  const { repairEntranceApron } = await import('../src/runtime/rendering/entranceApron.ts');
  const { repairFounderExteriorWinding, splitExteriorLightingReceivers } = await import('../src/runtime/rendering/exteriorLighting.ts');
  const root = new THREE.Group();
  for (const c of manifest.chunks) root.add((await geometryFixture(c.url)).root);
  repairExteriorWinding(root); repairExteriorOverlap(root); repairExteriorGroove(root);
  repairEntranceApron(root); repairFounderExteriorWinding(root);
  const meta = JSON.parse(fs.readFileSync('public/assets/exterior-finish-v24/lighting.json'));
  const uv = fs.readFileSync('public' + meta.uv);
  splitExteriorLightingReceivers(root, meta, new Float32Array(uv.buffer, uv.byteOffset, uv.length / 4));
  root.updateMatrixWorld(true);
  const surfaces = [];
  root.traverse(m => {
    if (!m.isMesh) return;
    const b = new THREE.Box3().setFromObject(m);
    if (b.max.x < -7 || b.min.x > 0 || b.max.z < -25.1 || b.min.z > -13 || b.min.y > .003 || b.max.y < -.36) return;
    m.material.side = THREE.DoubleSide;
    surfaces.push(m);
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0), 0, .4);
  const hits = (x,z) => {
    ray.ray.origin.set(x, .001, z);
    return ray.intersectObjects(surfaces, false).filter(h => Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) > .1);
  };
  function junction() {
    let tested = 0, failed = 0;
    for (const [axis, seam, low, high] of [
      ['z', -24.99, -3.49, -.02], ['z', -24.1, -3.49, -2.34],
      ['x', -2.339998, -24.989, -23.53], ['x', -5.799997, -19.19999, -15.00001],
    ]) {
      for (let along = low; along <= high; along += .043) {
        for (const offset of [-.008,-.002,-.00002,.00002,.002,.008]) {
          const near = hits(axis === 'x' ? seam+offset : along, axis === 'z' ? seam+offset : along)
            .filter(h => Math.abs(h.point.y + .010) < .003);
          tested++;
          if (near.length !== 1 || Math.abs(near[0].point.y + .010) > .00005) failed++;
        }
      }
    }
    return { tested, failed };
  }
  const before = junction();
  assert.ok(before.failed > 200);
  const nearPlanter = () => hits(-4.825, -14.44).filter(h => Math.abs(h.point.y + .01) < .003);
  assert.ok(nearPlanter().length >= 2);
  assert.ok(closeEntryStairJoint(root) > 0);
  const after = junction();
  t.diagnostic(JSON.stringify({before,after}));
  assert.equal(after.failed, 0);
  assert.equal(nearPlanter().length, 1);

  // A closed mesh can still show the stripe: check the actual gallery irradiance atlas.
  const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
  const material = manifest.materials.find(m => m.name === 'gallery__EH54 | scanned cream limestone panels');
  const bytes = fs.readFileSync('public' + material.lightMap);
  const atlas = new EXRLoader().setDataType(THREE.FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  for (const x of [-2.05, -1.5, -1, -.5, -.15]) {
    const sample = hits(x, -24.9899)[0];
    assert.equal(sample.object.name, 'Box_Entrance-side_upper_bridge002');
    const col = Math.floor(sample.uv1.x * atlas.width);
    const row = Math.floor((1 - sample.uv1.y) * atlas.height);
    const red = atlas.data[(row * atlas.width + col) * 4];
    assert.ok(red > .25, `gallery top at x=${x} is still sampling the buried edge: ${red}`);
  }
  assert.equal(closeEntryStairJoint(root), 0);
});
