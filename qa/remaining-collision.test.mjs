import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const records = JSON.parse(fs.readFileSync(new URL('../public/assets/experience-v12/coverage.json', import.meta.url))).objects;
async function fixture() {
  const root = new T.Group();
  for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
    const b = fs.readFileSync(new URL('../public' + url, import.meta.url));
    root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene);
  }
  return createCollisionWorld(root, undefined, root);
}

test('retained balcony/return panes stop walking and sprinting from both sides', async context => {
  const p = await fixture(); let checked = 0;
  try {
    // Two pier-return panes disappeared with their piers in the approved source.
    // Their replacement perimeter and shortcut-closure guards have separate traversal tests.
    // V21 opens the presentation portal; its retired door must not leave a ghost collider.
    // The widened opening has bidirectional traversal coverage in gallery-mirror.test.mjs.
    const retiredDoor = 'FR40 parked gallery glass leaf';
    assert.ok(manifest.architectureV21.removed.includes(retiredDoor));
    assert.ok(![...p.colliderNames.values()].includes(retiredDoor));
    const panes = records.filter(r => /glass/.test(r.sourceName)
      && !r.sourceName.startsWith('MF36 gallery guard pier return glass') && r.sourceName !== retiredDoor);
    assert.equal(panes.length, 3);
    for (const { sourceName, min, max } of panes) {
      const size = max.map((v, i) => v - min[i]), axis = size[0] < size[2] ? 0 : 2;
      const center = min.map((v, i) => (v + max[i]) / 2);
      let count = 0;
      for (const speed of [1.38, 3.35]) for (const along of [.2, .5, .8]) for (const sign of [-1, 1]) {
        const start = [...center]; start[1] = min[1] + .03;
        start[2 - axis] = T.MathUtils.lerp(min[2 - axis], max[2 - axis], along);
        start[axis] = center[axis] - sign * (size[axis] / 2 + .45);
        const feet = new T.Vector3(...start);
        if (!p.canStandAt(feet)) continue; // A neighboring pier can already occupy this approach.
        p.place(feet);
        const delta = new T.Vector3().setComponent(axis, sign * speed / 60);
        for (let i = 0; i < 120; i++) {
          p.move(delta, 1 / 60, feet);
          assert.ok(sign * (feet.getComponent(axis) - center[axis]) < 0, sourceName + ' crossed');
          assert.ok(p.canStandAt(feet), sourceName + ' body penetration');
        }
        checked++; count++;
      }
      assert.ok(count >= 2, sourceName + ' must have tested clear approaches');
    }
    context.diagnostic(`Checked ${checked} full-body approaches at walk/run speed.`);
  } finally { p.dispose(); }
});

test('source rocks, furniture cores and pedestals block the body without room-sized proxy boxes', async context => {
  const p = await fixture(); let checked = 0;
  try {
    for (const { sourceName, shape, min, max } of records) {
      if (shape !== 'convexHull' || /glass/.test(sourceName) || max[1] - min[1] < .3) continue;
      // The approved D: source retired the separate rear desk and its three pedestals.
      if (/^MF33 rear table bronze pedestal(?:\.00[12])?$/.test(sourceName)) {
        assert.ok(manifest.architectureV13.retiredSourceNames.includes(sourceName), 'source must explicitly retire this pedestal');
        assert.ok(![...p.colliderNames.values()].includes(sourceName), 'retired pedestal must not leave a ghost collider');
        continue;
      }
      const feet = new T.Vector3((min[0] + max[0]) / 2, min[1] + .02, (min[2] + max[2]) / 2);
      assert.equal(p.canStandAt(feet), false, sourceName + ' must be a solid');
      checked++;
    }
    assert.ok(checked >= 10);
    context.diagnostic(`Verified ${checked} source solids, in addition to existing traversal tests.`);
  } finally { p.dispose(); }
});

test('balcony inspection points have walkable ground and clear body space', async () => {
  const p = await fixture();
  try {
    for (const point of [[11,4.23,-10.25], [8.14,3.675,-24.63]]) {
      const feet = new T.Vector3(...point);
      const ground = p.groundAt(feet, 1);
      assert.ok(Math.abs(ground-feet.y)<.05, 'inspection point must be on the gallery: '+ground);
      feet.y = ground + .002;
      assert.ok(p.canStandAt(feet), 'inspection must start clear of solid geometry: '+feet.toArray());
    }
  } finally { p.dispose(); }
});
