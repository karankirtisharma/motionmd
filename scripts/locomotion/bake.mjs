// Locomotion pipeline, step 2: bake the visitor's walk, run and stair clips.
//
//   node scripts/locomotion/bake.mjs   -> public/assets/character/locomotion-v16.json
//
// Source: Quaternius Universal Animation Library (CC0), retargeted by ual.mjs.
// Flat clips: Walk_Loop (walk) and Jog_Fwd_Loop stride-warped to ~4.2 m/s (run); travel removed, the ground
// speed measured from the planted feet, cycle starting at the left heel strike.
//
// Stair clips: the walk rebuilt for each of the building's flights (15.3 / 17.5 cm risers, 19-55 cm treads),
// one tread per step. Positions are in "tread coordinates": u = 0.5 is the centre of the tread the left foot
// lands on at the start of the cycle, u increases by 1 per tread in the direction of travel.
//   - Feet are rigid: heel-to-toe offsets and foot orientations come from the clip, never scaled.
//   - A planted foot is pinned to its tread centre (moved off the rising riser when the 31 cm shoe needs it),
//     carried by the heel and then the toe; a swinging foot is over its new tread by 75% of the swing.
//   - Sole heights are measured against the shoe's own sole where it stands flat in the walk.
//   - The hips follow the pitch line with the walk's bob, at the height that leaves the support leg near
//     straight (97.5-99.3% of its length).
//   - Swinging shoes clear the edges they cross by 3 cm (checked at both ends of the shoe).
//   - The legs are re-solved to reach the feet; each knee bends in the plane its clip knee points to.
//   - Then the same clearance on the shoe mesh itself (every vertex, at each frame and half-way between frames, as
//     the runtime interpolates them): where a swinging shoe is short, it is lifted and the legs solved again. (The
//     five-point shoe misses the toes bending at push-off: the trailing toe went 3-4 cm into the nose ahead.)
//   - On the spiral the path is a circle: feet and hips are placed in polar coordinates and turned with it.
//   - Printed per clip: the shoe mesh's deepest point inside a step and its slide while planted, as the runtime
//     audit measures them (TRUTH=<gait>:<flight>:<radius> prints them frame by frame).
import fs from 'node:fs';
import * as THREE from 'three';
import { geometryFixture } from '../../qa/helpers/geometry-fixture.mjs';
import { PROFILES, prepareTarget, poseAt } from './sources.mjs';

// LOCO_SOURCE=mixamo (motion capture, default) or ual (Quaternius, stylised).
const SOURCE = process.env.LOCO_SOURCE ?? 'mixamo', PROFILE = PROFILES[SOURCE], BONES = PROFILE.bones;

// A new bake gets a new name (the asset is cached by name). LOCO_OUT=<path> writes elsewhere, for comparisons.
const OUT = process.env.LOCO_OUT ? new URL('file:///' + process.env.LOCO_OUT.split('\\').join('/')) : new URL('../../public/assets/character/locomotion-v16.json', import.meta.url);
const SHORT_WARP = .38;      // the short-step walk: stride length against the walk's (about 0.63 m/s)
const FRAMES = 64;            // per cycle (two steps), uniform in phase
const STAND_DELTAS = [-.06, 0, .06, .12];   // stand poses: the root this far (cycle phase) either side of the footfall
const wrapHalfPhase = x => mod1(x + .5) - .5;
const FOOT_PITCH = 8 * Math.PI / 180;    // stairs: how far from flat a swinging foot may point (soft limit; at 18 deg the
                                         // shoe tip still pointed at the step: a "peak")
// Pitch of a foot: its own forward axis (level when it stands flat) against the horizontal. (The heel-to-toe joint line
// already points ~45 deg down on this rig when the foot is flat, and passed straight down when the capture pointed the
// toe: the turn built on it flipped the foot 40-60 deg in one frame.)
const footPitch = (q, forward) => Math.asin(THREE.MathUtils.clamp(forward.clone().applyQuaternion(q).y, -1, 1));
const JOG_WARP = +(process.env.JOG_WARP ?? (SOURCE === 'ual' ? .7 : 1));   // the UAL jog is authored at ~6 m/s; 0.7 -> ~4.2 m/s
const SAMPLE_HZ = 240;        // analysis rate
const CLEARANCE = .03;        // m: least gap between a swinging sole and any step under it
// The visitor's shoe reaches 9 cm beyond the toe joint and 7.8 cm behind the heel joint (31 cm long in all):
// longer than the gallery's 29 cm treads. Clearance is checked at the shoe's ends, and a planted foot is moved
// along its tread just far enough that the shoe end facing a rising riser stays 1 cm off it.
const SHOE_FRONT = .09, SHOE_BACK = .078, RISER_GAP = .01;
const SPIRAL = { riser: 0.152917, angle: 13.695 * Math.PI / 180 };
export const VARIANTS = [
  ...[0.8, 1.1, 1.45, 1.8, 2.2].map(radius => ({ flight: 'spiral', radius, riser: SPIRAL.riser, going: SPIRAL.angle * radius })),
  { flight: 'gallery', radius: 0, riser: 0.175, going: 0.29 },     // src/runtime/interaction/stairFlights.ts
  { flight: 'entrance', radius: 0, riser: 0.1725, going: 0.341 },
];
// Stair gaits: the walk's contacts assigned one tread each (rising or dropping one riser per step), legs re-solved.
// Its timing is the floor walk's, so joining and leaving a flight never changes rhythm.
const GAITS = [
  // Source: Quaternius Universal Animation Library (CC0) Walk_Loop. Running on stairs uses these at a quicker cadence.
  { name: 'up-walk', file: PROFILE.clips.walk, direction: 1, rebuild: true, lean: 6 },
  { name: 'down-walk', file: PROFILE.clips.walk, direction: -1, rebuild: true, lean: 2 },
];
const TOE_OUT = 8 * Math.PI / 180;   // most a foot may turn out from the way of travel

const Y = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1);
const wp = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);
const wq = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
function setWorldQ(bone, q) { bone.parent.updateWorldMatrix(true, false); bone.quaternion.copy(wq(bone.parent).invert().multiply(q)); bone.updateMatrixWorld(true); }
const smoother = x => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
const mod1 = x => ((x % 1) + 1) % 1;

// ---------- the visitor exactly as the game sets it up (RocketboxAvatar: idle pose measured, 1.86 m tall, feet at y = 0)
async function visitorModel() {
  const gltf = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf, model = gltf.scene;
  const rest = new Map(); model.traverse(o => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
  const mixer = new THREE.AnimationMixer(model), idle = mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).play();
  idle.setEffectiveWeight(1); mixer.update(0); model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(1.86 / Math.max(.1, bounds.max.y - bounds.min.y));
  model.updateMatrixWorld(true); bounds = new THREE.Box3().setFromObject(model);
  model.position.y -= bounds.min.y; model.updateMatrixWorld(true);
  const idleLocal = new Map(); model.traverse(o => { if (o.isBone) idleLocal.set(o.name, o.quaternion.clone()); });
  mixer.stopAllAction(); mixer.uncacheRoot(model);
  const reset = () => { for (const [o, [p, q, s]] of rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); } model.updateMatrixWorld(true); };
  reset();
  return { gltf, model, reset, idleLocal };
}

// Lowest vertex of one shoe (0 left, 1 right), skinned, in world space.
const shoeVertices = new Map();
function shoeBottom(model, side) {
  if (!shoeVertices.has(model)) {
    const lists = [[], []];
    model.traverse(o => { if (!o.isSkinnedMesh) return; const w = o.geometry.getAttribute('skinWeight'), j = o.geometry.getAttribute('skinIndex');
      for (let i = 0; i < w.count; i++) { let L = 0, R = 0; for (let k = 0; k < 4; k++) { const n = o.skeleton.bones[j.getComponent(i, k)].name, x = w.getComponent(i, k); if (/L_(Foot|Toe)/.test(n)) L += x; if (/R_(Foot|Toe)/.test(n)) R += x; } if (L > .6) lists[0].push([o, i]); else if (R > .6) lists[1].push([o, i]); } });
    shoeVertices.set(model, lists);
  }
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3(); let low = Infinity;
  for (const [mesh, i] of shoeVertices.get(model)[side]) low = Math.min(low, mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).y);
  return low;
}

// ---------- a stair clip as the runtime plays it (frames interpolated) and its shoes against the target flight
// Pose at fractional frame x (cyclic): rotations slerped and the pelvis lerped between keys, as the mixer does.
function poseFrame(prep, frames, x) {
  const k = ((Math.floor(x) % FRAMES) + FRAMES) % FRAMES, k1 = (k + 1) % FRAMES, t = x - Math.floor(x), q = new THREE.Quaternion();
  BONES.forEach(([, r], b) => prep.bones.get(r).quaternion.fromArray(frames[k].rotations[b]).slerp(q.fromArray(frames[k1].rotations[b]), t));
  prep.bones.get('Bip01_Pelvis').position.fromArray(frames[k].pelvis).lerp(new THREE.Vector3().fromArray(frames[k1].pelvis), t);
}
// Every shoe vertex, per sub-frame and foot: the lowest one's gap over the tread under it, and the deepest point inside
// the stair (the runtime audit's measures). Slide: how far the vertex that carries a foot (lowest, within 3 mm of
// its tread) moves over the ground while it stays within 3 mm. `geo.where(P, uRoot)` -> { u, across, h, going }.
function shoeTruth(model, prep, frames, geo, sub = 4) {
  shoeBottom(model, 0);
  const lists = shoeVertices.get(model), v = new THREE.Vector3(), rows = [], n = FRAMES * sub;
  const contact = [undefined, undefined], slide = [0, 0];
  for (let i = 0; i < n + n / 4; i++) {   // a quarter cycle more, so contacts across the seam are followed
    const x = i / sub, uRoot = geo.uRootAt(x / FRAMES);
    poseFrame(prep, frames, x); model.updateMatrixWorld(true);
    const row = [0, 1].map(side => {
      let low = { gap: Infinity }, depth = 0, at, carried;
      lists[side].forEach(([mesh, index], j) => {
        const p = geo.where(mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld), uRoot), base = Math.floor(p.u);
        const gap = p.h - geo.top(base, uRoot);
        if (gap < low.gap) low = { gap, j, u: p.u, across: p.across, going: p.going, h: p.h };
        if (contact[side]?.j === j) carried = { gap, u: p.u, across: p.across };
        let best = Infinity;
        for (let t = base - 1; t <= base + 1; t++) best = Math.min(best, Math.hypot(Math.max(0, (t - p.u) * p.going, (p.u - t - 1) * p.going), Math.max(0, geo.top(t, uRoot) - p.h)));
        if (best > depth) { depth = best; at = p; }
      });
      const c = contact[side];
      let moved = 0;
      if (c && carried && carried.gap < .003) moved = c.moved + Math.hypot((carried.u - c.u) * c.going, carried.across - c.across);
      if (i >= n / 4) slide[side] = Math.max(slide[side], moved);
      contact[side] = low.gap < .003 ? { j: low.j, u: low.u, across: low.across, going: low.going, moved: c && c.j === low.j ? moved : 0 } : undefined;
      return { gap: low.gap, depth, at, moved };
    });
    if (i < n) rows.push({ phase: x / FRAMES, feet: row });
  }
  return { rows, sink: Math.max(...rows.flatMap(r => r.feet.map(f => f.depth))), slide: Math.max(...slide) };
}

