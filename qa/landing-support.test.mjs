import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

test('placement stays on the rounded landing at float-sensitive triangle seams', async () => {
  const data = fs.readFileSync(new URL('../public/assets/architecture-v18/collision/v18-collision.glb', import.meta.url));
  const root = (await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
  const physics = await createCollisionWorld(root, undefined, root);
  try {
    // The original centre-only ray returned the 3.355 m underside here.
    for (const x of [8.15198204263722, 8.20198204263722]) {
      for (const z of [-22.3, -22.300001, -22.299999, -22.3001]) {
        const feet = new THREE.Vector3(x, 3.675, z);
        assert.ok(Math.abs(physics.groundAt(feet) - 3.675) < 0.001, `Floor support at ${x}, ${z}`);
        assert.ok(physics.canStandAt(feet), 'Placement must not start inside the slab');
      }
    }
    assert.equal(physics.groundAt(new THREE.Vector3(99, 2, 99)), 2, 'No support keeps the supplied height');
  } finally { physics.dispose(); }
});
