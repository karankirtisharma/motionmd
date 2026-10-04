import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyLookInput, cameraLookDirection, cameraShortcut, damping, cameraRelativeMove, smoothAngle, smoothEyeHeight } from '../src/runtime/interaction/movement.ts';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
function readAsset(url) {
  assert.ok(typeof url === 'string' && url.startsWith('/assets/'), 'QA requires a manifest asset path below /assets/');
  return fs.readFileSync(new URL(`../public${url}`, import.meta.url));
}

async function sourceCollision() {
  const root = new THREE.Group();
  for (const url of [manifest.collisions.url, ...(manifest.collisions.additionalUrls ?? [])]) {
    const bytes = readAsset(url);
    root.add((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene);
  }
  return createCollisionWorld(root, undefined, root);
}

test('all four source chairs have free approach corners and the central table blocks standing', async () => {
  const physics = await sourceCollision();
  try {
    assert.equal(manifest.chairs.length, 4);
    assert.equal(new Set(manifest.chairs.map((chair) => chair.id)).size, 4);
    for (const chair of manifest.chairs) {
      const seat = new THREE.Vector3(...chair.seatPosition);
      const forward = new THREE.Vector3(...chair.forward).normalize();
      const side = new THREE.Vector3(forward.z, 0, -forward.x);
      const corners = [0.65, -0.65, 0.85, -0.85, 1.05, -1.05].map((sign) => seat.clone().addScaledVector(forward, 0.45).addScaledVector(side, sign).setY(chair.position[1]));
      assert.ok(corners.some((feet) => physics.canStandAt(feet)), `${chair.id} must offer a collision-free front-corner approach`);
    }
    assert.equal(physics.canStandAt(new THREE.Vector3(11.6, 0.025, -6.2)), false, 'source table must block the standing capsule');
    assert.ok(physics.canStandAt(new THREE.Vector3(8.5, 0, -5)), 'tour handoff must be a valid standing location');
  } finally { physics.dispose(); }
});

test('original upper circulation surfaces support the bridge, deck and founder approach', async () => {
  const physics = await sourceCollision();
  try {
    for (const [x, z, elevation] of [[-1.3, -17, 4.2], [0, -24, 4.228], [4.5, -23.85, 4.228], [16, -23.85, 3.675], [1, -10.2, 4.228]]) {
      const floor = physics.groundAt(new THREE.Vector3(x, elevation + 0.03, z));
      assert.ok(Math.abs(floor - elevation) < 0.035, `original circulation must exist at ${x},${z}; found ${floor}`);
    }
    const pivot = new THREE.Vector3(-3.0, 1.7, -17.55), inside = new THREE.Vector3(0, 1.7, -17.55);
    assert.ok(physics.hasLineOfSight(pivot, inside), 'source doors frozen in their authored open pose must admit the tour camera');
  } finally { physics.dispose(); }
});

test('diagonal movement stays at walking speed and respects camera yaw', () => {
  const diagonal = cameraRelativeMove(1, 1, 0);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
  const rightFacing = cameraRelativeMove(0, 1, -Math.PI / 2);
  assert.ok(rightFacing.x > 0.999 && Math.abs(rightFacing.z) < 1e-10);
});

test('the exported architectural stair can be climbed to its actual landing', async () => {
  const bytes = readAsset(manifest.collisions.url);
  const root = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const physics = await createCollisionWorld(root, undefined, root);
  try {
    assert.ok(physics.meshCount > 100 && physics.triangleCount > 10000, 'the test must use source architectural geometry');
    const feet = new THREE.Vector3(18.45, 0, -26.187);
    physics.place(feet);
    let grounded = false, velocityY = 0;
    for (let i = 0; i < 310; i++) {
      velocityY = grounded ? -0.06 : Math.max(-16, velocityY - 9.81 / 60);
      grounded = physics.move(new THREE.Vector3(0.422618 * 1.38 / 60, velocityY / 60, 0.906308 * 1.38 / 60), 1 / 60, feet);
    }
    assert.ok(feet.y > 2.72 && feet.y < 2.80, `must reach source landing at 2.756 m, got ${feet.y}`);
    assert.ok(grounded, 'the player must remain grounded on the landing');
  } finally {
    physics.dispose();
    root.traverse((item) => { if (item.isMesh) { item.geometry.dispose(); (Array.isArray(item.material) ? item.material : [item.material]).forEach((material) => material.dispose()); } });
  }
});

test('damping response is stable across frame rates and heading wraps by shortest angle', () => {
  const advance = (rate) => {
    let value = 0;
    for (let i = 0; i < rate; i++) value += (1 - value) * damping(8, 1 / rate);
    return value;
  };
  assert.ok(Math.abs(advance(30) - advance(144)) < 1e-10);
  const a = 179 * Math.PI / 180, b = -179 * Math.PI / 180;
  assert.ok(Math.abs(smoothAngle(a, b, 0.5) - Math.PI) < 1e-10);
});

test('capsule stays grounded, climbs a stair, and cannot pass through a wall', async () => {
  const scene = new THREE.Group();
  const box = (name, size, position) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
    mesh.name = name; mesh.position.set(...position); scene.add(mesh);
  };
  box('floor', [20, 0.2, 20], [0, -0.1, 0]);
  box('wall', [0.2, 3, 8], [2, 1.5, 0]);
  box('stair step', [1.2, 0.18, 1.2], [0, 0.09, 0.6]);
  const physics = await createCollisionWorld(scene);
  try {
    const feet = new THREE.Vector3(0, 0, -1);
    physics.place(feet);
    for (let i = 0; i < 20; i++) physics.move(new THREE.Vector3(0, -0.01, 0), 1 / 60, feet);
    assert.ok(Math.abs(feet.y) < 0.04, `feet must contact floor, got ${feet.y}`);
    let highest = feet.y;
    for (let i = 0; i < 110; i++) {
      physics.move(new THREE.Vector3(0, -0.001, 1.1 / 60), 1 / 60, feet);
      highest = Math.max(highest, feet.y);
    }
    assert.ok(highest > 0.13 && highest < 0.25, `must climb 18 cm stair, highest=${highest}`);
    feet.set(0, 0, -2); physics.place(feet);
    for (let i = 0; i < 180; i++) physics.move(new THREE.Vector3(2 / 60, -0.01, 0), 1 / 60, feet);
    assert.ok(feet.x < 1.7 && feet.x > 1.5, `wall must stop capsule, got x=${feet.x}`);
    const cameraDistance = physics.cameraDistance(new THREE.Vector3(0, 1.3, -2), new THREE.Vector3(4, 1.3, -2));
    assert.ok(cameraDistance < 1.8 && cameraDistance > 1.5, `camera must remain in front of wall, distance=${cameraDistance}`);
  } finally {
    physics.dispose();
    scene.traverse((item) => { if (item.isMesh) { item.geometry.dispose(); item.material.dispose(); } });
  }
});

