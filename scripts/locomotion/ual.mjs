// Locomotion v2: Quaternius Universal Animation Library (CC0, Unreal-mannequin skeleton) on the visitor's
// Rocketbox (Bip01) rig. Same transfer as retarget.mjs (reference pose + world-space rotation deltas), with
// one correction: bones that have no child to aim at (head, toes, finger tips) keep the visitor's own rest
// orientation in the reference pose. Previously the head inherited the neck's alignment and tipped back.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const UAL_FILE = 'D:/MD Website Perf Audit/anim-src/quaternius-ual-standard/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
export const UAL_RM_FILE = UAL_FILE.replace('.glb', '_RM.glb');

const side = (s, r) => [[s + '_l', 'Bip01_L_' + r], [s + '_r', 'Bip01_R_' + r]];
const fingers = [['thumb', 0], ['index', 1], ['middle', 2], ['ring', 3], ['pinky', 4]];
// Source bone -> visitor bone, parents before children.
export const BONES = [
  ['pelvis', 'Bip01_Pelvis'], ['spine_01', 'Bip01_Spine'], ['spine_02', 'Bip01_Spine1'], ['spine_03', 'Bip01_Spine2'], ['neck_01', 'Bip01_Neck'], ['Head', 'Bip01_Head'],
  ...side('thigh', 'Thigh'), ...side('calf', 'Calf'), ...side('foot', 'Foot'), ...side('ball', 'Toe0'),
  ...side('clavicle', 'Clavicle'), ...side('upperarm', 'UpperArm'), ...side('lowerarm', 'Forearm'), ...side('hand', 'Hand'),
  ...fingers.flatMap(([f, n]) => [1, 2, 3].flatMap(k => side(`${f}_0${k}`, `Finger${n}${k === 1 ? '' : k - 1}`))),
];
// Each bone's direction: towards this child (same pair in both rigs).
export const AIM = Object.fromEntries([
  ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'Head'],
  ...['_l', '_r'].flatMap(s => [['thigh' + s, 'calf' + s], ['calf' + s, 'foot' + s], ['foot' + s, 'ball' + s],
    ['clavicle' + s, 'upperarm' + s], ['upperarm' + s, 'lowerarm' + s], ['lowerarm' + s, 'hand' + s], ['hand' + s, 'middle_01' + s],
    ...fingers.flatMap(([f]) => [[`${f}_01${s}`, `${f}_02${s}`], [`${f}_02${s}`, `${f}_03${s}`]])]),
]);

/** A GLB without its textures (Node has no image decoder). */
export async function loadGLB(file) {
  const b = fs.readFileSync(file), length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  let data = Buffer.from(JSON.stringify(json)); data = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4, 32)]);
  const header = Buffer.from(b.subarray(0, 20)); header.writeUInt32LE(b.length - length + data.length, 8); header.writeUInt32LE(data.length, 12);
  const blob = Buffer.concat([header, data, b.subarray(20 + length)]);
  return new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
}

/** The mannequin and one of its clips. Rest = the GLB's node transforms, before any clip is applied. */
export async function loadSource(file, clipName) {
  const gltf = await loadGLB(file), root = gltf.scene;
  root.updateMatrixWorld(true);
  const bones = new Map(); root.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  const clip = gltf.animations.find(c => c.name === clipName);
  if (!clip) throw new Error('no clip ' + clipName);
  return { root, bones, clip, gltf };
}

