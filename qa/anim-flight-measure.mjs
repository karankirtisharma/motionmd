// Exact flight geometry for position-locked stepping: riser positions, tread heights, extents.
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { createStairSurfaces } from '../src/runtime/interaction/StairSurfaces.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const scene = new THREE.Scene();
for (const id of ['v13', 'v18', 'v19', 'entrance', 'shell']) scene.add((await geometryFixture(manifest.chunks.find(c => c.id === id).url)).root);
const sample = createStairSurfaces(scene, 'stair-candidates');
const p = new THREE.Vector3();
// Highest stair surface at (x, z) below `ceiling`.
const top = (x, z, ceiling) => { p.set(x, ceiling, z); const out = new Float64Array(1); sample.heights([p], 1, -1, ceiling, out); return out[0]; };
// --- spiral: centre, angle convention as the controller's prepared route: x = cx + r cos a, z = -(cz + r sin a)
const C = [18.76, 20.2];
const at = (r, deg) => [C[0] + r * Math.cos(deg * Math.PI / 180), -(C[1] + r * Math.sin(deg * Math.PI / 180))];
let last, risers = [];
for (let deg = 80; deg >= -280; deg -= .02) {
  const [x, z] = at(1.55, deg), h = top(x, z, 4.5);
  if (!(h === h)) { last = undefined; continue; }
  if (last !== undefined && Math.abs(h - last.h) > .05) risers.push({ deg: +((deg + last.deg) / 2).toFixed(2), from: +last.h.toFixed(4), to: +h.toFixed(4) });
  last = { deg, h };
}
console.log('spiral risers (deg, from, to):', risers.length); console.log(risers.map(r => `${r.deg}:${r.from}>${r.to}`).join(' '));
const steps = risers.slice(1).map((r, i) => risers[i].deg - r.deg);
console.log('angular going (deg) mean', (steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(3), 'min', Math.min(...steps).toFixed(2), 'max', Math.max(...steps).toFixed(2));
// radial extent of a mid-flight tread
const mid = (risers[10].deg + risers[11].deg) / 2; let inner, outer;
for (let r = .05; r < 3; r += .005) { const [x, z] = at(r, mid); const h = top(x, z, risers[10].to + .3); if (h === h && Math.abs(h - risers[10].to) < .02) { inner ??= r; outer = r; } }
console.log(`tread at ${mid.toFixed(1)} deg spans radius ${inner?.toFixed(3)}..${outer?.toFixed(3)} m at height ${risers[10].to}`);
// --- straight flights: scan along x at several z
function straight(name, z0s, x0, x1, ceiling) {
  for (const z of z0s) {
    let lastH, list = [], first, lastX;
    for (let x = x0; x0 < x1 ? x <= x1 : x >= x1; x += (x0 < x1 ? .002 : -.002)) {
      const h = top(x, z, ceiling); if (!(h === h)) continue;
      first ??= x; lastX = x;
      if (lastH !== undefined && Math.abs(h - lastH) > .05) list.push(`${x.toFixed(3)}:${lastH.toFixed(3)}>${h.toFixed(3)}`);
      lastH = h;
    }
    console.log(`${name} z=${z.toFixed(2)} surface x ${first?.toFixed(2)}..${lastX?.toFixed(2)} risers ${list.join(' ')}`);
  }
}
straight('rounded', [-24.4, -24, -23.6, -23, -22.4, -22, -21.6], 9.5, 4, 4.5);
straight('entrance', [-19.5, -18.5, -17.1, -15.7, -14.7], -9, -3, .5);
// z extent of the stone steps
for (const [name, x, ceiling, h0] of [['rounded step 1', 7.0, 4.5, 0], ['entrance step 1', -6.2, .5, 0]]) {
  const hs = []; for (let z = -27; z < -12; z += .02) { const h = top(x, z, ceiling); hs.push([z, h]); }
  const runs = []; let cur;
  for (const [z, h] of hs) { const k = h === h ? h.toFixed(2) : 'none'; if (!cur || cur.k !== k) { cur = { k, from: z, to: z }; runs.push(cur); } else cur.to = z; }
  console.log(name, 'x', x, runs.filter(r => r.to - r.from > .05).map(r => `${r.k}@z${r.from.toFixed(2)}..${r.to.toFixed(2)}`).join(' '));
}