test('L and V act once per press and do not intercept text or dialog input', () => {
  assert.equal(cameraShortcut('KeyL', false, false), 'pointerLock');
  assert.equal(cameraShortcut('KeyV', false, false), 'cameraView');
  for (const key of ['KeyL', 'KeyV']) {
    assert.equal(cameraShortcut(key, true, false), null);
    assert.equal(cameraShortcut(key, false, true), null);
  }
  assert.equal(cameraShortcut('KeyE', false, false), null);
});

test('body-camera look points along movement heading and permits a downward body view', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI, 8.3]) {
    const direction = cameraLookDirection(yaw, 0), movement = cameraRelativeMove(0, 1, yaw);
    assert.ok(Math.abs(direction.x - movement.x) < 1e-10 && Math.abs(direction.z - movement.z) < 1e-10);
  }
  const down = applyLookInput(0, 0, 0, 2000, 'bodyCam');
  const direction = cameraLookDirection(down.yaw, down.pitch);
  assert.ok(direction.y < -0.97, 'looking down reveals torso and feet');
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-10);
  assert.equal(applyLookInput(0, 0, 0, -2000, 'bodyCam').pitch, -1.15);
  assert.equal(applyLookInput(0, down.pitch, 0, 0, 'thirdPerson').pitch, 0.95);
});