const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const worldQ = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
const worldP = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);
function setWorldQuaternion(bone, q) {
  bone.parent.updateWorldMatrix(true, false);
  bone.quaternion.copy(worldQ(bone.parent, tmpQ2).invert().multiply(q)); bone.updateMatrixWorld(true);
}
function frameOf(up, right) {
  const y = up.clone().normalize(), x = right.clone().sub(y.clone().multiplyScalar(right.dot(y))).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Visitor reference pose matched to the source rest, and the leg-length scale. Call with the visitor at rest. */
export function prepareTarget(target, source) {
  const t = new Map(); target.traverse(o => { if (o.isBone) t.set(o.name, o); });
  const s = source.bones;
  const sourceRest = new Map(BONES.map(([m]) => [m, worldQ(s.get(m))]));
  const sourceRestPos = new Map([...s].map(([m, b]) => [m, worldP(b)]));
  const rest = new Map([...t].map(([n, b]) => [n, b.quaternion.clone()]));
  const restWorld = new Map(BONES.map(([, r]) => [r, worldQ(t.get(r))]));
  const restPosition = t.get('Bip01_Pelvis').position.clone();
  target.updateMatrixWorld(true);
  for (const [m, r] of BONES) {
    const bone = t.get(r);
    if (m === 'pelvis') {
      const srcFrame = frameOf(sourceRestPos.get('spine_02').clone().sub(sourceRestPos.get('pelvis')), sourceRestPos.get('thigh_l').clone().sub(sourceRestPos.get('thigh_r')));
      const tgtFrame = frameOf(worldP(t.get('Bip01_Spine1')).sub(worldP(t.get('Bip01_Pelvis'))), worldP(t.get('Bip01_L_Thigh')).sub(worldP(t.get('Bip01_R_Thigh'))));
      setWorldQuaternion(bone, srcFrame.clone().multiply(tgtFrame.clone().invert()).multiply(worldQ(bone)));
      continue;
    }
    const aim = AIM[m];
    if (!aim) { setWorldQuaternion(bone, restWorld.get(r)); continue; }   // head, toes, finger tips: as the visitor holds them
    const child = t.get(BONES.find(([mm]) => mm === aim)[1]);
    const want = sourceRestPos.get(aim).clone().sub(sourceRestPos.get(m)).normalize();
    const have = worldP(child).sub(worldP(bone)).normalize();
    setWorldQuaternion(bone, new THREE.Quaternion().setFromUnitVectors(have, want).multiply(worldQ(bone)));
  }
  const reference = new Map(BONES.map(([, r]) => [r, worldQ(t.get(r))]));
  for (const [n, q] of rest) t.get(n).quaternion.copy(q);
  t.get('Bip01_Pelvis').position.copy(restPosition); target.updateMatrixWorld(true);
  const leg = (a, b, c) => a.distanceTo(b) + b.distanceTo(c);
  const sourceLeg = leg(sourceRestPos.get('thigh_l'), sourceRestPos.get('calf_l'), sourceRestPos.get('foot_l'));
  const targetLeg = leg(worldP(t.get('Bip01_L_Thigh')), worldP(t.get('Bip01_L_Calf')), worldP(t.get('Bip01_L_Foot')));
  return { bones: t, sourceRest, sourceRestPos, reference, rest, restPosition, scale: targetLeg / sourceLeg, pelvisRestWorld: worldP(t.get('Bip01_Pelvis')) };
}

/** Pose the visitor at source time `time`; `travel(time)` = source hip displacement to remove (metres). */
export function poseAt(source, mixer, action, prep, time, travel) {
  action.time = time; mixer.update(0); source.root.updateMatrixWorld(true);
  const s = source.bones, t = prep.bones;
  const hips = worldP(s.get('pelvis')).sub(prep.sourceRestPos.get('pelvis')).sub(travel(time)).multiplyScalar(prep.scale);
  const pelvis = t.get('Bip01_Pelvis');
  pelvis.parent.updateWorldMatrix(true, false);
  pelvis.position.copy(pelvis.parent.worldToLocal(prep.pelvisRestWorld.clone().add(hips)));
  for (const [m, r] of BONES) {
    const delta = worldQ(s.get(m), tmpQ).multiply(prep.sourceRest.get(m).clone().invert());
    setWorldQuaternion(t.get(r), delta.multiply(prep.reference.get(r)));
  }
}
