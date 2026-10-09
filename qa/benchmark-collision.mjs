import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const root = new THREE.Group();
for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
    const b = fs.readFileSync(new URL('../public' + url, import.meta.url));
    root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene);
}
const start = performance.now();
const physics = await createCollisionWorld(root, undefined, root);
const initMs = performance.now() - start;
const samples = [];
const feet = new THREE.Vector3();
const move = new THREE.Vector3();
for (let trial = 0; trial < 6; trial++) {
    feet.set(16, 0, -30);
    physics.place(feet);
    const t = performance.now();
    for (let i = 0; i < 1200; i++)
        physics.move(move.set((i % 240 < 120 ? 1 : -1) * 1.38 / 60, -.5 / 60, 0), 1 / 60, feet);
    if (trial)
        samples.push((performance.now() - t) / 1200);
}
// The legacy deskBlocks sample also overlaps a pier; use scene-repair.test.mjs for furniture coverage.
const report = { initMs, meshCount: physics.meshCount, triangleCount: physics.triangleCount, meanMoveMilliseconds: samples.reduce((a, b) => a + b) / samples.length, trials: samples, ground: { terrace: physics.groundAt(new THREE.Vector3(-4, 0, -17.1)), vestibule: physics.groundAt(new THREE.Vector3(-1, 0, -17.1)) }, deskBlocks: physics.canStandAt(new THREE.Vector3(18.2, 0, -33.05)) === false };
physics.dispose();
console.log(JSON.stringify(report, null, 2));
if (process.argv[2])
    fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
