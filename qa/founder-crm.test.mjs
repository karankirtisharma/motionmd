import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { crmCanvasSize } from '../src/runtime/presentation/FounderCRM.ts';
import { Mesh, MeshBasicMaterial, PlaneGeometry, PerspectiveCamera, Texture } from 'three';
import { createScreenAperture } from '../src/runtime/presentation/screenTexture.ts';
import { installFlatPanel } from '../src/runtime/presentation/flatPanel.ts';
async function load(url, omitImages = false) {
  assert.ok(url.startsWith('/assets/'));
  let bytes = fs.readFileSync(new URL(`../public${url}`, import.meta.url));
  if (omitImages) {
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
    delete json.images; delete json.textures; delete json.samplers;
    json.materials = json.materials.map(material => ({ name: material.name }));
    let encoded = Buffer.from(JSON.stringify(json));
    encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - length, 8);
    header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    bytes = Buffer.concat([header, encoded, bytes.subarray(20 + length)]);
  }
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}


test('founder face closes the curved housing with an aspect-matched CRM canvas', async () => {
  const gltf = await load('/assets/architecture-v21/founder.glb', true);
  gltf.scene.updateMatrixWorld(true);
  const screens = [];
  gltf.scene.traverse(object => {
    if (object.isMesh && object.material.name === 'FR79 | founder panoramic dashboard') screens.push(object);
  });
  const original = screens[0].geometry;
  const panel = installFlatPanel(screens);
  const width = panel.corners[0].distanceTo(panel.corners[1]);
  const height = panel.corners[0].distanceTo(panel.corners[3]);
  assert.deepEqual(crmCanvasSize(width, height), { width: 1600, height: 739 });
  assert.deepEqual(crmCanvasSize(10, 3), { width: 3000, height: 900 });
  assert.ok(panel.normal.x < -.99, 'display faces the chair');
  assert.ok(panel.collision.indices.length > 6, 'closed returns participate in collision');
  assert.throws(() => crmCanvasSize(0, 3));
  panel.dispose();
  assert.equal(screens[0].geometry, original, 'disposal restores source geometry');
});

// The retired dashboard map must never appear during boot, culling or reflection.
test('founder screen never uses the old dashboard image in any display state', () => {
  const old = new Texture(), mesh = new Mesh(new PlaneGeometry(7,3), new MeshBasicMaterial({map:old}));
  const main = new PerspectiveCamera(), reflected = new PerspectiveCamera();
  const aperture = createScreenAperture(mesh,main,true);
  for (const live of [false,true,false,true]) for (const camera of [main,reflected]) {
    aperture.setLive(live); mesh.onBeforeRender(null,null,camera,mesh.geometry,mesh.material,null);
    assert.equal(mesh.material.map,null); assert.equal(mesh.material.color.getHex(),0);
    assert.equal(mesh.material.opacity,live && camera === main ? 0 : 1);
  }
  aperture.dispose(); mesh.material.dispose(); mesh.geometry.dispose(); old.dispose();
});
