import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const root = new T.Group();
for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
  const b = fs.readFileSync('public' + url);
  root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene);
}
const p = await createCollisionWorld(root, undefined, root);
const inventory = JSON.parse(fs.readFileSync('qa/experience-v12/source-inventory.json'));
const results = [];
for (const item of inventory) {
  const { name, min, max } = item;
  if (!/wall|pane|glass|guard|pier|closure/i.test(name) || /LF102|inlay|seam|gasket|edge|light|shoe|bowl|sliding|seal|bead|bolt|bracket|fasten|screen|lens|monitor|joint|shadow|trim|batten|reveal|digital/i.test(name)) continue;
  const size = max.map((v, i) => v - min[i]), axis = size[0] < size[2] ? 0 : 2;
  if (size[axis] > .65 || size[1] < .55 || size[2 - axis] < .5) continue;
  const center = min.map((v, i) => (v + max[i]) / 2);
  const probes = [];
  for (const along of [.2, .5, .8]) for (const sign of [-1, 1]) {
    const start = [...center]; start[1] = min[1] + .03;
    start[2 - axis] = T.MathUtils.lerp(min[2 - axis], max[2 - axis], along);
    start[axis] = center[axis] - sign * (size[axis] / 2 + .45);
    const feet = new T.Vector3(...start);
    if (!p.canStandAt(feet)) continue;
    p.place(feet);
    const delta = new T.Vector3(); delta.setComponent(axis, sign * 3.35 / 60);
    for (let i = 0; i < 36; i++) p.move(delta, 1 / 60, feet);
    probes.push({ along, sign, start, end: feet.toArray(), blocked: sign * (feet.getComponent(axis) - center[axis]) < 0 });
  }
  if (probes.length) results.push({ name, covered: item.covered, probes, pass: probes.every(v => v.blocked) });
}
p.dispose();
fs.writeFileSync(process.argv[2] ?? 'qa/experience-v12/panels.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ tested: results.length, failures: results.filter(v => !v.pass).map(v => ({name:v.name, covered:v.covered, failed:v.probes.filter(p=>!p.blocked).length})) }, null, 2));
