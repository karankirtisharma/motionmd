// Survey of every staircase from the rendered tread surfaces: number of risers, riser height, going (tread depth
// along the walking line), plan shape, walkable width.   node qa/anim-stair-survey.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { createStairSurfaces } from '../src/runtime/interaction/StairSurfaces.ts';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const scene = new THREE.Scene(), colliders = new THREE.Group();
for (const id of ['v13', 'v18', 'v19', 'entrance', 'shell']) scene.add((await geometryFixture(manifest.chunks.find(c => c.id === id).url)).root);
for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) colliders.add((await geometryFixture(url)).root);
const physics = await createCollisionWorld(scene, undefined, colliders, [], manifest.explorationBounds);
const sample = createStairSurfaces(scene, 'stair-candidates');
const p = new THREE.Vector3();
// Tread top under a point: the highest stair surface within 0.3 m of the expected height.
const top = (x, z, near) => { p.set(x, near, z); return sample(p, near); };
function profile(name, at, length, near0) {
  // Walk the line in 5 mm steps, following the surface; a jump > 6 cm in 5 mm is a riser.
  const steps = Math.round(length / .005), risers = []; let last, near = near0, flatFrom = 0;
  for (let i = 0; i <= steps; i++) {
    const [x, z, s] = at(i / steps); const y = top(x, z, near + .1);
    if (y === undefined) continue;
    if (last !== undefined && Math.abs(y - last.y) > .06) { risers.push({ s, rise: y - last.y, going: s - flatFrom }); flatFrom = s; }
    else if (last === undefined) flatFrom = s;
    last = { y, s }; near = y;
  }
  const inner = risers.slice(1);   // first "going" is the run-up, not a tread
  const avg = k => inner.length ? inner.reduce((a, r) => a + r[k], 0) / inner.length : NaN;
  console.log(`${name.padEnd(28)} risers ${String(risers.length).padStart(2)}  rise ${risers.map(r => (r.rise * 100).toFixed(1)).join(' ')} cm`);
  console.log(`${''.padEnd(28)} going ${inner.map(r => (r.going * 100).toFixed(1)).join(' ')} cm  (mean ${(avg('going') * 100).toFixed(1)})`);
  return risers;
}
// Spiral: centre (18.76, -20.2); angle a in degrees as in the controller's prepared route.
const spiralAt = (r, from, to) => t => { const angle = from + (to - from) * t, a = angle * Math.PI / 180; return [18.76 + r * Math.cos(a), -(20.2 + r * Math.sin(a)), Math.abs(to - from) * Math.PI / 180 * r * t]; };
for (const r of [.7, .9, 1.1, 1.3, 1.55, 1.8]) profile(`spiral r=${r}`, spiralAt(r, 75, -270), 345 * Math.PI / 180 * r, 0);
// Radial extent of the spiral treads at a few angles.
for (const angle of [0, -90, -180]) {
  let inner, outer; const a = angle * Math.PI / 180;
  for (let r = .1; r < 2.6; r += .01) { const y = top(18.76 + r * Math.cos(a), -(20.2 + r * Math.sin(a)), 4.5); if (y !== undefined) { inner ??= r; outer = r; } }
  console.log(`spiral treads at ${angle}°: radius ${inner?.toFixed(2)}..${outer?.toFixed(2)} m`);
}
// Short flights: scan straight lines around the debug routes, and their neighbours to find the step direction.
profile('rounded (route line)', t => [8.3 - 3.15 * t, -23, 3.15 * t], 3.15, 3.7);
for (const dz of [-.6, -.3, .3, .6]) profile(`rounded z=${(-23 + dz).toFixed(1)}`, t => [8.3 - 3.15 * t, -23 + dz, 3.15 * t], 3.15, 3.7);
profile('entrance (route line)', t => [-7.5 + 3.02 * t, -17.1, 3.02 * t], 3.02, -.3);
for (const dz of [-1, 1]) profile(`entrance z=${(-17.1 + dz).toFixed(1)}`, t => [-7.5 + 3.02 * t, -17.1 + dz, 3.02 * t], 3.02, -.3);
// Every stair-candidate surface, grouped: where else are steps?
console.log('stair gate hits on a 0.25 m grid (x, z, height) away from the three known stairs:');
const known = (x, z) => Math.hypot(x - 18.76, z + 20.2) < 2.8 || (x > 4.5 && x < 9 && z > -24.5 && z < -21.5) || (x > -8 && x < -3.5 && z > -19 && z < -15);
const seen = new Map();
for (let x = -14; x < 34; x += .25) for (let z = -50; z < 14; z += .25) for (const level of [0, 3.7, 4.2]) {
  p.set(x, level, z); const y = physics.groundAt(p, 1); p.y = y;
  if (sample.isStair(p, y) && !known(x, z)) { const k = `${Math.round(x)},${Math.round(z)},${y.toFixed(1)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
}
console.log([...seen].slice(0, 30).map(([k, n]) => `${k} (${n})`).join('  ') || 'none');
physics.dispose();
