// Locomotion sources and their transfer onto the visitor's Rocketbox (Bip01) rig.
//   mixamo: Adobe Mixamo motion capture (Walking, Running), FBX, root motion in the hips.
//   ual:    Quaternius Universal Animation Library (CC0, Unreal-mannequin skeleton), GLB, in place.
// Transfer (both): arms, hands, legs and feet take the source's world-space rotation changes from its rest pose,
// applied to the visitor posed into that rest pose ("reference pose", matched by bone directions). The torso keeps
// the visitor's own posture: spine, neck and head take the source's rotation changes on the visitor's own rest pose
// (matching their directions to a skeleton with differently placed joints bent his back and tipped his head), and
// the collarbones stay at his own idle angle (matched, they shrugged his shoulders 5-6 cm up and 4 cm back).
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
globalThis.window ??= globalThis; globalThis.self ??= globalThis;

const ANIM_SRC = 'D:/MD Website Perf Audit/anim-src/';
const mixamoSide = (m, r) => [['Left' + m, 'Bip01_L_' + r], ['Right' + m, 'Bip01_R_' + r]];
const ualSide = (s, r) => [[s + '_l', 'Bip01_L_' + r], [s + '_r', 'Bip01_R_' + r]];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

export const PROFILES = {
  mixamo: {
    clips: { walk: 'Walking', run: 'Running' },
    bones: [
      ['Hips', 'Bip01_Pelvis'], ['Spine', 'Bip01_Spine'], ['Spine1', 'Bip01_Spine1'], ['Spine2', 'Bip01_Spine2'], ['Neck', 'Bip01_Neck'], ['Head', 'Bip01_Head'],
      ...mixamoSide('UpLeg', 'Thigh'), ...mixamoSide('Leg', 'Calf'), ...mixamoSide('Foot', 'Foot'), ...mixamoSide('ToeBase', 'Toe0'),
      ...mixamoSide('Shoulder', 'Clavicle'), ...mixamoSide('Arm', 'UpperArm'), ...mixamoSide('ForeArm', 'Forearm'), ...mixamoSide('Hand', 'Hand'),
      ...FINGERS.flatMap((f, n) => [1, 2, 3].flatMap(k => mixamoSide(`Hand${f}${k}`, `Finger${n}${k === 1 ? '' : k - 1}`))),
    ],
    aim: Object.fromEntries(['Left', 'Right'].flatMap(s => [[s + 'UpLeg', s + 'Leg'], [s + 'Leg', s + 'Foot'], [s + 'Foot', s + 'ToeBase'],
      [s + 'Arm', s + 'ForeArm'], [s + 'ForeArm', s + 'Hand'], [s + 'Hand', s + 'HandMiddle1'],
      ...FINGERS.flatMap(f => [[`${s}Hand${f}1`, `${s}Hand${f}2`], [`${s}Hand${f}2`, `${s}Hand${f}3`]])])),
    torso: ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'], collarbones: ['LeftShoulder', 'RightShoulder'],
    hips: 'Hips', pelvisUp: 'Spine1', thighs: ['LeftUpLeg', 'RightUpLeg'], leg: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'],
    async load(clip) {
      const bytes = fs.readFileSync(ANIM_SRC + clip + '.fbx');
      const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
      root.scale.setScalar(.01); root.updateMatrixWorld(true);   // centimetres -> metres
      const bones = new Map(); root.traverse(o => { if (o.isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o); });
      return { root, bones, clip: root.animations[0] };
    },
  },
  ual: {
    clips: { walk: 'Walk_Loop', run: 'Jog_Fwd_Loop' },
    bones: [
      ['pelvis', 'Bip01_Pelvis'], ['spine_01', 'Bip01_Spine'], ['spine_02', 'Bip01_Spine1'], ['spine_03', 'Bip01_Spine2'], ['neck_01', 'Bip01_Neck'], ['Head', 'Bip01_Head'],
      ...ualSide('thigh', 'Thigh'), ...ualSide('calf', 'Calf'), ...ualSide('foot', 'Foot'), ...ualSide('ball', 'Toe0'),
      ...ualSide('clavicle', 'Clavicle'), ...ualSide('upperarm', 'UpperArm'), ...ualSide('lowerarm', 'Forearm'), ...ualSide('hand', 'Hand'),
      ...[['thumb', 0], ['index', 1], ['middle', 2], ['ring', 3], ['pinky', 4]].flatMap(([f, n]) => [1, 2, 3].flatMap(k => ualSide(`${f}_0${k}`, `Finger${n}${k === 1 ? '' : k - 1}`))),
    ],
    aim: Object.fromEntries(['_l', '_r'].flatMap(s => [['thigh' + s, 'calf' + s], ['calf' + s, 'foot' + s], ['foot' + s, 'ball' + s],
      ['upperarm' + s, 'lowerarm' + s], ['lowerarm' + s, 'hand' + s], ['hand' + s, 'middle_01' + s],
      ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap(f => [[`${f}_01${s}`, `${f}_02${s}`], [`${f}_02${s}`, `${f}_03${s}`]])])),
    torso: ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'], collarbones: ['clavicle_l', 'clavicle_r'],
    hips: 'pelvis', pelvisUp: 'spine_02', thighs: ['thigh_l', 'thigh_r'], leg: ['thigh_l', 'calf_l', 'foot_l'],
    async load(clip) {
      const file = ANIM_SRC + 'quaternius-ual-standard/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
      const b = fs.readFileSync(file), length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length));
      delete json.images; delete json.textures; delete json.samplers;
      for (const m of json.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
      let data = Buffer.from(JSON.stringify(json)); data = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4, 32)]);
      const header = Buffer.from(b.subarray(0, 20)); header.writeUInt32LE(b.length - length + data.length, 8); header.writeUInt32LE(data.length, 12);
      const blob = Buffer.concat([header, data, b.subarray(20 + length)]);
      const gltf = await new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
      gltf.scene.updateMatrixWorld(true);
      const bones = new Map(); gltf.scene.traverse(o => { if (o.isBone) bones.set(o.name, o); });
      const found = gltf.animations.find(c => c.name === clip); if (!found) throw new Error('no clip ' + clip);
      return { root: gltf.scene, bones, clip: found };
    },
  },
};

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

