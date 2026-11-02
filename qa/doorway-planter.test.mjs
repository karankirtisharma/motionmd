import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { relocateDoorwayPlanter, DOORWAY_PLANTER_OFFSET } from '../src/runtime/rendering/doorwayPlanter.ts';

test('the complete doorway plant moves rigidly without changing other plants, UVs or topology', async () => {
  // Decode the shipped geometry, without fetching textures in Node.
  const original = fs.readFileSync(new URL('../public/assets/architecture-v16/studio.glb', import.meta.url));
  const length = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers;
  json.materials = json.materials.map(material => ({ name: material.name }));
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const header = Buffer.from(original.subarray(0, 20));
  header.writeUInt32LE(original.length - length + padded.length, 8); header.writeUInt32LE(padded.length, 12);
  const file = Buffer.concat([header, padded, original.subarray(20 + length)]);
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.length), '');
  scene.updateMatrixWorld(true);
  const records = [];
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    records.push({ mesh, before: mesh.geometry.getAttribute('position').array.slice(), attributes: mesh.geometry.attributes, index: mesh.geometry.index });
  });
  assert.equal(relocateDoorwayPlanter(scene), 113875);
  const movedMaterials = new Set(), point = new Vector3(), after = new Vector3();
  for (const { mesh, before, attributes, index } of records) {
    const position = mesh.geometry.getAttribute('position');
    const moved = new Uint8Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const delta = Math.abs(position.getX(i) - before[i * 3]) + Math.abs(position.getZ(i) - before[i * 3 + 2]);
      if (delta < 1e-6) continue;
      moved[i] = 1; movedMaterials.add(mesh.material.name);
      point.fromArray(before, i * 3).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.x > 19.39 && point.x < 20.64 && point.z > -12.36 && point.z < -11.36 && point.y >= 0 && point.y < 2.41, 'only the measured source assembly can move');
      after.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).sub(point);
      assert.ok(after.distanceTo(new Vector3(...DOORWAY_PLANTER_OFFSET)) < 2e-6, 'all parts use the same rigid translation');
    }
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const flags = [0, 1, 2].map(j => moved[index ? index.getX(i + j) : i + j]);
      assert.ok(flags.every(flag => flag === flags[0]), 'no triangle may stretch between moved and unmoved plants');
    }
    assert.equal(mesh.geometry.index, index);
    for (const name of ['uv', 'uv1', 'normal']) assert.equal(mesh.geometry.getAttribute(name), attributes[name]);
  }
  assert.equal(movedMaterials.size, 4);
  assert.equal(relocateDoorwayPlanter(scene), 0, 'repeated preparation must not move the plant twice');
});
