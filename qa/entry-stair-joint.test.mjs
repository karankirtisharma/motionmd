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

test('the front entry stair meets the terrace flush: no dark notch along the joint, its outer corners untouched', async () => {
  const root = new THREE.Group(); root.add(await chunk('shell'), await chunk('entrance')); root.updateMatrixWorld(true);
  for (const z of [-18.5, -17, -15.6]) assert.ok(top(root, -5.8015, z).y < -.015, `the notch is there before the repair (z ${z})`);
  const cornerBefore = top(root, -5.8015, -15.002);
  assert.ok(closeEntryStairJoint(root) > 0);
  for (const z of [-19.1, -18.5, -17, -15.6, -15.1]) for (const x of [-5.8085, -5.805, -5.8015]) {
    const hit = top(root, x, z);
    assert.ok(Math.abs(hit.y + .01) < 1e-4 && hit.up > .999, `flush and level at (${x}, ${z}): ${hit.y}, normal y ${hit.up}`);
  }
  const cornerAfter = top(root, -5.8015, -15.002);
  assert.ok(Math.abs(cornerAfter.y - cornerBefore.y) < .01, 'the corner facing the sand keeps its rounded edge');
  assert.equal(closeEntryStairJoint(root), 0, 'idempotent');
});
