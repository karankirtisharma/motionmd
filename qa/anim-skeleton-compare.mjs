// Rest poses and proportions of the visitor (Rocketbox Bip01) and the Mixamo clip skeleton, side by side.
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
globalThis.window ??= globalThis; globalThis.self ??= globalThis;
const visitor = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf;
const rb = visitor.scene; rb.updateMatrixWorld(true);
const buffer = fs.readFileSync('C:/Users/karan_z7alww2/Downloads/Walking.fbx');
const mx = new FBXLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length), ''); mx.scale.setScalar(.01); mx.updateMatrixWorld(true);
const find = (root, name) => { let b; root.traverse(o => { if (o.isBone && o.name === name) b = o; }); return b; };
const pairs = [['Hips', 'Bip01_Pelvis'], ['Spine', 'Bip01_Spine'], ['Spine1', 'Bip01_Spine1'], ['Spine2', 'Bip01_Spine2'], ['Neck', 'Bip01_Neck'], ['Head', 'Bip01_Head'],
  ['LeftShoulder', 'Bip01_L_Clavicle'], ['LeftArm', 'Bip01_L_UpperArm'], ['LeftForeArm', 'Bip01_L_Forearm'], ['LeftHand', 'Bip01_L_Hand'],
  ['LeftUpLeg', 'Bip01_L_Thigh'], ['LeftLeg', 'Bip01_L_Calf'], ['LeftFoot', 'Bip01_L_Foot'], ['LeftToeBase', 'Bip01_L_Toe0'],
  ['RightUpLeg', 'Bip01_R_Thigh'], ['RightLeg', 'Bip01_R_Calf'], ['RightFoot', 'Bip01_R_Foot'], ['RightToeBase', 'Bip01_R_Toe0']];
const v = new THREE.Vector3(), f = n => n.toArray().map(x => x.toFixed(3)).join(',');
console.log('visitor bones:', (() => { const l = []; rb.traverse(o => { if (o.isBone) l.push(o.name); }); return l.length + ' — ' + l.filter(n => !/Finger|Toe0\d|Nub/.test(n)).join(' '); })());
console.log('bone pair                 mixamo rest (m)          visitor rest (m)');
for (const [m, r] of pairs) {
  const a = find(mx, 'mixamorig' + m), b = find(rb, r);
  console.log(`${(m + '/' + r).padEnd(34)} ${a ? f(a.getWorldPosition(v)) : 'missing'}   ${b ? f(b.getWorldPosition(v)) : 'missing'}`);
}
const len = (root, a, b) => find(root, a).getWorldPosition(new THREE.Vector3()).distanceTo(find(root, b).getWorldPosition(new THREE.Vector3()));
console.log(`thigh  mixamo ${len(mx, 'mixamorigLeftUpLeg', 'mixamorigLeftLeg').toFixed(3)}  visitor ${len(rb, 'Bip01_L_Thigh', 'Bip01_L_Calf').toFixed(3)}`);
console.log(`shin   mixamo ${len(mx, 'mixamorigLeftLeg', 'mixamorigLeftFoot').toFixed(3)}  visitor ${len(rb, 'Bip01_L_Calf', 'Bip01_L_Foot').toFixed(3)}`);
console.log(`upper arm mixamo ${len(mx, 'mixamorigLeftArm', 'mixamorigLeftForeArm').toFixed(3)}  visitor ${len(rb, 'Bip01_L_UpperArm', 'Bip01_L_Forearm').toFixed(3)}`);
console.log('visitor clips:', visitor.animations.map(c => `${c.name} ${c.duration.toFixed(2)}s ${c.tracks.length} tracks`).join(' | '));
const hasPos = visitor.animations.map(c => c.name + ': ' + c.tracks.filter(t => t.name.endsWith('.position')).map(t => t.name.split('.')[0]).join(','));
console.log('position tracks:', hasPos.join(' | '));
let gt = 'none'; try { await import('@gltf-transform/core'); gt = 'available'; } catch {}
console.log('gltf-transform:', gt);