// ---------- a source clip on the visitor, sampled in the "ground frame" (travel added back, metres)
async function analyse(file, model, reset) {
  const source = await PROFILE.load(file), prep = prepareTarget(PROFILE, model, source, idleLocal);
  const mixer = new THREE.AnimationMixer(source.root), action = mixer.clipAction(source.clip).play();
  const T = source.clip.duration;
  // Root motion (Mixamo): the hips travel over the loop; that travel is removed. In place (UAL): nothing to remove,
  // and the ground speed is the one the planted feet move back at (least squares over each carrying point).
  const hipsAt = time => { action.time = time; mixer.update(0); source.root.updateMatrixWorld(true); return wp(source.bones.get(PROFILE.hips)); };
  const drift = hipsAt(T - 1e-4).sub(hipsAt(0)).multiplyScalar(T / (T - 1e-4)); drift.x = 0; drift.y = 0;
  let travel, total;
  if (drift.length() > .05) { total = drift; travel = time => drift.clone().multiplyScalar(time / T); }
  else { travel = () => new THREE.Vector3(); total = new THREE.Vector3(0, 0, groundSpeed(source, mixer, action, prep, T, model) * T / prep.scale); }
  const bones = s => ({ heel: prep.bones.get(`Bip01_${s}_Foot`), toe: prep.bones.get(`Bip01_${s}_Toe0`) });
  const feet = [bones('L'), bones('R')];
  reset();
  // Joint heights over the shoe's own sole (its lowest vertex) in this pose. Not over y = 0: the bind pose is not
  // the idle pose the visitor is calibrated in, and its shoes sit 3 cm lower, which put every stair foot 3 cm deep.
  let heelRest, toeRest;   // set below, from the walk's own planted frames
  const n = Math.round(T * SAMPLE_HZ), samples = [];
  for (let i = 0; i < n; i++) {
    const time = i / n * T; poseAt(source, mixer, action, prep, time, travel); model.updateMatrixWorld(true);
    const shift = total.clone().multiplyScalar(prep.scale * time / T);
    samples.push({ time, feet: feet.map(f => ({ heel: wp(f.heel).add(shift), toe: wp(f.toe).add(shift) })), pelvis: wp(prep.bones.get('Bip01_Pelvis')).add(shift), bottoms: [shoeBottom(model, 0), shoeBottom(model, 1)] });
  }
  // Joint heights over the shoe's own sole, measured where it stands flat in this walk: of the frames where a shoe
  // is down (within 1 cm of its lowest), the five whose heel-to-toe pitch is closest to the standing pose's. (The
  // bind pose holds the feet differently: calibrated there, every stair foot sat 2.4 cm deep.)
  {
    reset();
    const standingPitch = wp(feet[0].heel).y - wp(feet[0].toe).y, heel = [], toe = [];
    for (const side of [0, 1]) {
      const floor = Math.min(...samples.map(x => x.bottoms[side]));
      samples.filter(x => x.bottoms[side] < floor + .01)
        .sort((p, q) => Math.abs(p.feet[side].heel.y - p.feet[side].toe.y - standingPitch) - Math.abs(q.feet[side].heel.y - q.feet[side].toe.y - standingPitch))
        .slice(0, 5).forEach(x => { heel.push(x.feet[side].heel.y - x.bottoms[side]); toe.push(x.feet[side].toe.y - x.bottoms[side]); });
    }
    const median = list => list.sort((p, q) => p - q)[Math.floor(list.length / 2)];
    heelRest = median(heel); toeRest = median(toe);
  }
  // Planted: the slower of heel/toe moves < 0.25 m/s over the ground (cyclic, the clip loops).
  // A foot is planted where the slower of its heel/toe points moves least. Some captures slide a little
  // while planted (the running climb's right foot never drops below 0.26 m/s): the threshold rises from
  // 0.25 m/s until each foot has a contact of at least 12% of the cycle.
  const speeds = [0, 1].map(s => samples.map((x, i) => {
    const y = samples[(i + 1) % n], wrap = i + 1 === n ? total.clone().multiplyScalar(prep.scale) : new THREE.Vector3();
    const a = x.feet[s], b = y.feet[s];
    return Math.min(a.heel.distanceTo(b.heel.clone().add(wrap)), a.toe.distanceTo(b.toe.clone().add(wrap))) * n / T;
  }));
  const longestRun = flags => { let best = 0; for (let i = 0; i < n; i++) { let k = 0; while (k < n && flags[(i + k) % n]) k++; best = Math.max(best, k); } return best; };
  const planted = speeds.map(list => { let limit = .25, flags; do { flags = list.map(v => v < limit); limit += .02; } while (longestRun(flags) < .12 * n && limit < 1); return flags; });
  // One contact per foot per cycle: its strike (first planted sample after a swing) and duration.
  // Each foot's contact: its longest planted run around the loop, with gaps of up to 3 samples bridged.
  const contact = flags => {
    const bridged = flags.map((v, i) => v || (() => { for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) if (a + b <= 4 && flags[(i - a + n) % n] && flags[(i + b) % n]) return true; return false; })());
    let best = { start: 0, length: 0 };
    for (let i = 0; i < n; i++) {
      if (!bridged[i] || bridged[(i - 1 + n) % n]) continue;   // runs start after a non-planted sample
      let k = 0; while (k < n && bridged[(i + k) % n]) k++;
      if (k > best.length) best = { start: i, length: k };
    }
    return best;
  };
  const left = contact(planted[0]), right = contact(planted[1]);
  const contacts = [left, right].map(c => ({ phase: mod1((c.start - left.start) / n), duration: c.length / n }));
  const L = left.start;
  return { source, prep, mixer, action, T, total, travel, samples, n, leftStrike: L / n * T, contacts, heelRest, toeRest, scale: prep.scale };
}

function groundSpeed(source, mixer, action, prep, T, model) {
  const feet = ['L', 'R'].map(s => ({ heel: prep.bones.get(`Bip01_${s}_Foot`), toe: prep.bones.get(`Bip01_${s}_Toe0`) }));
  const n = Math.round(T * SAMPLE_HZ), rows = [];
  let heelRest, toeRest;
  { const q = new Map([...prep.bones].map(([k, b]) => [k, b.quaternion.clone()])); for (const [k, b] of prep.bones) b.quaternion.copy(prep.rest.get(k)); model.updateMatrixWorld(true); heelRest = wp(feet[0].heel).y; toeRest = wp(feet[0].toe).y; for (const [k, b] of prep.bones) b.quaternion.copy(q.get(k)); }
  for (let i = 0; i < n; i++) { poseAt(source, mixer, action, prep, i / n * T, () => new THREE.Vector3()); model.updateMatrixWorld(true); rows.push(feet.map(f => ({ heel: wp(f.heel), toe: wp(f.toe) }))); }
  let num = 0, den = 0;
  for (const s of [0, 1]) {
    let run = [];
    const flush = () => { if (run.length > 2) { const mt = run.reduce((a, r) => a + r.t, 0) / run.length, mz = run.reduce((a, r) => a + r.z, 0) / run.length; for (const r of run) { num += (r.t - mt) * (r.z - mz); den += (r.t - mt) ** 2; } } run = []; };
    for (let i = 0; i < n; i++) {
      const f = rows[i][s], hs = f.heel.y - heelRest, ts = f.toe.y - toeRest, p = hs <= ts ? 'heel' : 'toe';
      if (Math.min(hs, ts) >= .012 || (run.length && run[0].p !== p)) flush();
      if (Math.min(hs, ts) < .012) run.push({ p, t: i / SAMPLE_HZ, z: f[p].z });
    }
    flush();
  }
  return -num / den;
}

// ---------- two-bone leg IK in world space; the knee bends in the plane its clip knee points to
// The knee bends in the plane its clip knee points to, biased 10 cm forward along `forward`: a straight or slightly
// over-extended clip knee (heel strike) would otherwise bend backwards for a frame (a 65 deg snap at every landing).
function solveLeg(thigh, calf, foot, target, footQ, stats, forward = FORWARD) {
  const H = wp(thigh), K0 = wp(calf), A0 = wp(foot);
  const l1 = H.distanceTo(K0), l2 = K0.distanceTo(A0);
  const toT = target.clone().sub(H); let d = toT.length();
  stats.reach = Math.max(stats.reach, d / (l1 + l2));
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * .9995);
  const u = toT.normalize(), u0 = A0.clone().sub(H).normalize(), k0 = K0.clone().sub(H);
  const pole = k0.sub(u0.clone().multiplyScalar(k0.dot(u0))).add(forward.clone().multiplyScalar(.1));
  const w = pole.sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const K = H.clone().add(u.clone().multiplyScalar(cosA * l1)).add(w.clone().multiplyScalar(sinA * l1)), A = H.clone().add(u.clone().multiplyScalar(d));
  setWorldQ(thigh, new THREE.Quaternion().setFromUnitVectors(K0.clone().sub(H).normalize(), K.clone().sub(H).normalize()).multiply(wq(thigh)));
  const K1 = wp(calf), A1 = wp(foot);
  setWorldQ(calf, new THREE.Quaternion().setFromUnitVectors(A1.clone().sub(K1).normalize(), A.clone().sub(K1).normalize()).multiply(wq(calf)));
  setWorldQ(foot, footQ);
  const bend = 180 - Math.acos(THREE.MathUtils.clamp(H.clone().sub(K).normalize().dot(A.clone().sub(K).normalize()), -1, 1)) * 180 / Math.PI;
  stats.minBend = Math.min(stats.minBend, bend); stats.maxBend = Math.max(stats.maxBend, bend);
  stats.ikError = Math.max(stats.ikError, wp(foot).distanceTo(target));
}
const record = prep => ({ rotations: BONES.map(([, r]) => prep.bones.get(r).quaternion.toArray()), pelvis: prep.bones.get('Bip01_Pelvis').position.toArray() });
const pack = arr => Buffer.from(new Float32Array(arr.flat(2)).buffer).toString('base64');
// Rotations as 16-bit integers (unit quaternion components; 3e-5 resolution, about 0.004 deg).
const packQ = arr => Buffer.from(new Int16Array(arr.flat(2).map(v => Math.round(Math.max(-1, Math.min(1, v)) * 32767))).buffer).toString('base64');

