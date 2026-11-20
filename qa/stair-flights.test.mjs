// The flight model must agree with the rendered treads: at every tread centre of every flight, the tread top
// predicted by the model (base + riser * k) is the surface StairSurfaces finds there, within 5 mm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { createStairSurfaces } from '../src/runtime/interaction/StairSurfaces.ts';
import { locateFlight } from '../src/runtime/interaction/stairFlights.ts';
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
