import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Execute the shipped TypeScript without a build, a browser or temporary files.
// Resolving Three to an ESM file URL preserves the same Three instance as the loader.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (relativePath) => ts.transpileModule(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const movementURL = dataModule(transpile('../src/runtime/interaction/movement.ts'));
const avatarSource = transpile('../src/runtime/interaction/RocketboxAvatar.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`);
const { createRocketboxAvatar } = await import(dataModule(avatarSource));

// Geometry, skinning and all animation buffers remain intact. Texture decoding
// needs browser APIs and is unrelated to this numerical pose check.
const bytes = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const oldLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + oldLength));
delete json.images; delete json.textures; delete json.samplers;
json.materials = json.materials.map((material) => ({ name: material.name }));
let encoded = Buffer.from(JSON.stringify(json));
encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8);
header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
const load = () => new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
const seatHeightAboveFloor = 0.56655; // Source cushion top .59155 m minus source chair floor .025 m.

function updateSkeletons(root) {
  root.updateMatrixWorld(true);
  root.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.update(); });
}

for (const [name, speed, seated] of [['Idle', 0, 0], ['Walk', 1.38, 0], ['Run', 3.35, 0], ['Sit', 0, 1]]) {
  test(`${name}: complete clip loop stays finite, human scale and above the floor`, async (context) => {
    const gltf = await load();
    const avatar = createRocketboxAvatar(gltf);
    const box = new THREE.Box3(), point = new THREE.Vector3();
    let minimum = Infinity, maximum = -Infinity, footMinimum = Infinity, footMaximum = -Infinity;
    const frames = Math.ceil(Math.max(3, (gltf.animations.find((clip) => clip.name === name)?.duration ?? 0) + 0.2) * 60);
    try {
      for (let frame = 0; frame < frames; frame++) {
        avatar.update(1 / 60, speed, seated, seatHeightAboveFloor);
        updateSkeletons(avatar.root);
        if (frame % 15) continue;
        box.makeEmpty();
        avatar.root.traverse((object) => {
          if (object.isMesh) for (let i = 0; i < object.geometry.attributes.position.count; i++) {
            object.getVertexPosition(i, point); point.applyMatrix4(object.matrixWorld);
            assert.ok(Number.isFinite(point.x + point.y + point.z)); box.expandByPoint(point);
          }
          if (object.isBone && /bip01[lr]foot/i.test(object.name.replace(/[^a-z0-9]/gi, ''))) {
            const y = object.getWorldPosition(point).y;
            footMinimum = Math.min(footMinimum, y); footMaximum = Math.max(footMaximum, y);
          }
        });
        minimum = Math.min(minimum, box.min.y); maximum = Math.max(maximum, box.max.y);
      }
      assert.ok(maximum < 2 && maximum > 1, 'human scale maintained');
      assert.ok(minimum > -0.06, 'feet do not materially penetrate the floor');
      if (seated) assert.ok(footMaximum - footMinimum < 0.015, 'seated feet remain planted during breathing');
      context.diagnostic(JSON.stringify({ frames, minimumVertexY: minimum, maximumVertexY: maximum, minimumAnkleY: footMinimum, maximumAnkleY: footMaximum }));
    } finally { avatar.dispose(); }
  });
}

test('sit and stand blending plants the feet while the body turns toward a source chair', async (context) => {
  const avatar = createRocketboxAvatar(await load());
  let minimum = Infinity, maximum = -Infinity;
  const point = new THREE.Vector3();
  try {
    for (let frame = 0; frame < 240; frame++) {
      const phase = frame < 60 ? frame / 60 : frame < 120 ? 1 : frame < 180 ? 1 - (frame - 120) / 60 : 0;
      const weight = phase * phase * phase * (phase * (phase * 6 - 15) + 10);
      avatar.root.rotation.y = weight * 2.3;
      avatar.update(1 / 60, 0, weight, seatHeightAboveFloor);
      updateSkeletons(avatar.root);
      avatar.root.traverse((object) => {
        if (object.isMesh) for (let i = 0; i < object.geometry.attributes.position.count; i++) {
          object.getVertexPosition(i, point); point.applyMatrix4(object.matrixWorld);
          assert.ok(Number.isFinite(point.x + point.y + point.z));
          minimum = Math.min(minimum, point.y); maximum = Math.max(maximum, point.y);
        }
      });
    }
    assert.ok(minimum > -0.002, `sit/stand transition stays above floor: ${minimum}`);
    assert.ok(maximum < 1.83, 'sit/stand does not increase avatar height unexpectedly');
    context.diagnostic(JSON.stringify({ frames: 240, minimumVertexY: minimum, maximumVertexY: maximum }));
  } finally { avatar.dispose(); }
});

test('body camera uses source eye calibration and hides only head/hair primitives', async (context) => {
  const avatar = createRocketboxAvatar(await load());
  const meshes = [];
  avatar.root.traverse((object) => { if (object.isMesh) meshes.push(object); });
  const head = meshes.filter((mesh) => /m005_(head|opacity)/i.test(mesh.material.name));
  const body = meshes.filter((mesh) => /m005_body/i.test(mesh.material.name));
  try {
    assert.equal(head.length, 2); assert.equal(body.length, 1);
    assert.ok(avatar.view.eyeHeight > 1.55 && avatar.view.eyeHeight < 1.73);
    assert.ok(avatar.view.seatedEyeOffset > 0.70 && avatar.view.seatedEyeOffset < 1);
    avatar.setBodyView(true);
    assert.ok(head.every((mesh) => !mesh.visible)); assert.ok(body.every((mesh) => mesh.visible));
    avatar.update(1 / 60, 1.38, 0, seatHeightAboveFloor);
    assert.ok(head.every((mesh) => !mesh.visible), 'animation must not restore the occluding head');
    avatar.setBodyView(false);
    assert.ok(meshes.every((mesh) => mesh.visible), 'third person restores the complete original character');
    context.diagnostic(JSON.stringify(avatar.view));
  } finally { avatar.dispose(); }
});