test('eye-height smoothing removes stair impulses without idle bob or frame-rate drift', () => {
  assert.equal(smoothEyeHeight(1.64, 1.64, 1 / 60), 1.64);
  const firstFrame = smoothEyeHeight(1.64, 1.82, 1 / 60);
  assert.ok(firstFrame > 1.64 && firstFrame < 1.82, '18 cm stair rise must not snap the camera');
  const advance = (fps) => { let height = 1.64; for (let i = 0; i < fps; i++) height = smoothEyeHeight(height, 1.82, 1 / fps); return height; };
  assert.ok(Math.abs(advance(30) - advance(144)) < 1e-10);
  assert.ok(Math.abs(advance(60) - 1.82) < 1e-7);
});

test('physical perimeter blocks all four exits without altering source mesh counts', async () => {
  const scene = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 30), new THREE.MeshBasicMaterial());
  floor.name = 'floor'; floor.position.y = -0.1; scene.add(floor);
  const physics = await createCollisionWorld(scene, undefined, undefined, [], { minX: -3, maxX: 3, minZ: -4, maxZ: 4, height: 20 });
  try {
    assert.equal(physics.perimeterColliders, 4); assert.equal(physics.meshCount, 1);
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const feet = new THREE.Vector3(); physics.place(feet);
      for (let i = 0; i < 300; i++) physics.move(new THREE.Vector3(x * 3.35 / 60, -0.001, z * 3.35 / 60), 1 / 60, feet);
      assert.ok(Math.abs(feet.x) < 2.76 && Math.abs(feet.z) < 3.76, 'capsule must remain inside the permitted rectangle');
      assert.ok(Math.hypot(feet.x, feet.z) > 2.6, 'movement reaches the perimeter rather than being disabled');
    }
  } finally { physics.dispose(); floor.geometry.dispose(); floor.material.dispose(); }
});

test('the original visible context ground is collidable outside the entrance slab', async () => {
  const shellChunk = manifest.chunks.find(chunk => chunk.id === 'shell');
  assert.ok(shellChunk, 'the delivered manifest must identify its source shell chunk');
  const bytes = readAsset(shellChunk.url);
  const oldLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + oldLength));
  delete json.images; delete json.textures; delete json.samplers;
  json.materials = json.materials.map((material) => ({ name: material.name }));
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8);
  header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
  const shell = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '')).scene;
  const colliders = new THREE.Group();
  const physics = await createCollisionWorld(shell, undefined, colliders, [], { minX: -14, maxX: 34, minZ: -50, maxZ: 14, height: 20 });
  try {
    assert.equal(physics.meshCount, 1, 'only the exact source context-ground primitive is borrowed');
    const feet = new THREE.Vector3(-10, -0.355, -17.55);
    assert.ok(Math.abs(physics.groundAt(feet) + 0.355) < 0.015, 'source ground ray height=' + physics.groundAt(feet));
    physics.place(feet);
    for (let i = 0; i < 240; i++) physics.move(new THREE.Vector3(-3.35 / 60, -0.001, 0), 1 / 60, feet);
    assert.ok(Math.abs(feet.y + 0.355) < 0.035, 'walking on the source ground must not fall through');
    assert.ok(feet.x > -13.76 && feet.x < -13.6, 'the physical west perimeter must stop the walking player');
  } finally {
    physics.dispose();
    shell.traverse((object) => { if (object.isMesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } });
  }
});
