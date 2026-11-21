// The flight model must agree with the rendered treads: at every tread centre of every flight, the tread top
// predicted by the model (base + riser * k) is the surface StairSurfaces finds there, within 5 mm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { createStairSurfaces } from '../src/runtime/interaction/StairSurfaces.ts';
import { flightTrail, locateFlight } from '../src/runtime/interaction/stairFlights.ts';
test('flight model matches the rendered treads of all three flights', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
  const scene = new THREE.Scene();
  for (const id of ['v13', 'v18', 'v19', 'entrance', 'shell']) scene.add((await geometryFixture(manifest.chunks.find(c => c.id === id).url)).root);
  const sample = createStairSurfaces(scene, 'stair-candidates'), out = new Float64Array(1), p = new THREE.Vector3();
  const surface = (x, z, y) => { p.set(x, y + .3, z); sample.heights([p], 1, y - .3, y + .3, out); return out[0]; };
  const checks = [];
  // Spiral at three radii: tread k centre at angle firstRiser - step * (k - 0.5).
  for (const r of [1.0, 1.45, 2.0]) for (let k = 1; k <= 23; k++) {
    const a = (59.995 - 13.695 * (k - .5)) * Math.PI / 180, x = 18.76 + r * Math.cos(a), z = -(20.2 + r * Math.sin(a));
    const hit = locateFlight(x, .152917 * k, z); assert.ok(hit && hit.id === 'spiral', `spiral r ${r} tread ${k} located`);
    assert.ok(Math.abs(hit.u - (k - .5)) < 1e-3, `spiral tread ${k} coordinate ${hit.u}`);
    checks.push([`spiral r${r} t${k}`, surface(x, z, hit.line(hit.u)), hit.line(hit.u)]);
  }
  // Gallery: tread k centre at radius firstRadius - going * (k - 0.5), along the arc through z = -23.
  for (let k = 1; k <= 2; k++) {
    const radius = 14.392 - .29 * (k - .5), dz = -23 + 19.622, x = -6.489 + Math.sqrt(radius * radius - dz * dz);
    const hit = locateFlight(x, 3.675 + .175 * k, -23); assert.ok(hit && hit.id === 'gallery', `gallery tread ${k} located`);
    checks.push([`gallery t${k}`, surface(x, -23, hit.line(hit.u)), hit.line(hit.u)]);
  }
  { const x = -6.49 + .341 * .5, hit = locateFlight(x, -.18, -17.1); assert.ok(hit && hit.id === 'entrance'); checks.push(['entrance t1', surface(x, -17.1, hit.line(hit.u)), hit.line(hit.u)]); }
  const worst = checks.reduce((w, c) => Math.abs(c[1] - c[2]) > Math.abs(w[1] - w[2]) ? c : w);
  for (const [name, found, predicted] of checks) assert.ok(Math.abs(found - predicted) < .005, `${name}: surface ${found} vs model ${predicted}`);
  console.log(`checked ${checks.length} tread centres, worst ${worst[0]} ${(Math.abs(worst[1] - worst[2]) * 1000).toFixed(1)} mm`);
});

test('where a visitor belongs across each flight: the spiral middle trail, anywhere on the wide gallery and entrance steps clear of their ends', () => {
  // Spiral: the 1.45 m circle about the column (18.76, -20.2), half-way across the treads.
  const spiralAt = (r, a) => ({ x: 18.76 + r * Math.cos(a), z: -20.2 + r * Math.sin(a) });
  for (const r of [1.1, 1.45, 2.0]) {
    const p = spiralAt(r, 0), hit = locateFlight(p.x, .75, p.z, 30);   // about the fifth tread
    assert.equal(hit?.id, 'spiral');
    const t = flightTrail(hit, p.x, p.z);
    assert.ok(Math.abs(t.offset - (r - 1.45)) < 1e-9, `spiral ${r}: ${t.offset}`);
    // Moving against the offset along the returned direction reaches the trail.
    const back = { x: p.x - t.x * t.offset, z: p.z - t.z * t.offset };
    assert.ok(Math.abs(flightTrail(hit, back.x, back.z).offset) < 1e-6);
  }
  // Gallery steps (z -24.55..-15.9) and the entrance step (z -19.2..-15.0): no pull anywhere 0.4 m clear of their
  // ends; past that, the distance back inside, along z.
  const g = locateFlight(7.47, 3.8, -23.0, 2);
  assert.equal(g?.id, 'gallery');
  for (const z of [-24.1, -23, -20, -17, -16.3]) assert.equal(flightTrail(g, 7.4, z).offset, 0, `gallery z ${z}`);
  assert.ok(Math.abs(flightTrail(g, 7.4, -24.3).offset + .15) < 1e-9 && Math.abs(flightTrail(g, 7.7, -16.0).offset - .3) < 1e-9);
  assert.equal(flightTrail(g, 7.4, -24.3).z, 1);
  const e = locateFlight(-6.3, -.2, -16.1, 2);
  assert.equal(e?.id, 'entrance');
  assert.equal(flightTrail(e, -6.3, -16.1).offset, 0);
  assert.ok(Math.abs(flightTrail(e, -6.3, -15.2).offset - .2) < 1e-9);
});

test('the gallery steps are recognised along their whole width, round to the straight risers at their end', () => {
  // Measured riser 1 (qa/stair-play-audit.mjs survey): concentric to z -17.5, then x = 7.75 to the rounded end.
  for (const [x, z] of [[7.05, -24.5], [7.90, -19.5], [7.80, -18.0], [7.75, -17.0], [7.77, -16.0]]) {
    const hit = locateFlight(x, 3.7, z, .5);
    assert.equal(hit?.id, 'gallery', `riser 1 at (${x}, ${z})`);
    assert.ok(Math.abs(hit.u) < .12, `u at riser 1 (${x}, ${z}): ${hit.u}`);
  }
  // Uphill turns smoothly from radial to -x across the bend, never by more than a few degrees per 10 cm.
  let previous;
  for (let z = -18.2; z <= -16.8; z += .1) {
    const hit = locateFlight(7.6, 3.9, z, .5), angle = Math.atan2(hit.uphillZ, hit.uphillX);
    if (previous !== undefined) assert.ok(Math.abs(angle - previous) < .06, `uphill jumps at z ${z.toFixed(1)}`);
    previous = angle;
  }
  assert.equal(locateFlight(7.6, 3.9, -15.7, .5), undefined, 'past the rounded end');
});