// ---------- arms: a smaller swing
// Each arm joint (upper arm, forearm, hand) turned part-way back to its mean over the stride, in its parent's space:
// the same rhythm, `keep` of the swing. (The capture's hands travel 44-54 cm front to back: cartoon-like for a man
// walking in a suit.)
const ARM_SWING = .55;
function armMeans(a, times) {
  const bones = ['L', 'R'].flatMap(s => ['UpperArm', 'Forearm', 'Hand'].map(b => a.prep.bones.get(`Bip01_${s}_${b}`)));
  const sums = bones.map(() => new THREE.Vector4());
  for (const time of times) {
    poseAt(a.source, a.mixer, a.action, a.prep, time, a.travel);
    bones.forEach((bone, i) => { const q = bone.quaternion, m = sums[i], sign = m.x * q.x + m.y * q.y + m.z * q.z + m.w * q.w < 0 ? -1 : 1; m.x += sign * q.x; m.y += sign * q.y; m.z += sign * q.z; m.w += sign * q.w; });
  }
  return bones.map((bone, i) => ({ bone, mean: new THREE.Quaternion(sums[i].x, sums[i].y, sums[i].z, sums[i].w).normalize() }));
}
const calmArms = (means, keep) => { for (const { bone, mean } of means) bone.quaternion.copy(mean.clone().slerp(bone.quaternion, keep)); };

// ---------- flat clip
// warp < 1: stride warping (as in Unreal's Animation Warping): same rhythm, every foot's distance ahead of or
// behind the hips scaled by `warp`, legs re-solved in their own knee plane, feet keep their orientation.
// shape (the run, the walks): `widen` m moved out under each foot (the capture runs with its feet 5 cm apart, one in front of
// the other: a catwalk line, read as a woman's run), `calm` the share of the hips' twist taken out (17 deg each
// stride, twice the walk's). The torso keeps its own motion; the legs are re-solved to the moved feet.
async function bakeFlat(name, file, model, reset, warp = 1, shape) {
  const a = await analyse(file, model, reset), frames = [], stats = { reach: 0, minBend: 180, maxBend: 0, ikError: 0 };
  let strikeAhead = 0;
  const legs = ['L', 'R'].map(s => ['Thigh', 'Calf', 'Foot'].map(b => a.prep.bones.get(`Bip01_${s}_${b}`)));
  const pelvisBone = a.prep.bones.get('Bip01_Pelvis'), timeAt = k => (a.leftStrike + k / FRAMES * a.T) % a.T;
  // Hips raised just enough that the supporting (lower) leg keeps its authored extension with the shorter stride:
  // without it the knees never straighten (a crouched run). Smoothed around the cycle so it adds no jitter.
  // Never more than any leg can take: each leg allows the raise that leaves it at 99% of its length.
  const raise = new Array(FRAMES).fill(0), limit = new Array(FRAMES).fill(Infinity);
  if (warp !== 1) {
    for (let k = 0; k < FRAMES; k++) {
      poseAt(a.source, a.mixer, a.action, a.prep, timeAt(k), a.travel); model.updateMatrixWorld(true);
      const hipZ = wp(pelvisBone).z;
      const need = legs.map(([thigh, calf, foot]) => {
        const H = wp(thigh), A = wp(foot), d = H.distanceTo(A), length = H.distanceTo(wp(calf)) + wp(calf).distanceTo(A);
        const horiz = Math.hypot(H.x - A.x, H.z - (hipZ + (A.z - hipZ) * warp)), drop = H.y - A.y;
        return { y: A.y, raise: Math.sqrt(Math.max(0, d * d - horiz * horiz)) - drop, limit: Math.sqrt(Math.max(0, (length * .99) ** 2 - horiz * horiz)) - drop };
      });
      raise[k] = Math.max(0, (need[0].y < need[1].y ? need[0] : need[1]).raise);
      limit[k] = Math.max(0, Math.min(need[0].limit, need[1].limit));
    }
    const smooth = raise.map((_, k) => { let sum = 0, w = 0; for (let j = -6; j <= 6; j++) { const g = Math.exp(-(j * j) / 18); sum += Math.min(raise[(k + j + FRAMES) % FRAMES], limit[(k + j + FRAMES) % FRAMES]) * g; w += g; } return sum / w; });
    raise.splice(0, FRAMES, ...smooth.map((r, k) => Math.min(r, limit[k])));
    // Levelled (shape.level): one even raise, not a second bounce of its own (capped where a leg cannot reach).
    if (shape?.level !== undefined) { const even = raise.reduce((t, r) => t + r, 0) / FRAMES; raise.forEach((_, k) => { raise[k] = Math.min(even, limit[k]); }); }
    console.log(`${name}: hips raised ${(Math.min(...raise) * 100).toFixed(1)}..${(Math.max(...raise) * 100).toFixed(1)} cm`);
  }
  // Hip line angles (twist about the vertical, tilt about the forward axis) and the shoulder line's twist.
  const hipsBone = legs[0][0].parent, line = (l, r) => ({ twist: Math.atan2(l.z - r.z, l.x - r.x), tilt: Math.atan2(l.y - r.y, l.x - r.x) });
  const hipLine = () => line(wp(legs[0][0]), wp(legs[1][0]));
  const arms = ['L', 'R'].map(s => a.prep.bones.get(`Bip01_${s}_UpperArm`)), chest = a.prep.bones.get('Bip01_Spine2'), headBone = a.prep.bones.get('Bip01_Head');
  const mean = { twist: 0, tilt: 0, shoulders: 0, shoulderTilt: 0, x: 0, y: 0, neckX: 0 };
  const neckBone = a.prep.bones.get('Bip01_Neck'), spine1 = a.prep.bones.get('Bip01_Spine1');
  if (shape) for (let k = 0; k < FRAMES; k++) {
    poseAt(a.source, a.mixer, a.action, a.prep, timeAt(k), a.travel); model.updateMatrixWorld(true);
    const h = hipLine(), p = wp(pelvisBone);
    mean.twist += h.twist / FRAMES; mean.tilt += h.tilt / FRAMES; { const sl = line(wp(arms[0]), wp(arms[1])); mean.shoulders += sl.twist / FRAMES; mean.shoulderTilt += sl.tilt / FRAMES; } mean.x += p.x / FRAMES; mean.y += p.y / FRAMES; mean.neckX += wp(neckBone).x / FRAMES;
  }
  const armRest = shape?.arms ? armMeans(a, Array.from({ length: FRAMES }, (_, j) => timeAt(j))) : undefined;
  // `level`: the share of the body's up-and-down bounce kept. The peaks come down freely; the low points (both feet
  // down, legs spread) rise only as far as both legs reach (98.5% of their length), so no planted foot leaves the
  // floor. Smoothed around the cycle, so it adds no jerk of its own.
  const lift = new Array(FRAMES).fill(0);
  if (shape?.level !== undefined) {
    const room = new Array(FRAMES).fill(Infinity);
    for (let k = 0; k < FRAMES; k++) {
      poseAt(a.source, a.mixer, a.action, a.prep, timeAt(k), a.travel); model.updateMatrixWorld(true);
      const p = wp(pelvisBone), dx = -(shape.sway ?? 0) * (p.x - mean.x);
      lift[k] = (mean.y - (shape.lower ?? 0) + shape.level * (p.y - mean.y)) - p.y;   // `lower`: hips carried that much lower
      legs.forEach(([thigh, calf, foot], i) => {
        const H = wp(thigh).add(new THREE.Vector3(dx, 0, 0)), A = wp(foot).add(new THREE.Vector3((i === 0 ? 1 : -1) * (shape.widen ?? 0), 0, 0));
        const length = wp(thigh).distanceTo(wp(calf)) + wp(calf).distanceTo(wp(foot)), horiz = Math.hypot(H.x - A.x, H.z - A.z);
        room[k] = Math.min(room[k], Math.sqrt(Math.max(0, (length * .985) ** 2 - horiz * horiz)) - (H.y - A.y));
      });
    }
    const capped = lift.map((d, k) => Math.min(d, room[k]));
    const smooth = capped.map((_, k) => { let sum = 0, w = 0; for (let j = -5; j <= 5; j++) { const g = Math.exp(-(j * j) / 8); sum += capped[(k + j + FRAMES) % FRAMES] * g; w += g; } return sum / w; });
    smooth.forEach((d, k) => { lift[k] = Math.min(d, room[k]); });
  }
  for (let k = 0; k < FRAMES; k++) {
    poseAt(a.source, a.mixer, a.action, a.prep, timeAt(k), a.travel); model.updateMatrixWorld(true);
    if (shape) {
      const feet = legs.map(([, , foot]) => ({ q: wq(foot), p: wp(foot) }));
      // The body's sideways sway (`sway` share taken out) and the top of its bounce (`bob` share of the rise over
      // the mean taken off): the whole body moves, the feet stay.
      if (shape.sway || shape.bob || shape.level !== undefined) {
        const p = wp(pelvisBone);
        p.x -= (shape.sway ?? 0) * (p.x - mean.x); p.y -= (shape.bob ?? 0) * Math.max(0, p.y - mean.y); p.y += lift[k];
        pelvisBone.parent.updateWorldMatrix(true, false); pelvisBone.position.copy(pelvisBone.parent.worldToLocal(p.clone())); model.updateMatrixWorld(true);
      }
      const upper = hipsBone.children.filter(c => c.isBone && !legs.some(([thigh]) => thigh === c)).map(c => [c, wq(c)]);
      // The hips alone (the torso keeps its own motion): a turn about the vertical changes the hip line's twist by
      // minus the turn; a turn about the forward axis changes its tilt by the turn.
      const h = hipLine();
      setWorldQ(hipsBone, new THREE.Quaternion().setFromAxisAngle(Y, (shape.calm ?? 0) * (h.twist - mean.twist))
        .multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD, -(shape.tilt ?? 0) * (h.tilt - mean.tilt))).multiply(wq(hipsBone)));
      for (const [c, q] of upper) setWorldQ(c, q);
      model.updateMatrixWorld(true);
      // The spine's own side lean above the hips (`lean` share taken out): the neck brought back over the mean line by
      // bending from the middle of the back; the head keeps its own orientation.
      if (shape.lean) {
        const head = wq(headBone), base = wp(spine1), top = wp(neckBone), d = top.x - mean.neckX, length = top.distanceTo(base);
        const angle = Math.asin(THREE.MathUtils.clamp(shape.lean * d / length, -.3, .3));
        setWorldQ(spine1, new THREE.Quaternion().setFromAxisAngle(FORWARD, angle).multiply(wq(spine1)));
        setWorldQ(headBone, head); model.updateMatrixWorld(true);
      }
      // The chest's own turn (`shoulders`: negative calms it) and roll (`roll` share taken out); the head keeps its own.
      if (shape.shoulders || shape.roll) {
        // (On this rig the collarbones hang from the neck: the head alone is held, the arms go with the chest.)
        const head = wq(headBone), sl = line(wp(arms[0]), wp(arms[1]));
        setWorldQ(chest, new THREE.Quaternion().setFromAxisAngle(Y, -(shape.shoulders ?? 0) * (sl.twist - mean.shoulders))
          .multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD, -(shape.roll ?? 0) * (sl.tilt - mean.shoulderTilt))).multiply(wq(chest)));
        setWorldQ(headBone, head); model.updateMatrixWorld(true);
      }
      legs.forEach(([thigh, calf, foot], i) => { const { q, p } = feet[i]; p.x += (i === 0 ? 1 : -1) * (shape.widen ?? 0); solveLeg(thigh, calf, foot, p, q, stats); });
      model.updateMatrixWorld(true);
    }
    if (shape?.arms) { calmArms(armRest, shape.arms); model.updateMatrixWorld(true); }
    if (warp !== 1) {
      // Feet first (they stay where the clip puts them), then the hips go up.
      const feetBefore = legs.map(([, , foot]) => ({ q: wq(foot), p: wp(foot) }));
      const lifted = wp(pelvisBone); lifted.y += raise[k];
      // worldToLocal() rewrites its argument: hand it a copy, \`lifted\` stays in world space.
      pelvisBone.parent.updateWorldMatrix(true, false); pelvisBone.position.copy(pelvisBone.parent.worldToLocal(lifted.clone()));
      model.updateMatrixWorld(true);
      const hipZ = lifted.z;
      legs.forEach(([thigh, calf, foot], i) => { const { q, p } = feetBefore[i]; solveLeg(thigh, calf, foot, p.setZ(hipZ + (p.z - hipZ) * warp), q, stats); });
      model.updateMatrixWorld(true);
    }
    // No shoe below the floor (y = 0 here, where the idle shoes stand): a dipping shoe is set onto it by its own leg.
    // (The run's landing shoe went ~3 cm under; the runtime then lifted the whole body to clear it, a 4 cm hop on
    // every footfall.)
    if (shape) for (let side = 0; side < 2; side++) for (let i = 0; i < 3; i++) {
      const below = -shoeBottom(model, side); if (below <= .0005) break;
      const [thigh, calf, foot] = legs[side], q = wq(foot), target = wp(foot); target.y += below;
      solveLeg(thigh, calf, foot, target, q, stats); model.updateMatrixWorld(true);
    }
    // Where the left foot lands (centre of heel and toe joints), ahead of the root, at the strike.
    if (k === 0) strikeAhead = (wp(a.prep.bones.get('Bip01_L_Foot')).z + wp(a.prep.bones.get('Bip01_L_Toe0')).z) / 2;
    frames.push(record(a.prep));
  }
  reset();
  if (shape) console.log(`${name}: shape ${JSON.stringify(shape)}, knee ${stats.minBend.toFixed(0)}..${stats.maxBend.toFixed(0)} deg, reach ${stats.reach.toFixed(3)}, IK error ${(stats.ikError * 1000).toFixed(1)} mm`);
  if (warp !== 1) console.log(`${name}: stride warp ${warp}, knee ${stats.minBend.toFixed(0)}..${stats.maxBend.toFixed(0)} deg, reach ${stats.reach.toFixed(3)}, IK error ${(stats.ikError * 1000).toFixed(1)} mm`);
  const distance = a.total.z * a.scale * warp;
  return { meta: { name, kind: 'flat', frames: FRAMES, cycleDistance: +distance.toFixed(4), naturalSpeed: +(distance / a.T).toFixed(3), strikeAhead: +strikeAhead.toFixed(4), contacts: a.contacts }, data: frames,
    meanHip: a.samples.reduce((s, x) => s + x.pelvis.y, 0) / a.samples.length };
}

