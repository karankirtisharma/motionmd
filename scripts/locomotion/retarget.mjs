// Locomotion pipeline, step 1: transfer Mixamo motion-capture clips onto the visitor's Rocketbox (Bip01) rig.
//
// The two rigs differ in rest pose (Mixamo: arms straight out; visitor: arms hanging ~45 deg, feet turned
// out 14 deg), hierarchy (visitor thighs hang from the spine, clavicles from the neck) and size (legs 0.89 m
// vs 0.80 m). A plain copy of joint rotations would twist the arms and slide the feet. Instead:
//   1. Pose the visitor into the source's rest pose ("reference pose") by aligning each bone's direction
//      (joint to child joint) with the source's, top-down, keeping the visitor's own twist.
//   2. Per frame, apply each source bone's world rotation change from its rest onto the visitor's
//      reference pose (world space, so differing hierarchies do not matter).
//   3. Hips: the source hip movement scaled by leg length (0.89 m -> 0.80 m), so strides fit the legs.
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
globalThis.window ??= globalThis; globalThis.self ??= globalThis;

const side = (m, r) => [['Left' + m, 'Bip01_L_' + r], ['Right' + m, 'Bip01_R_' + r]];
// Source bone (without the "mixamorig" prefix) -> visitor bone, in parent-before-child order for each rig.
export const BONES = [
  ['Hips', 'Bip01_Pelvis'], ['Spine', 'Bip01_Spine'], ['Spine1', 'Bip01_Spine1'], ['Spine2', 'Bip01_Spine2'], ['Neck', 'Bip01_Neck'], ['Head', 'Bip01_Head'],
  ...side('UpLeg', 'Thigh'), ...side('Leg', 'Calf'), ...side('Foot', 'Foot'), ...side('ToeBase', 'Toe0'),
  ...side('Shoulder', 'Clavicle'), ...side('Arm', 'UpperArm'), ...side('ForeArm', 'Forearm'), ...side('Hand', 'Hand'),
  ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((finger, f) => [1, 2, 3].flatMap(k => side(`Hand${finger}${k}`, `Finger${f}${k === 1 ? '' : k - 1}`))),
];
// The bone whose position gives each bone's direction, in both rigs (the visitor has no end/nub bones).
const AIM = Object.fromEntries([
  ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'],
  ...['Left', 'Right'].flatMap(s => [[s + 'UpLeg', s + 'Leg'], [s + 'Leg', s + 'Foot'], [s + 'Foot', s + 'ToeBase'],
    [s + 'Shoulder', s + 'Arm'], [s + 'Arm', s + 'ForeArm'], [s + 'ForeArm', s + 'Hand'], [s + 'Hand', s + 'HandMiddle1'],
    ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap(f => [[`${s}Hand${f}1`, `${s}Hand${f}2`], [`${s}Hand${f}2`, `${s}Hand${f}3`]])]),
]);

