import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
async function fixture() { const root = new THREE.Group(); for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
    const b = fs.readFileSync(new URL('../public' + url, import.meta.url));
    root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene);
} const ground = new THREE.Mesh(new THREE.BoxGeometry(120, .1, 120)); ground.position.set(0, -.405, 0); root.add(ground); return createCollisionWorld(root, undefined, root); }
test('all six desks, monitors and limestone piers stop the full capsule', async (t) => {
    const p = await fixture();
    try {
        for (const [x, z] of [[8, -34.2], [12, -31.6], [15.2, -33.25], [18.2, -30.7], [11, -25.7], [14.3, -25.7]])
            assert.equal(p.canStandAt(new THREE.Vector3(x, p.groundAt(new THREE.Vector3(x, 0, z)), z)), false, `desk ${x},${z} must block torso`);
        const names = [...p.colliderNames.values()];
        assert.equal(names.filter(n => n.includes('continuous curved aluminium display housing')).length, 18);
        for (const [x, z, dx, dz] of [[6.5, -34.2, 1, 0], [8.5, -31.6, 1, 0], [16, -30.7, 1, 0], [9, -25.7, 1, 0], [12.95, -25.7, 1, 0]]) {
            const feet = new THREE.Vector3(x, 0, z);
            feet.y = p.groundAt(feet);
            p.place(feet);
            for (let i = 0; i < 150; i++)
                p.move(new THREE.Vector3(dx * 3.35 / 60, -.5 / 60, dz * 3.35 / 60), 1 / 60, feet);
            assert.ok(feet.x < x + 2.3, `sprinting must stop at furniture: ${feet.toArray()}`);
            assert.ok(feet.y < .30, `must not auto-step onto a desktop (${x},${z}): ${feet.toArray()}`);
        }
        assert.equal(p.canStandAt(new THREE.Vector3(18.43, 0, -33.13)), false, 'structural pier remains solid after desk moved');
        assert.ok(p.canStandAt(new THREE.Vector3(18.2, .03, -32.65)), 'old tabletop area ahead of column is now clear');
    }
    finally {
        p.dispose();
    }
});
test('source terrace, both entrance steps, threshold and interior agree with the visible surfaces', async (t) => {
    const p = await fixture();
    try {
        for (const [x, y] of [[-7, -.355], [-6.325, -.18], [-5.975, -.01], [-4, -.01], [-2.2, .016], [-1, 0]])
            assert.ok(Math.abs(p.groundAt(new THREE.Vector3(x, y, -17.1)) - y) < .006, `support at x=${x}`);
        const results = [];
        for (const speed of [1.38, 3.35])
            for (const direction of [1, -1]) {
                const feet = new THREE.Vector3(direction > 0 ? -8 : -.5, direction > 0 ? -.355 : 0, -17.1);
                p.place(feet);
                let grounded = false, v = 0, min = Infinity, max = -Infinity;
                for (let i = 0; i < Math.ceil(8 / speed * 60); i++) {
                    v = grounded ? -.5 : Math.max(-16, v - 9.81 / 60);
                    grounded = p.move(new THREE.Vector3(direction * speed / 60, v / 60, 0), 1 / 60, feet);
                    min = Math.min(min, feet.y);
                    max = Math.max(max, feet.y);
                }
                assert.ok(direction > 0 ? feet.x > -.8 : feet.x < -7.5, `route must finish ${speed} ${direction}: ${feet.toArray()}`);
                assert.ok(Math.abs(feet.y - (direction > 0 ? 0 : -.355)) < .035, 'feet finish on the visible ground');
                assert.ok(min > -.39 && max < .05, 'no penetration or floating on transition');
                results.push({ speed, direction, end: feet.toArray(), grounded });
            }
        t.diagnostic(JSON.stringify(results));
    }
    finally {
        p.dispose();
    }
});