// ---------- stair clip fitted to one target flight
function bakeStairs(gait, variant, model, reset, a, flatHip, hipDrop = 0) {
  const dir = gait.direction, { riser: R, going: G, radius } = variant, curved = variant.flight === 'spiral';
  const G0 = a.total.z * a.scale / 2, R0 = Math.abs(a.total.y * a.scale) / 2, kappa = R0 > .01 ? R / R0 : 1;
  const sigma = dir > 0 ? -1 : 1;   // spiral: going up turns right (centre on the right), down turns left
  const at = phase => {   // ground-frame sample at an unwrapped phase from the left strike
    const time = a.leftStrike + phase * a.T, lap = Math.floor(time / a.T), k = Math.round(mod1(time / a.T) * a.n) % a.n;
    const shift = a.total.clone().multiplyScalar(a.scale * lap), s = a.samples[k];
    return { time: mod1(time / a.T) * a.T, feet: s.feet.map(f => ({ heel: f.heel.clone().add(shift), toe: f.toe.clone().add(shift) })), pelvis: s.pelvis.clone().add(shift) };
  };
  // Lowest point of the shoe: its heel and toe joints over their flat-sole heights, and the shoe's two ends, which
  // reach below them when it pitches (heel strike with the toes up puts the back edge of the heel 4-6 cm lower).
  const sole = f => { const h = f.heel.y - a.heelRest, t = f.toe.y - a.toeRest, slope = (t - h) / f.heel.distanceTo(f.toe); return Math.min(h, t, h - slope * SHOE_BACK, t + slope * SHOE_FRONT); };
  const centre = f => f.heel.clone().add(f.toe).multiplyScalar(.5);
  const start = at(0), z0 = centre(start.feet[0]).z, sole0 = sole(start.feet[0]);
  const uOf = z => (z - z0) / G0 + .5;
  const sourceLine = u => sole0 + dir * R0 * (u - .5);
  const rootU = phase => uOf(at(0).pelvis.z) + 2 * phase - (at(0).pelvis.z - (a.travel(a.leftStrike).z * a.scale + 0)) * 0;
  // The root advances exactly two treads per cycle; anchor it where the hips are at the left strike.
  const u0 = uOf(a.travel(a.leftStrike).z * a.scale + (start.pelvis.z - a.travel(a.leftStrike).z * a.scale));
  const uRootAt = phase => u0 + 2 * phase;
  // Tread a foot is on (cyclic contact model): planted on `base`, or swinging from base to base + 2.
  const tread = (s, phase) => {
    const c = a.contacts[s], t0 = s, d = mod1(phase - c.phase), base = phase >= c.phase ? t0 : t0 - 2;
    return d <= c.duration ? { planted: true, base, progress: 0 } : { planted: false, base, progress: (d - c.duration) / (1 - c.duration) };
  };
  // Target geometry, relative to the root's line height: tread top at u, and the line.
  const top = (u, uRoot) => dir * R * (Math.floor(u) + .5 - uRoot);
  const line = (u, uRoot) => dir * R * (u - uRoot);
  const place = (u, uRoot, lateral, height) => {
    const along = (u - uRoot) * G;
    if (!curved) return new THREE.Vector3(lateral, height, along);
    const alpha = along / radius, rho = radius - sigma * lateral;
    return new THREE.Vector3(sigma * radius - sigma * rho * Math.cos(alpha), height, rho * Math.sin(alpha));
  };
  const yawAt = (u, uRoot) => curved ? sigma * (u - uRoot) * G / radius : 0;
  // Mean hip height above the line, source and target (between the source's and flat walking's).
  let meanHip = 0; for (let k = 0; k < FRAMES; k++) { const s = at(k / FRAMES); meanHip += (s.pelvis.y - sourceLine(uRootAt(k / FRAMES))) / FRAMES; }
  // The rebuilt descent's own hips sit as low as its squat: take the climbing hip height for this flight, 2 cm lower.
  const targetHip = (gait.rebuild ? (R0 > .01 ? a.climbHip(R) - .02 : meanHip) : flatHip + (meanHip - flatHip) * kappa) - hipDrop;
  // Pass 1: target sole heights and foot centres for every frame, before clearance.
  const plan = [];
  for (let k = 0; k < FRAMES; k++) {
    const phase = k / FRAMES, s = at(phase), uRoot = uRootAt(phase);
    plan.push({ phase, s, uRoot, feet: s.feet.map((f, side) => {
      const c = centre(f), u = uOf(c.z);
      let height;
      if (!gait.rebuild) height = line(u, uRoot) + (sole(f) - sourceLine(u)) * kappa;
      else {
        // Rebuilt descent: sole = the tread it is on (dropping late in the swing) + the clip's own lift.
        const t = tread(side, phase), from = t.base, to = t.base + (t.planted ? 0 : 2);
        // Up: rise early, the foot has to get over the next step. Down: the foot first travels out over the step
        // (see the descent pass below), then lowers onto its tread in the second half of the swing.
        const level = from + (to - from) * (dir > 0 ? smoother((t.progress - .05) / .6) : smoother((t.progress - .5) / .45));
        // The capture's own lift fades out by 85% of the swing: the foot is over its new tread by 75% (descent pass) and
        // now comes down onto it there, heel first, instead of hanging 4-5 cm above it until the footfall (with the other
        // foot already gone from its tread, both feet were up 42% of the time: a float).
        height = dir * R * (level + .5 - uRoot) + Math.max(0, sole(f)) * (1 - THREE.MathUtils.smoothstep(t.progress, .55, .85));
      }
      // Toe-out: the foot's yaw from the way of travel, capped (left foot turns out to +x, right to -x).
      // A steep foot (toe-off, swing) has no meaningful heading: its heel-to-toe line is nearly vertical and
      // atan2 of that short horizontal part spins at random (a 174 deg foot flip). Correct only feet near flat.
      const hx = f.toe.x - f.heel.x, hz = f.toe.z - f.heel.z, trust = THREE.MathUtils.smoothstep(Math.hypot(hx, hz), .05, .09);
      const yaw = Math.atan2(hx, hz), capped = THREE.MathUtils.clamp(yaw, side ? -TOE_OUT : -.02, side ? .02 : TOE_OUT);
      return { f, c, u, height, planted: tread(side, phase).planted, ankleAboveSole: f.heel.y - sole(f), toeFix: (capped - yaw) * trust,
        heelSole: f.heel.y - a.heelRest, toeSole: f.toe.y - a.toeRest };
    }) });
  }
  // Toe-out is corrected where a foot stands (planted); a swinging foot can point down or even backwards, where its
  // heading means nothing. The correction is spread over 4 frames either side so it fades in and out.
  for (let side = 0; side < 2; side++) {
    const raw = plan.map(p => p.feet[side].planted ? p.feet[side].toeFix : 0);
    plan.forEach((p, k) => {
      let sum = 0, weight = 0;
      for (let j = -4; j <= 4; j++) { const w = Math.cos(j / 5 * Math.PI / 2) ** 2; sum += raw[(k + j + FRAMES) % FRAMES] * w; weight += w; }
      p.feet[side].toeFix = sum / weight;
    });
  }
  // Pass 1b: foot locking. During each contact the foot is pinned to the centre of its tread, flat on its top,
  // at the contact's mean lateral position; it eases in and out over 3 frames either side of the contact.
  const footOffsets = [];   // where the planted foot's centre stands, from its tread's centre (treads): the runtime lines the floor walk up with it
  const lockRuns = [];      // each contact's lock (the stand poses below put the feet back where they stood)
  for (let side = 0; side < 2; side++) {
    const runs = []; let current;
    plan.forEach((p, k) => { if (p.feet[side].planted) { if (!current) runs.push(current = []); current.push(k); } else current = undefined; });
    if (runs.length > 1 && plan[0].feet[side].planted && plan[FRAMES - 1].feet[side].planted) {   // a contact across the cycle seam
      const first = runs.shift(); runs[runs.length - 1].push(...first.map(k => k + FRAMES));
    }
    for (const run of runs) {
      const midK = run[Math.floor(run.length / 2)], mid = plan[midK % FRAMES].feet[side], lap = Math.floor(midK / FRAMES);
      // Tread centre (in the coordinates of the run's first cycle), moved off the rising riser if the shoe is too long:
      // up, the toe faces it (the heel then overhangs the nose behind); down, the heel does (the toe overhangs ahead).
      const halfJoints = run.reduce((sum, k) => { const f = plan[k % FRAMES].feet[side].f; return sum + Math.hypot(f.toe.x - f.heel.x, f.toe.z - f.heel.z); }, 0) / run.length / 2;
      // (Down, the heel lands first with the toe raised, which carries its back edge further back: 2.5 cm off.)
      // (Up, the back foot rolls off its toe and the flexing toes push the shoe tip forward: 6 cm off the riser ahead.)
      const offRiser = dir > 0 ? -Math.max(0, halfJoints + SHOE_FRONT + RISER_GAP + .05 - G / 2) : Math.max(0, halfJoints + SHOE_BACK + RISER_GAP + .015 - G / 2);
      const uLock = Math.floor(mid.u + 2 * lap) + .5 + offRiser / G;
      footOffsets.push(offRiser / G);
      const lateral = run.reduce((sum, k) => sum + plan[k % FRAMES].feet[side].c.x, 0) / run.length;
      // The flattest frame of the contact: heel and toe offsets from the foot centre there are where they rest.
      const flat = run.map(k => plan[k % FRAMES].feet[side]).reduce((best, ft) => Math.abs(ft.heelSole - ft.toeSole) < Math.abs(best.heelSole - best.toeSole) ? ft : best);
      const rest = { heel: flat.f.heel.clone().sub(flat.c).setY(0).applyAxisAngle(Y, flat.toeFix), toe: flat.f.toe.clone().sub(flat.c).setY(0).applyAxisAngle(Y, flat.toeFix) };
      lockRuns.push({ side, frames: run, uLock, lateral, rest, offRiser, flatK: run.find(k => plan[k % FRAMES].feet[side] === flat) % FRAMES });
      for (let j = -3; j <= run.length + 2; j++) {
        const k = run[0] + j, p = plan[((k % FRAMES) + FRAMES) % FRAMES], ft = p.feet[side];
        const u = uLock - 2 * Math.floor(k / FRAMES);   // the same tread seen from the next cycle is two treads back
        const weight = j < 0 ? smoother((j + 4) / 4) : j >= run.length ? smoother((run.length + 3 - j) / 4) : 1;
        const height = dir * R * (Math.floor(u - offRiser / G) + .5 - p.uRoot);   // the tread it stands on
        ft.u += (u - ft.u) * weight; ft.height += (height - ft.height) * weight;
        const x0 = ft.lockX ?? ft.c.x; ft.lockX = x0 + (lateral - x0) * weight;
        ft.lockWeight = Math.max(ft.lockWeight ?? 0, weight); ft.rest = rest; ft.uLockCentre = u;
        if (weight === 1) ft.planted = true;
      }
    }
  }
  // Descent: a swinging foot reaches its new tread horizontally by 75% of the swing and then lowers onto it, as
  // people step down (the shoe is longer than the tread, so it cannot come down while still over the edge). It
  // travels between exactly the spots the contacts pin it to (blended into their lock ramps).
  for (let side = 0; side < 2; side++) {
    const arrive = .75;   // up and down: over the new tread by 75% of the swing, then set down (no skimming)
    const at = k => plan[((k % FRAMES) + FRAMES) % FRAMES].feet[side];
    const pin = k => at(k).uLockCentre + 2 * Math.floor(k / FRAMES);   // unwrapped across the cycle seam
    for (let k0 = 0; k0 < FRAMES; k0++) {
      if (at(k0).planted || !at(k0 - 1).planted) continue;   // k0: first frame of a swing
      let k1 = k0; while (!at(k1 + 1).planted && k1 < k0 + FRAMES) k1++;
      const uA = pin(k0 - 1), uB = pin(k1 + 1), length = k1 - k0 + 2;
      for (let k = k0; k <= k1; k++) {
        const ft = at(k), p = (k - k0 + 1) / length, w = ft.lockWeight ?? 0;
        const travel = uA + (uB - uA) * smoother(Math.min(1, p / arrive)) - 2 * Math.floor(k / FRAMES);
        ft.u = w > 0 ? travel * (1 - w) + ft.uLockCentre * w : travel;
      }
    }
  }
  // Pass 2: clearance. Wherever a swinging sole would pass < 3 cm over the step under its heel or toe, lift it,
  // spreading the lift over neighbouring frames so it rises and lowers smoothly.
  for (let side = 0; side < 2; side++) {
    const deficit = plan.map(p => {
      const ft = p.feet[side]; if (ft.planted) return 0;
      // Five points along the shoe: back end, heel, middle, toe, front end; each at its own height (the shoe pitches).
      const f = ft.f, along = new THREE.Vector3().subVectors(f.toe, f.heel), length = along.length(); along.divideScalar(length);
      const slope = (ft.toeSole - ft.heelSole) / length, low = Math.min(ft.heelSole, ft.toeSole);
      const points = [[f.heel.z - along.z * SHOE_BACK, ft.heelSole - slope * SHOE_BACK], [f.heel.z, ft.heelSole], [ft.c.z, (ft.heelSole + ft.toeSole) / 2],
        [f.toe.z, ft.toeSole], [f.toe.z + along.z * SHOE_FRONT, ft.toeSole + slope * SHOE_FRONT]];
      // Clearance over the edges it crosses; over the tread it leaves or lands on it only has to stay out of it.
      const t = tread(side, p.phase), own = [t.base, t.base + 2];
      return Math.max(0, ...points.map(([z, sole]) => { const u = ft.u + (z - ft.c.z) / G; return top(u, p.uRoot) + (own.includes(Math.floor(u)) ? 0 : CLEARANCE) - (ft.height + sole - low); }));
    });
    // Spread 6 frames ahead of a need (the shoe rises before the edge) but only 1 after it: held longer, a shoe over
    // its new tread hung 4-6 cm above it until the footfall while the other had already left (both feet up 43% of
    // the time on a flight).
    const lift = deficit.map((_, k) => { let m = 0; for (let j = -1; j <= 6; j++) { const d = deficit[(k + j + FRAMES) % FRAMES]; if (d > 0) m = Math.max(m, d * Math.cos(j / 7 * Math.PI / 2) ** 2); } return m; });
    plan.forEach((p, k) => { const ft = p.feet[side]; if (!ft.planted) ft.height += lift[k] * (1 - (ft.lockWeight ?? 0)); });
  }
  // The target flight in its own coordinates (tread coordinate, distance from the path, height) and its tread tops.
  const geo = { uRootAt, top: (t, uRoot) => dir * R * (t + .5 - uRoot), where(P, uRoot) {
    if (!curved) return { u: uRoot + P.z / G, across: P.x, h: P.y, going: G };
    const cx = sigma * radius, vx = P.x - cx, across = Math.hypot(vx, P.z);
    return { u: uRoot + Math.atan2(P.z, -sigma * vx) * radius / G, across, h: P.y, going: G * across / radius };
  } };
  // How far a swinging shoe must rise, measured on the shoe mesh itself: CLEARANCE over the treads it crosses, out of
  // the ones it leaves and lands on. (The five-point shoe of pass 2 misses where its toes bend at push-off: there the
  // tip reaches 2-3 cm further forward than the foot's line, into the nose of the step it crosses.)
  shoeBottom(model, 0);
  const meshNeed = (side, p) => {
    const t = tread(side, p.phase), own = [t.base, t.base + 2], v = new THREE.Vector3();
    let need = 0;
    for (const [mesh, index] of shoeVertices.get(model)[side]) {
      const q = geo.where(mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld), p.uRoot), j = Math.floor(q.u);
      // The tread it leaves gets the clearance too once the swing is under way: a level shoe leaving its step going
      // down otherwise dragged its heel along it (3.8 cm, on the tightest spiral line).
      const leaving = j === t.base && !t.planted ? CLEARANCE * smoother((t.progress - .08) / .2) : 0;
      need = Math.max(need, geo.top(j, p.uRoot) + (j === t.base + 2 ? 0 : j === t.base ? leaving : CLEARANCE) - q.h);
    }
    return need;
  };
  // Pass 3: pose, hips, leg solve.
  const legs = ['L', 'R'].map(s => ['Thigh', 'Calf', 'Foot'].map(b => a.prep.bones.get(`Bip01_${s}_${b}`)));
  const pelvis = a.prep.bones.get('Bip01_Pelvis');
  // Off the ground a foot stays near level (within about FOOT_PITCH of how it stands flat, toe up or down). The floor
  // walk's foot points its toe 40-55 deg down after push-off and swings it steeply up before the heel strike: on
  // flat ground that is hidden, on a staircase the shoe's tip pointed at the step it swung over and landed on.
  // Pitch: the heel-to-toe joint line against the horizontal; the limit is soft (exponential), fading out as the foot
  // locks onto its tread.
  const flatFoot = [0, 1].map(side => {
    const r = lockRuns.find(r => r.side === side);
    poseAt(a.source, a.mixer, a.action, a.prep, plan[r.flatK].s.time, a.travel); model.updateMatrixWorld(true);
    const q = wq(legs[side][2]), inverse = q.clone().invert(), toe = wp(a.prep.bones.get(`Bip01_${'LR'[side]}_Toe0`)).sub(wp(legs[side][2])).setY(0).normalize();
    // The foot's own axes, as it stands flat: forward (level, along the shoe) and across.
    return { local: toe.clone().applyQuaternion(inverse), across: new THREE.Vector3().crossVectors(Y, toe).normalize().applyQuaternion(inverse), pitch: 0 };
  });
  // The capture's foot also flicks 10-15 deg for a single frame (frames 30 and 42 of the cycle): the pitch is smoothed
  // over neighbouring frames before the limit, so the shoe tip never twitches.
  const target = [0, 1].map(side => {
    const raw = plan.map(p => { poseAt(a.source, a.mixer, a.action, a.prep, p.s.time, a.travel); model.updateMatrixWorld(true); return footPitch(wq(legs[side][2]), flatFoot[side].local) - flatFoot[side].pitch; });
    return raw.map((_, k) => {
      let sum = 0, weight = 0;
      for (let j = -3; j <= 3; j++) { const g = Math.exp(-(j * j) / 4); sum += raw[(k + j + FRAMES) % FRAMES] * g; weight += g; }
      const rel = sum / weight;
      return rel < 0 ? -FOOT_PITCH * (1 - Math.exp(rel / FOOT_PITCH)) : FOOT_PITCH * (1 - Math.exp(-rel / FOOT_PITCH));
    });
  });
  const levelFoot = (q, side, free, k) => {
    const { local, pitch } = flatFoot[side], rel = footPitch(q, local) - pitch;
    const goal = rel + (target[side][k] - rel) * free;
    // Turned across the foot, both ways tried, the closer kept, repeated until on target (one turn fell 12 deg short
    // where the capture's foot points steepest).
    for (let i = 0; i < 4; i++) {
      const miss = goal - (footPitch(q, local) - pitch);
      if (Math.abs(miss) < 1e-4) break;
      const axis = flatFoot[side].across.clone().applyQuaternion(q);   // the foot's own across axis
      const turned = [miss, -miss].map(angle => new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(q));
      q = turned.reduce((best, c) => Math.abs(goal - (footPitch(c, local) - pitch)) < Math.abs(goal - (footPitch(best, local) - pitch)) ? c : best);
    }
    return q;
  };
  const stairArms = armMeans(a, plan.map(p => p.s.time));
  const solve = () => {
    const stats = { reach: 0, minBend: 180, maxBend: 0, ikError: 0, sink: 0, hover: 0, clearance: Infinity, drift: 0, track: {} }, frames = [], need = [[], []];
    for (const p of plan) {
      poseAt(a.source, a.mixer, a.action, a.prep, p.s.time, a.travel); model.updateMatrixWorld(true);
      // The clip's own foot orientations, read before the hips turn and the spine leans (the thighs hang from the spine).
      const clipFootQ = legs.map(leg => wq(leg[2]));
      const hipU = uOf(p.s.pelvis.z), bob = (p.s.pelvis.y - sourceLine(p.uRoot) - meanHip) * kappa;
      const hips = place(hipU, p.uRoot, p.s.pelvis.x, targetHip + bob);
      if (curved) setWorldQ(pelvis, new THREE.Quaternion().setFromAxisAngle(Y, yawAt(hipU, p.uRoot)).multiply(wq(pelvis)));
      pelvis.parent.updateWorldMatrix(true, false); pelvis.position.copy(pelvis.parent.worldToLocal(hips.clone())); model.updateMatrixWorld(true);
      // Lean into the climb (and a little over the descent), from the lower spine: the legs are solved after.
      if (gait.lean) { const spine = a.prep.bones.get('Bip01_Spine'); setWorldQ(spine, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), gait.lean * Math.PI / 180).multiply(wq(spine))); model.updateMatrixWorld(true); }
      // The arms swing as the floor walk's do (a smaller swing than the capture's).
      calmArms(stairArms, ARM_SWING); model.updateMatrixWorld(true);
      p.feet.forEach((ft, side) => {
        const yaw = new THREE.Quaternion().setFromAxisAngle(Y, yawAt(ft.u, p.uRoot)), fix = new THREE.Quaternion().setFromAxisAngle(Y, ft.toeFix);
        const footQ = levelFoot(yaw.clone().multiply(fix).multiply(clipFootQ[side]), side, (1 - (ft.lockWeight ?? 0)) ** 3, plan.indexOf(p));   // gone before the foot touches: turning a touching shoe slid it   // gone before the foot touches: turning a touching shoe slid it
        if (process.env.FOOTDBG && `${gait.name}:${variant.flight}` === process.env.FOOTDBG && side === 0) { const k = plan.indexOf(p), raw = yaw.clone().multiply(fix).multiply(clipFootQ[side]); globalThis.__dbg ??= {}; const prev = globalThis.__dbg[k - 1]; if (prev) console.log('FOOT', k, 'raw step', (2 * Math.acos(Math.min(1, Math.abs(raw.dot(prev.raw)))) * 180 / Math.PI).toFixed(1), 'fixed step', (2 * Math.acos(Math.min(1, Math.abs(footQ.dot(prev.got)))) * 180 / Math.PI).toFixed(1), 'pitch', ((footPitch(footQ, flatFoot[0].local) - flatFoot[0].pitch) * 180 / Math.PI).toFixed(1)); globalThis.__dbg[k] = { raw, got: footQ.clone() }; }
        const centreTarget = place(ft.u, p.uRoot, ft.lockX ?? ft.c.x, ft.height);
        // Free foot: ankle at the centre plus its own (toe-corrected) heel offset.
        const free = ft.f.heel.clone().sub(ft.c).setY(0).applyAxisAngle(Y, ft.toeFix).applyQuaternion(yaw);
        let ankleXZ = centreTarget.clone().add(free);
        if (ft.lockWeight && ft.rest) {
          // Planted: pin the point that carries the foot. Heel down: the ankle (heel joint) stays where it rests.
          // Toe down (heel rising): the toe stays, the ankle swings about it. Blended by which is lower.
          const centre = place(ft.uLockCentre, p.uRoot, ft.lockX ?? ft.c.x, 0);
          const heelPin = centre.clone().add(ft.rest.heel.clone().applyQuaternion(yaw));
          const toePin = centre.clone().add(ft.rest.toe.clone().applyQuaternion(yaw));
          const ankleFromToe = toePin.add(ft.f.heel.clone().sub(ft.f.toe).setY(0).applyAxisAngle(Y, ft.toeFix).applyQuaternion(yaw));
          const toeCarries = THREE.MathUtils.smoothstep(ft.heelSole - ft.toeSole, -.004, .004);
          const pinned = heelPin.lerp(ankleFromToe, toeCarries);
          ankleXZ = ankleXZ.lerp(pinned, ft.lockWeight);
        }
        const ankle = ankleXZ; ankle.y = ft.height + ft.ankleAboveSole;
        solveLeg(legs[side][0], legs[side][1], legs[side][2], ankle, footQ, stats, FORWARD.clone().applyQuaternion(yaw));
        // In the air the toe joint relaxes to his idle pose (the capture curls it down after push-off: with the foot
        // levelled that still pointed the shoe tip), coming back to the capture's as the foot locks onto its tread.
        { const free = 1 - (ft.lockWeight ?? 0), toe = a.prep.bones.get(`Bip01_${'LR'[side]}_Toe0`);
          if (free > 0) { toe.quaternion.slerp(a.prep.idleLocal.get(toe.name), free); toe.updateMatrixWorld(true); } }
        // Landing: as it comes over its new tread (fully by `arrive`, 75%), the shoe settles onto it (only the part already
        // over it is measured: nothing can be pushed into a step), its gap shrinking to nothing by 80% of the
        // swing, and waits there for the footfall. (It hung 2-4 cm above it until then while the other foot had already
        // started to roll off its tread: both feet up for a fifth of every step, a float up the stairs.)
        { const t = tread(side, p.phase);
          if (!t.planted && t.progress > .55) {
            const keep = 1 - THREE.MathUtils.smoothstep(t.progress, .55, .8), landing = t.base + 2, v = new THREE.Vector3();
            let goal;
            for (let i = 0; i < 3; i++) {
              model.updateMatrixWorld(true);
              let low = Infinity;
              for (const [mesh, index] of shoeVertices.get(model)[side]) { const q = geo.where(mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld), p.uRoot); if (Math.floor(q.u) === landing) low = Math.min(low, q.h - geo.top(landing, p.uRoot)); }
              if (!Number.isFinite(low)) break;
              goal ??= Math.max(0, low) * keep;   // the gap it is allowed now
              if (low - goal < .001) break;
              ankle.y -= low - goal;
              solveLeg(legs[side][0], legs[side][1], legs[side][2], ankle, footQ, stats, FORWARD.clone().applyQuaternion(yaw));
            }
          } }
      });
      model.updateMatrixWorld(true);
      // Verify against the target flight in its own coordinates: tread coordinate, distance from the path, height.
      p.feet.forEach((ft, side) => {
        const heel = wp(legs[side][2]), toe = wp(a.prep.bones.get('Bip01_' + 'LR'[side] + '_Toe0'));
        const where = P => {
          if (!curved) return { u: p.uRoot + P.z / G, across: P.x, h: P.y };
          const cx = sigma * radius, vx = P.x - cx, angle = Math.atan2(P.z, -sigma * vx);
          return { u: p.uRoot + angle * radius / G, across: Math.hypot(vx, P.z), h: P.y };
        };
        const H = where(heel), To = where(toe), soleMin = Math.min(H.h - a.heelRest, To.h - a.toeRest);
        const under = Math.max(top(H.u, p.uRoot), top(To.u, p.uRoot));
        if (ft.planted) {
          stats.sink = Math.max(stats.sink, under - soleMin); stats.hover = Math.max(stats.hover, soleMin - under);
          const pivot = H.h - a.heelRest < To.h - a.toeRest ? H : To;
          (stats.track[side + ':' + Math.round(ft.u * 4)] ??= []).push({ along: pivot.u * G, across: pivot.across, which: pivot === H ? 'heel' : 'toe' });
        } else stats.clearance = Math.min(stats.clearance, soleMin - under);
        need[side].push(ft.planted ? 0 : meshNeed(side, p));
      });
      frames.push(record(a.prep));
    }
    for (const list of Object.values(stats.track)) {
      // Slide of whichever point carries the foot, while it carries it (heel strike, then toe at push-off).
      for (const which of ['heel', 'toe']) {
        const part = list.filter(q => q.which === which); if (part.length < 2) continue;
        const xs = part.map(q => q.along), ys = part.map(q => q.across);
        stats.drift = Math.max(stats.drift, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
      }
    }
    delete stats.track;
    // Half-way between frames as well, as the runtime interpolates them: a toe crossing a nose moves several cm a frame.
    plan.forEach((p, k) => {
      const half = { phase: (k + .5) / FRAMES, uRoot: uRootAt((k + .5) / FRAMES) }, next = plan[(k + 1) % FRAMES];
      poseFrame(a.prep, frames, k + .5); model.updateMatrixWorld(true);
      p.feet.forEach((ft, side) => {
        if (ft.planted || next.feet[side].planted) return;
        const n = meshNeed(side, half); need[side][k] = Math.max(need[side][k], n); need[side][(k + 1) % FRAMES] = Math.max(need[side][(k + 1) % FRAMES], n);
      });
    });
    return { stats, frames, need };
  };
  // Pass 4: the shoe mesh. Wherever a swinging shoe is short of its clearance, lift it there (spread over neighbouring
  // frames as in pass 2) and solve the legs again, until every swinging shoe clears.
  let { stats, frames, need } = solve();
  for (let round = 0; round < 6; round++) {
    // Spread 6 frames ahead of a need (the shoe rises before the edge) but only 1 after it: held longer, a shoe over
    // its new tread hung 4-6 cm above it until the footfall while the other had already left (both feet up 43% of
    // the time on a flight).
    const lift = need.map(list => list.map((_, k) => { let m = 0; for (let j = -1; j <= 6; j++) { const d = list[(k + j + FRAMES) % FRAMES]; if (d > 0) m = Math.max(m, d * Math.cos(j / 7 * Math.PI / 2) ** 2); } return m; }));
    if (process.env.TRUTH && `${gait.name}:${variant.flight}:${variant.radius}` === process.env.TRUTH) console.log('round', round, 'need', need.map(l => (Math.max(...l) * 100).toFixed(2)).join(' '));
    if (Math.max(...need.flat()) < .001) break;
    plan.forEach((p, k) => p.feet.forEach((ft, side) => { if (!ft.planted) ft.height += lift[side][k] * (1 - (ft.lockWeight ?? 0)); }));
    ({ stats, frames, need } = solve());
  }
  // The shoes themselves, as the runtime plays the clip.
  const truth = shoeTruth(model, a.prep, frames, geo);
  stats.vertexSink = truth.sink; stats.vertexSlide = truth.slide;
  if (process.env.ENTRYDBG && `${gait.name}:${variant.flight}:${variant.radius}` === process.env.ENTRYDBG) {
    // Joining a flight upwards (the windows in locomotionClips.ts): ENTRYDBG=up-walk:<flight>:<radius> SIDE=0|1 prints,
    // for the left foot swinging from tread 0 to tread 2 (right: 1 to 3) and the body's position from the first riser
    // of a flight it is joining, the shoe's lowest point over the middle tread (the floor there) and its tip from the
    // riser it lands behind (treads).
    const side = +(process.env.SIDE ?? 0);
    for (let i = 0; i < FRAMES * 8; i++) {
      const x = i / 4, phase = x / FRAMES, uRoot = uRootAt(phase); poseFrame(a.prep, frames, x); model.updateMatrixWorld(true);
      let low = Infinity, tip = -Infinity; const v = new THREE.Vector3();
      for (const [mesh, index] of shoeVertices.get(model)[side]) { const q = geo.where(mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld), uRoot); low = Math.min(low, q.h - geo.top(1 + side, uRoot)); tip = Math.max(tip, q.u); }
      console.log('ENTRY phase', phase.toFixed(3), 'U(entry)', (uRoot - 2 - side).toFixed(3), 'low over floor', (low * 100).toFixed(1), 'tip-riser', (tip - 2 - side).toFixed(3));
    }
  }
  // Standing on the flight. The walk has no double support: at either footfall the trailing shoe is already 4-8 cm
  // off its tread (down: up to 18 cm), so no frame of the cycle can be stood in. These poses (the runtime blends to
  // them as the visitor comes to rest) freeze the stride with both shoes flat on their treads, at whichever of two
  // moments needs the hips lowered least: the footfall (the leading foot just landed, the trailing one set back down
  // where it stood) or the last frame before it that the trailing foot stands in (the leading one set down where it
  // is about to land). Going up, the trailing leg is straight at the footfall and its heel up: flat, it only reached
  // with the hips 8-10 cm lower; just before, the swinging leg is bent and simply reaches down. Each pose is sampled
  // with the root a little either side of its moment (STAND_DELTAS, cycle phase), wherever he comes to rest: the
  // feet stay on their treads and the body stands further back or forward over them.
  const stand = [], standStats = { gap: 0, depth: 0, reach: 0, drop: 0, moments: [] }, standPhases = [];
  // Where a foot stands at frame K (cycle-0 coordinates): in the contact it is in or lands in next (next), or the one
  // it stands in or last stood in. The same contact m cycles on stands 2m treads further.
  const spotAt = (side, K, next) => {
    let best;
    for (const r of lockRuns.filter(r => r.side === side)) for (const m of next ? [0, 1] : [-1, 0]) {
      const first = r.frames[0] + m * FRAMES, last = r.frames[r.frames.length - 1] + m * FRAMES;
      const away = next ? (K <= last ? Math.max(0, first - K) : Infinity) : (K >= first ? Math.max(0, K - last) : Infinity);
      if (away < (best?.away ?? Infinity)) best = { r, away, u: r.uLock + 2 * m };
    }
    return best;
  };
  const standPose = (K, lead, delta) => {
    const p = plan[K], hipU = uOf(p.s.pelvis.z), bob = (p.s.pelvis.y - sourceLine(p.uRoot) - meanHip) * kappa, uRoot = uRootAt(K / FRAMES + delta);
    const spots = [0, 1].map(side => spotAt(side, K, side === lead));
    // Each foot as it stands flattest in its contact: the clip's own orientation there.
    const footQ = spots.map(({ r }, side) => { poseAt(a.source, a.mixer, a.action, a.prep, plan[r.flatK].s.time, a.travel); model.updateMatrixWorld(true); return wq(legs[side][2]); });
    // The walk's own trailing foot at this moment: still over its tread and only a little above it (up: standing on
    // it; down at the left footfall: 4 cm up, heel rising), the stand keeps it exactly so, set straight down: setting
    // off again then just lifts it. (Turned flat, the blend back pitched the shoe about the ankle and its toe went 2-3 cm
    // into the tread.) Further up and on its way (down at the right footfall: 18 cm, past the step's edge), it is set
    // back flat where it stood: from there the blend lifts it clear.
    const trailing = 1 - lead, trailTread = Math.floor(spots[trailing].u - spots[trailing].r.offRiser / G);
    poseFrame(a.prep, frames, K); model.updateMatrixWorld(true);
    const trailQ = new THREE.Quaternion().setFromAxisAngle(Y, yawAt(spots[trailing].u, uRoot) - yawAt(spots[trailing].u, p.uRoot)).multiply(wq(legs[trailing][2]));
    let low = { gap: Infinity, t: 0 };
    for (const [mesh, index] of shoeVertices.get(model)[trailing]) {
      const q = geo.where(mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld), p.uRoot), t = Math.floor(q.u);
      if (q.h - geo.top(t, p.uRoot) < low.gap) low = { gap: q.h - geo.top(t, p.uRoot), t };
    }
    const keep = low.t === trailTread && low.gap < .12, clipAnkle = geo.where(wp(legs[trailing][2]), p.uRoot);
    // Where that ankle goes with the root at uRoot (heights relative to the root's line; on the spiral, polar).
    const keptAnkle = () => place(clipAnkle.u, uRoot, curved ? sigma * (radius - clipAnkle.across) : clipAnkle.across, clipAnkle.h - dir * R * (uRoot - p.uRoot) - low.gap);
    let drop = 0, st;
    for (; ; drop += .005) {
      poseAt(a.source, a.mixer, a.action, a.prep, p.s.time, a.travel); model.updateMatrixWorld(true);
      // The hips where they were at that moment (heights are relative to the root's line, which moves with it).
      const hips = place(hipU, uRoot, p.s.pelvis.x, targetHip + bob - dir * R * (uRoot - p.uRoot) - drop);
      if (curved) setWorldQ(pelvis, new THREE.Quaternion().setFromAxisAngle(Y, yawAt(hipU, uRoot)).multiply(wq(pelvis)));
      pelvis.parent.updateWorldMatrix(true, false); pelvis.position.copy(pelvis.parent.worldToLocal(hips.clone())); model.updateMatrixWorld(true);
      if (gait.lean) { const spine = a.prep.bones.get('Bip01_Spine'); setWorldQ(spine, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), gait.lean * Math.PI / 180).multiply(wq(spine))); model.updateMatrixWorld(true); }
      st = { reach: 0, minBend: 180, maxBend: 0, ikError: 0 };
      spots.forEach(({ r, u }, side) => {
        const flat = plan[r.flatK].feet[side];
        const yaw = new THREE.Quaternion().setFromAxisAngle(Y, yawAt(u, uRoot)), fix = new THREE.Quaternion().setFromAxisAngle(Y, flat.toeFix);
        const ankle = place(u, uRoot, r.lateral, 0).add(r.rest.heel.clone().applyQuaternion(yaw));
        ankle.y = dir * R * (Math.floor(u - r.offRiser / G) + .5 - uRoot) + flat.ankleAboveSole;
        const kept = side === trailing && keep;
        solveLeg(legs[side][0], legs[side][1], legs[side][2], kept ? keptAnkle() : ankle, kept ? trailQ : yaw.clone().multiply(fix).multiply(footQ[side]), st, FORWARD.clone().applyQuaternion(yaw));
      });
      model.updateMatrixWorld(true);
      if (st.reach <= .985 || drop >= .1) break;
    }
    // Both shoes against the flight, as shoeTruth measures them.
    const v = new THREE.Vector3(); let gap = 0, depth = 0;
    shoeVertices.get(model).forEach(list => {
      let low = Infinity;
      for (const [mesh, index] of list) {
        const q = geo.where(mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld), uRoot), base = Math.floor(q.u);
        low = Math.min(low, q.h - geo.top(base, uRoot));
        let best = Infinity;
        for (let t = base - 1; t <= base + 1; t++) best = Math.min(best, Math.hypot(Math.max(0, (t - q.u) * q.going, (q.u - t - 1) * q.going), Math.max(0, geo.top(t, uRoot) - q.h)));
        depth = Math.max(depth, best);
      }
      gap = Math.max(gap, Math.abs(low));
    });
    return { frame: record(a.prep), drop, reach: st.reach, gap, depth, kept: keep };
  };
  for (let lead = 0; lead < 2; lead++) {
    // The footfall: the first frame of the leading foot's contact nearest the clip's own contact phase; before it, the
    // trailing foot's last frame on its tread.
    const leadRun = lockRuns.filter(r => r.side === lead).reduce((best, r) => Math.abs(wrapHalfPhase(r.frames[0] / FRAMES - a.contacts[lead].phase)) < Math.abs(wrapHalfPhase(best.frames[0] / FRAMES - a.contacts[lead].phase)) ? r : best);
    const strike = leadRun.frames[0] % FRAMES, trail = spotAt(1 - lead, strike, false);
    const before = ((trail.r.frames[trail.r.frames.length - 1] + (trail.u - trail.r.uLock) / 2 * FRAMES) % FRAMES + FRAMES) % FRAMES;
    // Preferred: just before the footfall, where the walk's own trailing foot is still down, so setting off again
    // blends only the leading foot, from its tread up to where it hovers over it. From the footfall pose (down: the
    // trailing foot already 18 cm up and swinging forward), that blend dragged its toe 2 cm into the step.
    const poseBefore = standPose(before, lead, 0), poseStrike = standPose(strike, lead, 0), dropBefore = poseBefore.drop, dropStrike = poseStrike.drop;
    const K = dropBefore <= Math.max(.05, dropStrike) ? before : strike;
    standPhases.push(K / FRAMES); standStats.moments.push((K === strike ? 'footfall' : 'before') + ((K === strike ? poseStrike : poseBefore).kept ? ' kept' : ' flat') + ' (-' + (dropBefore * 100).toFixed(1) + '/-' + (dropStrike * 100).toFixed(1) + ')');
    for (const delta of STAND_DELTAS) {
      const pose = standPose(K, lead, delta);
      stand.push(pose.frame);
      for (const key of ['gap', 'depth', 'reach', 'drop']) standStats[key] = Math.max(standStats[key], pose[key]);
    }
  }
  if (process.env.TRUTH && `${gait.name}:${variant.flight}:${variant.radius}` === process.env.TRUTH)
    for (const r of truth.rows) console.log(r.phase.toFixed(4), r.feet.map((f, s) => `${'LR'[s]} gap ${(f.gap * 100).toFixed(2).padStart(6)} depth ${(f.depth * 100).toFixed(2).padStart(5)} moved ${(f.moved * 100).toFixed(2).padStart(5)}` + (f.depth > .005 ? ` at u ${(f.at.u - uRootAt(r.phase)).toFixed(3)}` : '')).join(' | '));
  reset();
  return { meta: { name: gait.name, kind: 'stairs', flight: variant.flight, radius: variant.radius, riser: R, going: +G.toFixed(4), direction: dir,
    turn: curved ? sigma : 0, frames: FRAMES, rootTreadAtStart: +u0.toFixed(4), treadsPerCycle: 2, contacts: a.contacts,
    sourceRiser: +R0.toFixed(4), sourceGoing: +G0.toFixed(4), targetHip: +targetHip.toFixed(4),
    footOffset: +(footOffsets.reduce((s, x) => s + x, 0) / footOffsets.length).toFixed(4),
    stand: { phases: standPhases, deltas: STAND_DELTAS }, standRotations: packQ(stand.map(f => f.rotations)), standPelvis: pack(stand.map(f => [f.pelvis])) },
    stats: { ...stats, stand: standStats }, data: frames };
}