/**
 * Visitor reference pose for a source. Call with the visitor at its rest (bind) pose; \`idleLocal\` maps bone name ->
 * local quaternion in his Idle (the collarbones keep it).
 */
export function prepareTarget(profile, target, source, idleLocal) {
  const t = new Map(); target.traverse(o => { if (o.isBone) t.set(o.name, o); });
  const s = source.bones, { bones: BONES, aim: AIM } = profile;
  const sourceRest = new Map(BONES.map(([m]) => [m, worldQ(s.get(m))]));
  const sourceRestPos = new Map([...s].map(([m, b]) => [m, worldP(b)]));
  const rest = new Map([...t].map(([n, b]) => [n, b.quaternion.clone()]));
  const restWorld = new Map(BONES.map(([, r]) => [r, worldQ(t.get(r))]));
  const restPosition = t.get('Bip01_Pelvis').position.clone();
  target.updateMatrixWorld(true);
  for (const [m, r] of BONES) {
    const bone = t.get(r);
    if (m === profile.hips) {
      const srcFrame = frameOf(sourceRestPos.get(profile.pelvisUp).clone().sub(sourceRestPos.get(m)), sourceRestPos.get(profile.thighs[0]).clone().sub(sourceRestPos.get(profile.thighs[1])));
      const tgtFrame = frameOf(worldP(t.get('Bip01_Spine1')).sub(worldP(t.get('Bip01_Pelvis'))), worldP(t.get('Bip01_L_Thigh')).sub(worldP(t.get('Bip01_R_Thigh'))));
      setWorldQuaternion(bone, srcFrame.clone().multiply(tgtFrame.clone().invert()).multiply(worldQ(bone)));
      continue;
    }
    const aim = AIM[m];
    if (!aim) { setWorldQuaternion(bone, restWorld.get(r)); continue; }   // torso, collarbones, toes, finger tips: his own
    const child = t.get(BONES.find(([mm]) => mm === aim)[1]);
    const want = sourceRestPos.get(aim).clone().sub(sourceRestPos.get(m)).normalize();
    const have = worldP(child).sub(worldP(bone)).normalize();
    setWorldQuaternion(bone, new THREE.Quaternion().setFromUnitVectors(have, want).multiply(worldQ(bone)));
  }
  const reference = new Map(BONES.map(([, r]) => [r, worldQ(t.get(r))]));
  for (const [n, q] of rest) t.get(n).quaternion.copy(q);
  t.get('Bip01_Pelvis').position.copy(restPosition); target.updateMatrixWorld(true);
  const leg = (a, b, c) => a.distanceTo(b) + b.distanceTo(c);
  const sourceLeg = leg(...profile.leg.map(n => sourceRestPos.get(n)));
  const targetLeg = leg(worldP(t.get('Bip01_L_Thigh')), worldP(t.get('Bip01_L_Calf')), worldP(t.get('Bip01_L_Foot')));
  const collarbones = new Set(profile.collarbones.map(m => BONES.find(([mm]) => mm === m)[1]));
  return { profile, bones: t, sourceRest, sourceRestPos, reference, rest, restPosition, collarbones, idleLocal,
    scale: targetLeg / sourceLeg, pelvisRestWorld: worldP(t.get('Bip01_Pelvis')) };
}

