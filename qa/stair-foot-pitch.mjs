// Foot pitch through the baked stair strides: the heel-to-toe joint line against the same line when the foot stands
// flat (degrees; negative = toe pointing down), with the foot's height over its lowest. Flags the steepest toe-down
// angle while the foot is off the ground.   node qa/stair-foot-pitch.mjs [clips.json] [flight]
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';

const file = process.argv[2] ?? new URL('../public/assets/character/locomotion-v16.json', import.meta.url);
const only = process.argv[3] ?? 'gallery';
const data = JSON.parse(fs.readFileSync(file));
const gltf = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf, model = gltf.scene;
const rest = new Map(); model.traverse(o => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
const bone = n => model.getObjectByName(n), w = n => bone(n).getWorldPosition(new THREE.Vector3());
const decode = s => { const x = Buffer.from(s, 'base64'); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); };
const mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).play(); mixer.update(0); model.updateMatrixWorld(true);
const pitchOf = s => { const h = w(`Bip01_${s}_Foot`), t = w(`Bip01_${s}_Toe0`); return Math.atan2(t.y - h.y, Math.hypot(t.x - h.x, t.z - h.z)) * 180 / Math.PI; };
// Flat: each foot as it stands in his Idle pose.
const standing = { L: pitchOf('L'), R: pitchOf('R') }; mixer.stopAllAction(); mixer.uncacheRoot(model);
for (const clip of data.clips.filter(c => c.kind === 'flat' && c.name === 'walk' || c.kind === 'stairs' && c.flight === only)) {
  const q = new Int16Array(decode(clip.rotations)), p = new Float32Array(decode(clip.pelvis)), n = data.bones.length, rows = [];
  for (let k = 0; k < data.frames; k++) {
    for (const [o, [pp, qq, ss]] of rest) { o.position.copy(pp); o.quaternion.copy(qq); o.scale.copy(ss); }
    data.bones.forEach((name, i) => bone(name).quaternion.set(q[(k * n + i) * 4] / 32767, q[(k * n + i) * 4 + 1] / 32767, q[(k * n + i) * 4 + 2] / 32767, q[(k * n + i) * 4 + 3] / 32767).normalize());
    bone('Bip01_Pelvis').position.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    model.updateMatrixWorld(true);
    rows.push({ k, L: { pitch: pitchOf('L'), y: Math.min(w('Bip01_L_Foot').y, w('Bip01_L_Toe0').y) }, R: { pitch: pitchOf('R'), y: Math.min(w('Bip01_R_Foot').y, w('Bip01_R_Toe0').y) } });
  }
  console.log(`\n${clip.name} ${clip.flight ?? 'floor'}${clip.radius ? ' r' + clip.radius : ''}`);
  for (const s of ['L', 'R']) {
    // Flat: the pitch where the foot is lowest relative to the stride's own ground (planted, heel and toe down).
    const ground = k => clip.kind === 'stairs' ? rows[k][s].y - (clip.direction > 0 ? 1 : -1) * clip.riser * 2 * (k / data.frames) : rows[k][s].y;
    const lows = rows.map((r, k) => ({ k, g: ground(k) })), floor = Math.min(...lows.map(x => x.g));
    const planted = new Set(lows.filter(x => x.g < floor + .025).map(x => x.k));
    const flat = standing[s];
    const rel = rows.map(r => r[s].pitch - flat);
    const air = rows.filter(r => !planted.has(r.k));
    const worst = air.reduce((m, r) => (r[s].pitch - flat) < (m[s].pitch - flat) ? r : m, air[0]);
    console.log(`  ${s}: toe-down in the air down to ${(worst[s].pitch - flat).toFixed(0)} deg at frame ${worst.k}; toe-up up to ${Math.max(...air.map(r => r[s].pitch - flat)).toFixed(0)} deg`);
    console.log('     ' + rel.map((v, k) => (planted.has(k) ? '_' : '') + v.toFixed(0)).filter((_, k) => k % 2 === 0).join(' '));
    const lift = rows.map((r, k) => ground(k) - floor);
    console.log('     height cm: ' + lift.map(v => (v * 100).toFixed(0)).filter((_, k) => k % 2 === 0).join(' '));
  }
}
