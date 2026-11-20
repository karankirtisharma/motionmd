// Where the collision speed limiter (CollisionWorld.speedForClearance) slows the visitor down for nothing he would
// touch, on the real collision geometry. Around each inspection spot: a grid of standing points and 16 headings; at
// each, the limiter's share of walking (1.5 m/s) and sprint (3 m/s) speed, and how far his own body can actually walk
// that way (the controller's move, up to 1 m). "Needless" = slowed below 90% with a free metre ahead.
// node qa/clearance-slowdown.mjs
import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

const m = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const root = new T.Group();
for (const u of [m.collisions.url, ...m.collisions.additionalUrls]) { const b = fs.readFileSync(new URL('../public' + u, import.meta.url)); root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene); }
const physics = await createCollisionWorld(root, undefined, root);
const SPOTS = { entrance: [-8, -.355, -17.1], bridge: [-1.3, 4.2, -17], gallery: [12, 3.675, -24.05], 'gallery steps': [8.3, 3.675, -23],
  'gallery return': [8.14, 3.675, -24.48], 'founder room': [16, 4.23, -8.7], 'founder balcony': [11, 4.23, -10.25], studio: [16.4, .03, -30.7],
  'spiral foot': [20.31, .03, -20.2], 'hall doorway': [19.9625, .03, -10.1] };
const freeWalk = (start, dir) => {
  const feet = start.clone(); physics.place(feet);
  for (let i = 0; i < 20; i++) physics.move(dir.clone().multiplyScalar(.05).setY(-.01), 1 / 60, feet);
  return Math.hypot(feet.x - start.x, feet.z - start.z);
};
console.log('spot'.padEnd(16), 'samples', 'needless walk', 'needless sprint', 'worst (share of speed, point, heading)');
let totalNeedless = 0;
for (const [name, [x0, y0, z0]] of Object.entries(SPOTS)) {
  let samples = 0, walk = 0, sprint = 0, worst = { r: 1 };
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const p = new T.Vector3(x0 + i * .4, y0 + .3, z0 + j * .4); p.y = physics.groundAt(p, 1.2);
    if (Math.abs(p.y - y0) > .5 || !physics.canStandAt(p)) continue;
    for (let h = 0; h < 16; h++) {
      const a = h / 16 * Math.PI * 2, dir = new T.Vector3(Math.sin(a), 0, Math.cos(a));
      physics.place(p.clone());
      const rw = physics.speedForClearance(dir, 1.5) / 1.5, rs = physics.speedForClearance(dir, 3) / 3;
      samples++;
      if (rw > .9 && rs > .9) continue;
      if (freeWalk(p, dir) < .98) continue;   // something he would actually walk into
      if (rw < .9) walk++; if (rs < .9) sprint++;
      if (rs < worst.r) worst = { r: rs, at: `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) heading ${(a * 180 / Math.PI).toFixed(0)}` };
    }
  }
  totalNeedless += walk + sprint;
  console.log(name.padEnd(16), String(samples).padStart(7), `${(walk / Math.max(1, samples) * 100).toFixed(1)}%`.padStart(13), `${(sprint / Math.max(1, samples) * 100).toFixed(1)}%`.padStart(15), worst.at ? `${(worst.r * 100).toFixed(0)}% ${worst.at}` : '-');
}
console.log('needless slowdowns in all:', totalNeedless);
physics.dispose();
