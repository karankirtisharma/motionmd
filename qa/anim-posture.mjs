// Upper-body posture of the visitor: his own Idle against a baked walk/run (locomotion-v3.json).
// Shoulder height above the chest, how far back the shoulders sit, upper-arm hang, torso lean, head pitch,
// pelvis bob and arm swing over a cycle.  node qa/anim-posture.mjs [data.json]
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';

const file = process.argv[2] ?? new URL('../public/assets/character/locomotion-v3.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(file));
const gltf = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf, model = gltf.scene;
const rest = new Map(); model.traverse(o => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
const mixer = new THREE.AnimationMixer(model), idle = mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).play();
mixer.update(0); model.updateMatrixWorld(true);
let b = new THREE.Box3().setFromObject(model); model.scale.multiplyScalar(1.86 / (b.max.y - b.min.y)); model.updateMatrixWorld(true);
b.setFromObject(model); model.position.y -= b.min.y; model.updateMatrixWorld(true);
const bone = n => model.getObjectByName(n), w = n => bone(n).getWorldPosition(new THREE.Vector3());
const measure = () => {
  model.updateMatrixWorld(true);
  const chest = w('Bip01_Spine2'), neck = w('Bip01_Neck'), head = w('Bip01_Head'), pelvis = w('Bip01_Pelvis');
  const out = {};
  for (const s of ['L', 'R']) {
    const shoulder = w(`Bip01_${s}_UpperArm`), elbow = w(`Bip01_${s}_Forearm`);
    out[s] = { up: shoulder.y - chest.y, back: shoulder.z - chest.z, hang: Math.acos(Math.max(-1, Math.min(1, elbow.clone().sub(shoulder).normalize().dot(new THREE.Vector3(0, -1, 0))))) * 180 / Math.PI, swing: elbow.z - shoulder.z };
  }
  const lean = Math.atan2(neck.z - pelvis.z, neck.y - pelvis.y) * 180 / Math.PI;
  const q = bone('Bip01_Head').getWorldQuaternion(new THREE.Quaternion()), fwd = new THREE.Vector3(0, 0, 1);
  const eye = w('Bip01_LEye').sub(head), pitch = Math.atan2(eye.y, Math.hypot(eye.x, eye.z)) * 180 / Math.PI;
  return { shoulderUp: (out.L.up + out.R.up) / 2, shoulderBack: (out.L.back + out.R.back) / 2, armHang: (out.L.hang + out.R.hang) / 2, swingL: out.L.swing, lean, headPitch: pitch, pelvisY: pelvis.y };
};
const f = x => x.toFixed(3);
const idlePose = measure();
console.log('Idle      shoulder above chest', f(idlePose.shoulderUp), 'back of chest', f(idlePose.shoulderBack), 'arm hang', idlePose.armHang.toFixed(1), 'deg  lean', idlePose.lean.toFixed(1), 'head pitch', idlePose.headPitch.toFixed(1));
mixer.stopAllAction(); mixer.uncacheRoot(model);
const decode = s => { const x = Buffer.from(s, 'base64'); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); };
for (const clip of data.clips.filter(c => c.kind === 'flat' || (c.flight === 'gallery'))) {
  const q = new Int16Array(decode(clip.rotations)), p = new Float32Array(decode(clip.pelvis)), n = data.bones.length, rows = [];
  for (let k = 0; k < data.frames; k++) {
    for (const [o, [pp, qq, ss]] of rest) { o.position.copy(pp); o.quaternion.copy(qq); o.scale.copy(ss); }
    data.bones.forEach((name, i) => bone(name).quaternion.set(q[(k * n + i) * 4] / 32767, q[(k * n + i) * 4 + 1] / 32767, q[(k * n + i) * 4 + 2] / 32767, q[(k * n + i) * 4 + 3] / 32767).normalize());
    bone('Bip01_Pelvis').position.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    rows.push(measure());
  }
  const avg = key => rows.reduce((a, r) => a + r[key], 0) / rows.length, range = key => Math.max(...rows.map(r => r[key])) - Math.min(...rows.map(r => r[key]));
  console.log(`${(clip.name + ' ' + (clip.flight ?? '')).padEnd(18)} shoulder above chest ${f(avg('shoulderUp'))} (${(avg('shoulderUp') - idlePose.shoulderUp >= 0 ? '+' : '')}${((avg('shoulderUp') - idlePose.shoulderUp) * 100).toFixed(1)} cm vs idle)  back ${f(avg('shoulderBack'))} (${((avg('shoulderBack') - idlePose.shoulderBack) * 100).toFixed(1)} cm)  arm hang ${avg('armHang').toFixed(1)} deg  lean ${avg('lean').toFixed(1)}  head ${avg('headPitch').toFixed(1)}  pelvis bob ${(range('pelvisY') * 100).toFixed(1)} cm  arm swing ${(range('swingL') * 100).toFixed(1)} cm`);
}