// ---------- main
const { model, reset, idleLocal } = await visitorModel();
// The capture's walk leads with its hips (they twist 8.6 deg a stride, the shoulders 4.2; they sway 3.8 cm and tilt
// 3.8 deg each step, and bob 7.3 cm): read as a woman's walk ('thumak thumak'). Made simple: the body barely shifts
// its weight side to side, the hips stay level and the shoulders quiet (a fuller shoulder swing read as odd); the
// bounce is trimmed (the body rose 7 cm each step) and the arms swing less.
// The run likewise: no hop (30% of its 10 cm bounce kept), no side-to-side weight shift or head sway.
const RUN_SHAPE = { widen: .03, calm: .4, sway: .7, lean: .7, roll: .5, level: .3 };
const WALK_SHAPE = SOURCE === 'mixamo' ? { widen: .005, calm: .6, tilt: .7, sway: .8, level: .3, lower: .015, shoulders: -.5, roll: .6, lean: .7, arms: ARM_SWING } : undefined;
const walk = await bakeFlat('walk', PROFILE.clips.walk, model, reset, 1, WALK_SHAPE), run = await bakeFlat('jog', PROFILE.clips.run, model, reset, JOG_WARP, SOURCE === 'mixamo' ? RUN_SHAPE : undefined);
// Short steps at the walk's own cadence (stride-warped to SHORT_WARP): what the walk becomes below walking speed, slowing
// for a staircase or a stop. Played by distance, the full-length walk at the stair pace (0.6 m/s) took 0.7 steps a
// second (slow motion), then the stairs took 2.1.
const short = await bakeFlat('walk-short', PROFILE.clips.walk, model, reset, SHORT_WARP, WALK_SHAPE);
const sources = new Map(); for (const file of new Set(GAITS.map(g => g.file))) sources.set(file, await analyse(file, model, reset));
const stairs = [];
// Hip height per flight: start from the mapped clip's and lower it in 1 cm steps until no leg is stretched past
// 99.3% of its length (knee bent at least 13 deg; a fully straight knee locks and pops), at most 12 cm.
for (const gait of GAITS) for (const variant of VARIANTS) {
  // LOCO_ONLY=<gait>:<flight> (with LOCO_OUT): bake just that staircase, for quick checks.
  if (process.env.LOCO_ONLY && process.env.LOCO_OUT && `${gait.name}:${variant.flight}` !== process.env.LOCO_ONLY) continue;
  // ...and raise it in 1 cm steps while the support leg never gets near straight (under 97.5%, knee bent over ~25 deg
  // the whole stride reads as a crouch), at most 8 cm.
  let drop = 0, baked = bakeStairs(gait, variant, model, reset, sources.get(gait.file), walk.meanHip, 0);
  if (baked.stats.reach < .975) {
    while (drop > -.08) { const next = bakeStairs(gait, variant, model, reset, sources.get(gait.file), walk.meanHip, drop - .01); if (next.stats.reach > .99) break; baked = next; drop -= .01; if (baked.stats.reach >= .975) break; }
  } else while (baked.stats.reach > .993 && drop < .12) { drop += .01; baked = bakeStairs(gait, variant, model, reset, sources.get(gait.file), walk.meanHip, drop); }
  stairs.push(baked);
}
console.log(`walk ${walk.meta.naturalSpeed} m/s, ${walk.meta.cycleDistance} m per cycle, contacts ${JSON.stringify(walk.meta.contacts)}`);
console.log(`short ${short.meta.naturalSpeed} m/s, ${short.meta.cycleDistance} m per cycle`);
console.log(`run  ${run.meta.naturalSpeed} m/s, ${run.meta.cycleDistance} m per cycle, contacts ${JSON.stringify(run.meta.contacts)}`);
for (const g of GAITS) { const a = sources.get(g.file); console.log(`${g.name}: source step ${(a.total.z * a.scale / 2).toFixed(3)} m, contacts ${JSON.stringify(a.contacts)}`); }
for (const s of stairs) console.log(`${s.meta.name.padEnd(9)} ${s.meta.flight.padEnd(8)} r ${s.meta.radius.toFixed(2)} going ${s.meta.going.toFixed(3)} riser ${s.meta.riser.toFixed(3)} hip ${s.meta.targetHip.toFixed(3)} | reach ${s.stats.reach.toFixed(3)} knee ${s.stats.minBend.toFixed(0)}..${s.stats.maxBend.toFixed(0)} deg | shoe mesh: sink ${(s.stats.vertexSink * 100).toFixed(1)} slide ${(s.stats.vertexSlide * 100).toFixed(1)} cm | stand: gap ${(s.stats.stand.gap * 100).toFixed(1)} depth ${(s.stats.stand.depth * 100).toFixed(1)} cm, reach ${s.stats.stand.reach.toFixed(3)}, hips -${(s.stats.stand.drop * 100).toFixed(1)} cm, at ${s.stats.stand.moments.join('/')}`);
// (The joint-based planted sink / hover / drift in stats estimate the sole from the heel and toe joints: the shoe mesh
// figures are the ones the runtime audit, qa/locomotion-audit.mjs, measures.)
const out = { version: 3, source: `${SOURCE}: ${PROFILE.clips.walk}, ${PROFILE.clips.run}; stair clips fitted from ${PROFILE.clips.walk}`, bones: BONES.map(([, r]) => r), frames: FRAMES,
  clips: [walk, run, short, ...stairs].map(({ meta, data }) => ({ ...meta, rotations: packQ(data.map(f => f.rotations)), pelvis: pack(data.map(f => [f.pelvis])) })) };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT.pathname, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