/** Pose the visitor at source time \`time\`; \`travel(time)\` = source hip displacement to remove (metres). */
export function poseAt(source, mixer, action, prep, time, travel) {
  action.time = time; mixer.update(0); source.root.updateMatrixWorld(true);
  const s = source.bones, t = prep.bones, hipsName = prep.profile.hips;
  const hips = worldP(s.get(hipsName)).sub(prep.sourceRestPos.get(hipsName)).sub(travel(time)).multiplyScalar(prep.scale);
  const pelvis = t.get('Bip01_Pelvis');
  pelvis.parent.updateWorldMatrix(true, false);
  pelvis.position.copy(pelvis.parent.worldToLocal(prep.pelvisRestWorld.clone().add(hips)));
  for (const [m, r] of prep.profile.bones) {
    const bone = t.get(r);
    // The thumb too keeps his idle pose: the capture's thumb, on this hand, stuck out stiffly while walking and running.
    if (prep.collarbones.has(r) || /^Bip01_[LR]_Finger0\d?$/.test(r)) { bone.quaternion.copy(prep.idleLocal.get(r)); bone.updateMatrixWorld(true); continue; }
    const delta = worldQ(s.get(m), tmpQ).multiply(prep.sourceRest.get(m).clone().invert());
    if (r === 'Bip01_Head') {
      // The gaze stays level (people steady the head; the run's capture looks 17 deg up): only its turn is kept.
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(delta);
      setWorldQuaternion(bone, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(forward.x, forward.z)).multiply(prep.reference.get(r)));
      continue;
    }
    setWorldQuaternion(bone, delta.multiply(prep.reference.get(r)));
  }
  // A plain walk, not a swagger: the capture walks with its toes 20 deg out and its arms 19 deg away from the body.
  // Each leg turns in about its hip-to-ankle line (knee and foot together, the ankle stays put) and each upper arm
  // comes in towards the body.
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const thigh = t.get('Bip01_' + side + '_Thigh'), foot = t.get('Bip01_' + side + '_Foot'), arm = t.get('Bip01_' + side + '_UpperArm');
    const axis = worldP(foot).sub(worldP(thigh)).normalize();
    setWorldQuaternion(thigh, new THREE.Quaternion().setFromAxisAngle(axis, sign * TOE_IN).multiply(worldQ(thigh)));
    setWorldQuaternion(arm, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * ARM_IN).multiply(worldQ(arm)));
  }
}
// A man's walk: toes about 10 deg out and arms hanging free (turning in further, to 4 deg and 9.6 deg, read as a
// narrow, feminine gait; the capture's own 20 deg and 19 deg read as a swagger).
const TOE_IN = 6 * Math.PI / 180, ARM_IN = 5.5 * Math.PI / 180;