export function loadSource(file) {
  const bytes = fs.readFileSync(file);
  const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  root.scale.setScalar(.01); root.updateMatrixWorld(true);   // centimetres -> metres
  const bones = new Map(); root.traverse(o => { if (o.isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o); });
  return { root, bones, clip: root.animations[0] };
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const worldQ = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
const worldP = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);
function setWorldQuaternion(bone, q) {
  bone.parent.updateWorldMatrix(true, false);
  bone.quaternion.copy(worldQ(bone.parent, tmpQ2).invert().multiply(q)); bone.updateMatrixWorld(true);
}
function frameOf(up, right) {   // orthonormal frame from an up and a right direction
  const y = up.clone().normalize(), x = right.clone().sub(y.clone().multiplyScalar(right.dot(y))).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Prepare a visitor rig for retargeting: reference pose matched to the source rest, and the leg scale. */
export function prepareTarget(target, source) {
  const t = new Map(); target.traverse(o => { if (o.isBone) t.set(o.name, o); });
  const s = source.bones;
  // Source rest = the FBX bind pose (T-pose), captured before any animation is applied.
  const sourceRest = new Map(BONES.map(([m]) => [m, worldQ(s.get(m))]));
  const sourceRestPos = new Map([...s].map(([m, b]) => [m, worldP(b)]));
  const rest = new Map([...t].map(([n, b]) => [n, b.quaternion.clone()]));
  const restPosition = t.get('Bip01_Pelvis').position.clone();
  // Reference pose: top-down, rotate each visitor bone so it points where the source bone points at rest.
  target.updateMatrixWorld(true);
  for (const [m, r] of BONES) {
    const bone = t.get(r);
    if (m === 'Hips') {
      // Pelvis: match the frame of (up = towards the spine, right = right hip to left hip).
      const srcFrame = frameOf(sourceRestPos.get('Spine').clone().sub(sourceRestPos.get('Hips')), sourceRestPos.get('LeftUpLeg').clone().sub(sourceRestPos.get('RightUpLeg')));
      const tgtFrame = frameOf(worldP(t.get('Bip01_Spine1')).sub(worldP(t.get('Bip01_Pelvis'))), worldP(t.get('Bip01_L_Thigh')).sub(worldP(t.get('Bip01_R_Thigh'))));
      setWorldQuaternion(bone, srcFrame.clone().multiply(tgtFrame.clone().invert()).multiply(worldQ(bone)));
      continue;
    }
    const aim = AIM[m]; if (!aim) continue;
    const child = t.get(BONES.find(([mm]) => mm === aim)[1]);
    const want = sourceRestPos.get(aim).clone().sub(sourceRestPos.get(m)).normalize();
    const have = worldP(child).sub(worldP(bone)).normalize();
    setWorldQuaternion(bone, new THREE.Quaternion().setFromUnitVectors(have, want).multiply(worldQ(bone)));
  }
  const reference = new Map(BONES.map(([, r]) => [r, worldQ(t.get(r))]));
  // Restore the visitor's own rest; retargeted frames are written from scratch.
  for (const [n, q] of rest) t.get(n).quaternion.copy(q);
  t.get('Bip01_Pelvis').position.copy(restPosition); target.updateMatrixWorld(true);
  const leg = (a, b, c) => a.distanceTo(b) + b.distanceTo(c);
  const sourceLeg = leg(sourceRestPos.get('LeftUpLeg'), sourceRestPos.get('LeftLeg'), sourceRestPos.get('LeftFoot'));
  const targetLeg = leg(worldP(t.get('Bip01_L_Thigh')), worldP(t.get('Bip01_L_Calf')), worldP(t.get('Bip01_L_Foot')));
  return { bones: t, sourceRest, sourceRestPos, reference, rest, restPosition, scale: targetLeg / sourceLeg, pelvisRestWorld: worldP(t.get('Bip01_Pelvis')) };
}

/**
 * Pose the visitor at source time `time`. `travel(time)` returns the source hip displacement to remove
 * (root motion), in metres. Returns nothing; the visitor rig holds the pose (local transforms).
 */
export function poseAt(source, mixer, action, prep, time, travel) {
  action.time = time; mixer.update(0); source.root.updateMatrixWorld(true);
  const s = source.bones, t = prep.bones;
  // Hips position: rest + (source hips movement - removed travel) * leg scale, in world, then to parent space.
  const hips = worldP(s.get('Hips')).sub(prep.sourceRestPos.get('Hips')).sub(travel(time)).multiplyScalar(prep.scale);
  const pelvis = t.get('Bip01_Pelvis');
  const world = prep.pelvisRestWorld.clone().add(hips);
  pelvis.parent.updateWorldMatrix(true, false);
  pelvis.position.copy(pelvis.parent.worldToLocal(world));
  for (const [m, r] of BONES) {
    const delta = worldQ(s.get(m), tmpQ).multiply(prep.sourceRest.get(m).clone().invert());
    setWorldQuaternion(t.get(r), delta.multiply(prep.reference.get(r)));
  }
}

/** Direction error (deg) between each visitor bone and its source bone, at the current pose. */
export function directionError(source, prep) {
  let worst = 0, name = '';
  for (const [m, r] of BONES) {
    const aim = AIM[m]; if (!aim) continue;
    const a = worldP(source.bones.get(aim), tmpA).sub(worldP(source.bones.get(m))).normalize();
    const b = worldP(prep.bones.get(BONES.find(([mm]) => mm === aim)[1]), tmpB).sub(worldP(prep.bones.get(r))).normalize();
    const e = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * 180 / Math.PI;
    if (e > worst) { worst = e; name = r; }
  }
  return { worst, name };
}
