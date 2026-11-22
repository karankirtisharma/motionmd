// Motion analysis of source locomotion clips (Mixamo FBX), sampled at 240 Hz with root motion:
// foot contacts (where and when each foot is planted), step length, step rise, cadence, speed.
//   node qa/anim-clip-analysis.mjs <file.fbx>...
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
globalThis.window ??= globalThis; globalThis.self ??= globalThis;
const HZ = 240;
for (const file of process.argv.slice(2)) {
  const buffer = fs.readFileSync(file);
  const root = new FBXLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length), '');
  const clip = root.animations[0], mixer = new THREE.AnimationMixer(root), action = mixer.clipAction(clip).play();
  const bone = name => { let found; root.traverse(o => { if (o.isBone && o.name === 'mixamorig' + name) found = o; }); return found; };
  const parts = { hips: bone('Hips'), lf: bone('LeftFoot'), lt: bone('LeftToeBase'), rf: bone('RightFoot'), rt: bone('RightToeBase') };
  const frames = Math.round(clip.duration * HZ), v = new THREE.Vector3(), samples = [];
  for (let i = 0; i <= frames; i++) {
    action.time = i / HZ * clip.duration * HZ / frames; mixer.update(0); root.updateMatrixWorld(true);
    const s = { t: action.time };
    for (const [k, b] of Object.entries(parts)) s[k] = b.getWorldPosition(v).clone().multiplyScalar(.01); // metres
    samples.push(s);
  }
  // A foot is planted while the lower of its heel/toe points barely moves (< 0.25 m/s) for at least 60 ms.
  const contacts = { left: [], right: [] };
  for (const [side, f, t] of [['left', 'lf', 'lt'], ['right', 'rf', 'rt']]) {
    let run = [];
    const flush = () => { if (run.length >= .06 * HZ) { const mid = run[Math.floor(run.length / 2)]; contacts[side].push({ from: run[0].t, to: run.at(-1).t, heel: mid[f].toArray().map(x => +x.toFixed(3)), toe: mid[t].toArray().map(x => +x.toFixed(3)) }); } run = []; };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i], dt = b.t - a.t;
      const speed = Math.min(b[f].distanceTo(a[f]), b[t].distanceTo(a[t])) / dt;
      if (speed < .25) run.push(b); else flush();
    }
    flush();
  }
  const h = samples.map(s => s.hips), travel = h.at(-1).clone().sub(h[0]);
  console.log(`\n== ${file.split(/[\\/]/).pop()}  ${clip.duration.toFixed(3)} s  hips travel fwd ${(travel.z).toFixed(3)} m, up ${(travel.y).toFixed(3)} m, side ${(travel.x).toFixed(3)} m  => ${(travel.z / clip.duration).toFixed(2)} m/s`);
  console.log(`   hips height ${Math.min(...h.map(p => p.y)).toFixed(3)}..${Math.max(...h.map(p => p.y)).toFixed(3)} m (rest 1.043)`);
  for (const side of ['left', 'right']) for (const c of contacts[side])
    console.log(`   ${side.padEnd(5)} planted ${c.from.toFixed(3)}-${c.to.toFixed(3)} s  heel ${JSON.stringify(c.heel)}  toe ${JSON.stringify(c.toe)}`);
  const all = [...contacts.left, ...contacts.right].sort((a, b) => a.heel[2] - b.heel[2]);
  for (let i = 1; i < all.length; i++) console.log(`   step ${i}: forward ${(all[i].heel[2] - all[i - 1].heel[2]).toFixed(3)} m, rise ${(Math.min(all[i].heel[1], all[i].toe[1]) - Math.min(all[i - 1].heel[1], all[i - 1].toe[1])).toFixed(3)} m, width ${Math.abs(all[i].heel[0] - all[i - 1].heel[0]).toFixed(3)} m`);
}
