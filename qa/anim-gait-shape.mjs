// Gait shape of the baked floor walk and run on the visitor (the cues that read as a man's or a woman's gait):
// where each foot lands across the body, how far the hands cross the midline, elbow bend, hip drop and twist,
// shoulder twist, toe-out, knee lift.  node qa/anim-gait-shape.mjs [data.json]
// Body frame: +z forward, +x to his left; lateral positions are from the pelvis centre line, in cm.
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';

const file = process.argv[2] ?? new URL('../public/assets/character/locomotion-v9.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(file));
const gltf = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf, model = gltf.scene;
const rest = new Map(); model.traverse(o => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
const mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).play(); mixer.update(0); model.updateMatrixWorld(true);
let b = new THREE.Box3().setFromObject(model); model.scale.multiplyScalar(1.86 / (b.max.y - b.min.y)); model.updateMatrixWorld(true);
b.setFromObject(model); model.position.y -= b.min.y; model.updateMatrixWorld(true);
mixer.stopAllAction(); mixer.uncacheRoot(model);
const bone = n => model.getObjectByName(n), w = n => bone(n).getWorldPosition(new THREE.Vector3());
const decode = s => { const x = Buffer.from(s, 'base64'); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); };
const deg = r => r * 180 / Math.PI, cm = m => (m * 100).toFixed(1);

for (const clip of data.clips.filter(c => c.kind === 'flat')) {
  const q = new Int16Array(decode(clip.rotations)), p = new Float32Array(decode(clip.pelvis)), n = data.bones.length, rows = [];
  for (let k = 0; k < data.frames; k++) {
    for (const [o, [pp, qq, ss]] of rest) { o.position.copy(pp); o.quaternion.copy(qq); o.scale.copy(ss); }
    data.bones.forEach((name, i) => bone(name).quaternion.set(q[(k * n + i) * 4] / 32767, q[(k * n + i) * 4 + 1] / 32767, q[(k * n + i) * 4 + 2] / 32767, q[(k * n + i) * 4 + 3] / 32767).normalize());
    bone('Bip01_Pelvis').position.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    model.updateMatrixWorld(true);
    const hipL = w('Bip01_L_Thigh'), hipR = w('Bip01_R_Thigh'), mid = hipL.clone().add(hipR).multiplyScalar(.5);
    const shL = w('Bip01_L_UpperArm'), shR = w('Bip01_R_UpperArm');
    const row = { k, mid,
      hipDrop: deg(Math.atan2(hipL.y - hipR.y, hipL.x - hipR.x)), hipTwist: deg(Math.atan2(hipL.z - hipR.z, hipL.x - hipR.x)),
      shoulderTwist: deg(Math.atan2(shL.z - shR.z, shL.x - shR.x)) };
    for (const s of ['L', 'R']) {
      const ankle = w(`Bip01_${s}_Foot`), toe = w(`Bip01_${s}_Toe0`), hand = w(`Bip01_${s}_Hand`), elbow = w(`Bip01_${s}_Forearm`), shoulder = w(`Bip01_${s}_UpperArm`), knee = w(`Bip01_${s}_Calf`), hip = s === 'L' ? hipL : hipR;
      row[s] = { footX: ankle.x - mid.x, footY: Math.min(ankle.y, toe.y), toeOut: deg(Math.atan2(toe.x - ankle.x, toe.z - ankle.z)) * (s === 'L' ? 1 : -1),
        handX: hand.x - mid.x, handZ: hand.z - mid.z,
        elbow: 180 - deg(shoulder.clone().sub(elbow).angleTo(hand.clone().sub(elbow))),
        elbowOut: (elbow.x - shoulder.x) * (s === 'L' ? 1 : -1),
        thighLift: deg(Math.atan2(knee.z - hip.z, hip.y - knee.y)) };
    }
    rows.push(row);
  }
  const range = f => Math.max(...rows.map(f)) - Math.min(...rows.map(f)), mean = f => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  // Stance: the frames where that foot is lowest (within 2 cm of its minimum).
  const stance = s => { const low = Math.min(...rows.map(r => r[s].footY)); return rows.filter(r => r[s].footY < low + .02); };
  const at = (s, key) => { const st = stance(s); return st.reduce((a, r) => a + r[s][key], 0) / st.length; };
  const L = at('L', 'footX'), R = at('R', 'footX');
  console.log(`\n${clip.name}  (${clip.cycleDistance} m/cycle)`);
  console.log(`  feet in stance: L ${cm(L)} cm, R ${cm(R)} cm from the midline -> step width ${cm(L - R)} cm${L < 0 || R > 0 ? '  CROSSES THE MIDLINE' : ''}`);
  console.log(`  toe-out in stance: L ${at('L', 'toeOut').toFixed(1)} deg, R ${at('R', 'toeOut').toFixed(1)} deg`);
  console.log(`  hands across the body: L reaches ${cm(Math.min(...rows.map(r => r.L.handX)))} cm, R ${cm(-Math.max(...rows.map(r => r.R.handX)))} cm from the midline (negative = past it)`);
  console.log(`  hand swing fore-aft: L ${cm(range(r => r.L.handZ))} cm, R ${cm(range(r => r.R.handZ))} cm;  elbow bend mean L ${mean(r => r.L.elbow).toFixed(0)} R ${mean(r => r.R.elbow).toFixed(0)} deg;  elbow out from shoulder L ${cm(mean(r => r.L.elbowOut))} R ${cm(mean(r => r.R.elbowOut))} cm`);
  console.log(`  hip drop range ${range(r => r.hipDrop).toFixed(1)} deg, hip twist range ${range(r => r.hipTwist).toFixed(1)} deg, shoulder twist range ${range(r => r.shoulderTwist).toFixed(1)} deg, hip sway ${cm(range(r => r.mid.x))} cm`);
  console.log(`  hip bob ${cm(range(r => r.mid.y))} cm, mean hip height ${cm(mean(r => r.mid.y))} cm`);
  console.log(`  thigh lift max L ${Math.max(...rows.map(r => r.L.thighLift)).toFixed(0)} R ${Math.max(...rows.map(r => r.R.thighLift)).toFixed(0)} deg`);
}
