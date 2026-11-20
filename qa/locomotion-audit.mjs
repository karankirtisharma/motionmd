// Frame-by-frame audit of the visitor's walk / run / stairs, running the shipped TypeScript (RocketboxAvatar,
// locomotionClips, stairFlights) against the real flights, at 60 and 164 Hz. Per rendered frame:
//   sink   - deepest shoe vertex below the tread / floor under it
//   hover  - planted shoe (lowest vertex within 2 cm) further above its surface than 1 cm
//   slide  - how far a planted foot's lowest point moves while planted
//   pop    - largest frame-to-frame change of any leg joint (deg) and hip acceleration (m/s^2)
//   node qa/locomotion-audit.mjs [scenario-filter]
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (path, map = {}) => {
  let out = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  out = out.replace(/from 'three'/g, `from ${JSON.stringify(import.meta.resolve('three'))}`);
  for (const [from, to] of Object.entries(map)) out = out.replaceAll(`from '${from}'`, `from ${JSON.stringify(to)}`);
  return dataModule(out);
};
const flightsURL = transpile('../src/runtime/interaction/stairFlights.ts');
const movementURL = transpile('../src/runtime/interaction/movement.ts');
const locoURL = transpile('../src/runtime/interaction/locomotionClips.ts', { './stairFlights': flightsURL });
const avatarURL = transpile('../src/runtime/interaction/RocketboxAvatar.ts', { './movement': movementURL, './locomotionClips': locoURL });
const { createRocketboxAvatar } = await import(avatarURL);
const { locateFlight } = await import(flightsURL);
const { GAIT, stairSpeed } = await import(locoURL);

const bytes = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const oldLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + oldLength));
delete json.images; delete json.textures; delete json.samplers; json.materials = json.materials.map(m => ({ name: m.name }));
let encoded = Buffer.from(JSON.stringify(json)); encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8); header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
const load = () => new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
const locomotion = JSON.parse(fs.readFileSync(new URL('../public/assets/character/locomotion-v9.json', import.meta.url)));

// Surface under a point: the flight's tread there, else the floor/landing level it continues into.
function surface(x, y, z) {
  const hit = locateFlight(x, y, z, 4);
  if (!hit) return undefined;
  const k = THREE.MathUtils.clamp(Math.floor(hit.u) + 1, 0, hit.treads + 1);
  return hit.line(-.5) + hit.riser * k;
}
// Depth inside the stair solid: the shortest way out into free space (above any tread, through risers).
function penetration(x, y, z) {
  const hit = locateFlight(x, y, z, 4);
  if (!hit) return 0;
  const top = k => hit.line(-.5) + hit.riser * THREE.MathUtils.clamp(k, 0, hit.treads + 1);
  const along = hit.u * hit.going;
  let best = Infinity;
  for (let j = Math.floor(hit.u) - 1; j <= Math.floor(hit.u) + 1; j++) {   // tread j spans u in [j, j + 1), its top is top(j + 1)
    const dx = Math.max(0, j * hit.going - along, along - (j + 1) * hit.going), dy = Math.max(0, top(j + 1) - y);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

// Paths: position at a distance s along the walking line, and the facing there.
const DEG = Math.PI / 180;
const spiralPath = (r, dir) => {
  const cx = 18.76, cz = -20.2, a0 = 59.995, step = 13.695, uStart = dir > 0 ? -6 : 26, uEnd = dir > 0 ? 26 : -3;
  const length = Math.abs(uEnd - uStart) * step * DEG * r;
  return { length, at(s) {
    const u = uStart + dir * s / (step * DEG * r), a = (a0 - u * step) * DEG;
    const x = cx + r * Math.cos(a), z = cz - r * Math.sin(a), ux = Math.sin(a) * dir, uz = Math.cos(a) * dir;
    return { x, z, yaw: Math.atan2(ux, uz), y0: .153 * (THREE.MathUtils.clamp(Math.floor(u) + 1, 0, 24)) };
  } };
};
const straightPath = (start, direction, length) => ({ length, at(s) { return { x: start.x + direction.x * s, z: start.z + direction.z * s, yaw: Math.atan2(direction.x, direction.z) }; } });
const galleryDir = (() => { const dz = -23 - -19.622, dx = Math.sqrt(14.392 ** 2 - dz ** 2); return new THREE.Vector2(-dx, -dz).normalize(); })();
const PATHS = {
  'entrance-up': () => straightPath({ x: -6.49 - 3, z: -17.1 }, { x: 1, z: 0 }, 3 + .682 + 2.5),
  'entrance-down': () => straightPath({ x: -6.49 + .682 + 2.5, z: -17.1 }, { x: -1, z: 0 }, 3 + .682 + 2.5),
  'gallery-up': () => { const r = 14.392 + 3, cx = -6.489, cz = -19.622; return straightPath({ x: cx - galleryDir.x * r, z: cz - galleryDir.y * r }, { x: galleryDir.x, z: galleryDir.y }, 3 + .87 + 2.2); },
  'gallery-down': () => { const r = 14.392 - .87 - 2.2, cx = -6.489, cz = -19.622; return straightPath({ x: cx - galleryDir.x * r, z: cz - galleryDir.y * r }, { x: -galleryDir.x, z: -galleryDir.y }, 3 + .87 + 2.2); },
  'floor': () => straightPath({ x: 0, z: -8 }, { x: 1, z: 0 }, 8),
  'spiral-up-1.45': () => spiralPath(1.45, 1), 'spiral-down-1.45': () => spiralPath(1.45, -1),
  'spiral-up-1.1': () => spiralPath(1.1, 1), 'spiral-down-2.0': () => spiralPath(2.0, -1),
};
const startY = { 'floor': 0, 'entrance-up': -.355, 'entrance-down': -.01, 'gallery-up': 3.675, 'gallery-down': 4.2, 'spiral-up-1.45': 0, 'spiral-down-1.45': 3.67, 'spiral-up-1.1': 0, 'spiral-down-2.0': 3.67 };

async function run(name, hz, { sprint = false, stopAt, turnAt } = {}) {
  const avatar = createRocketboxAvatar(await load(), locomotion);
  const path = PATHS[name.replace(/:.*/, '')]();
  const dt = 1 / hz, feet = new THREE.Vector3(), stairContact = { sprint, active: true };
  let hold = 0, lastFlight, s = 0, speed = 0, pace = 0, supportY = startY[name.replace(/:.*/, '')], t = 0, stoppedFor = 0, turned = false;
  const p0 = path.at(0); feet.set(p0.x, supportY, p0.z);
  avatar.root.position.copy(feet); avatar.root.rotation.y = p0.yaw; avatar.resetMotion(); avatar.update(0, 0, 0, .55, undefined, stairContact);
  const meshes = []; avatar.root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const shoe = meshes.map(mesh => { const w = mesh.geometry.getAttribute('skinWeight'), j = mesh.geometry.getAttribute('skinIndex'), out = [];
    for (let v = 0; v < w.count; v++) { let L = 0, R = 0; for (let k = 0; k < 4; k++) { const n = mesh.skeleton.bones[j.getComponent(v, k)].name, x = w.getComponent(v, k); if (/L_(Foot|Toe)/.test(n)) L += x; if (/R_(Foot|Toe)/.test(n)) R += x; } if (L > .6) out.push([v, 0]); else if (R > .6) out.push([v, 1]); }
    return out; });
  const bones = ['Bip01_Pelvis', 'Bip01_L_Thigh', 'Bip01_R_Thigh', 'Bip01_L_Calf', 'Bip01_R_Calf', 'Bip01_L_Foot', 'Bip01_R_Foot'].map(n => avatar.root.getObjectByName(n));
  const prevQ = bones.map(b => b.getWorldQuaternion(new THREE.Quaternion())), pelvisY = [];
  const stats = { sink: 0, sinkAt: '', hover: 0, slide: 0, pop: 0, popAt: '', hipAcc: 0, frames: 0, stand: undefined, cadence: Infinity, lastPhase: undefined };
  const contact = [undefined, undefined];
  const v = new THREE.Vector3(), q = new THREE.Quaternion();
  let direction = 1;
  while (s < path.length - .05 && t < 60) {
    t += dt;
    // Controller replica: speed by gait, stair cadence when a flight is under or 0.7 m (1.7 m sprinting) ahead, moving
    // along it, from just before its first riser to just past its last (held 0.05 s, eased over 0.2 s).
    const here = path.at(s), ahead = path.at(Math.min(path.length, s + (sprint ? 1.7 : .7) * direction));
    // As the controller: the look-ahead is checked along its length, not only at its end.
    const heading = new THREE.Vector2(path.at(Math.min(path.length, s + .01)).x - here.x, path.at(Math.min(path.length, s + .01)).z - here.z).normalize().multiplyScalar(direction);
    const flightAt = (x, z) => { const hit = locateFlight(x, feet.y, z); const along = hit ? heading.x * hit.uphillX + heading.y * hit.uphillZ : 0;
      if (!hit || Math.abs(along) < .5) return undefined; const U = along > 0 ? hit.u : hit.treads - hit.u; return U > -.4 && U < hit.treads + 1 ? hit : undefined; };
    let flight = flightAt(feet.x, feet.z);
    for (let k = 1; k <= 4 && !flight; k++) { const p = path.at(Math.max(0, Math.min(path.length, s + (sprint ? 1.7 : .7) * direction * k / 4))); flight = flightAt(p.x, p.z); }
    hold = flight ? .05 : Math.max(0, hold - dt); if (flight) lastFlight = flight;
    pace = THREE.MathUtils.clamp(pace + (hold > 0 ? dt : -dt) / .2, 0, 1);
    flight = flight ?? (pace > 0 ? lastFlight : undefined);
    let want = sprint ? GAIT.run : GAIT.walk;
    if (pace > 0) want = THREE.MathUtils.lerp(want, flight ? stairSpeed(flight, sprint) : .9, pace * pace * (3 - 2 * pace));
    if (stopAt !== undefined && s >= stopAt && stoppedFor < 1.5) {
      // Let go: finish the step under way, then stand.
      const settle = avatar.stairSettle;
      want = settle && settle.distance > .005 ? Math.min(settle.speed, settle.distance / .12) : 0;
      if (want === 0) stoppedFor += dt;
    }
    if (turnAt !== undefined && !turned && s >= turnAt) { turned = true; direction = -1; }
    speed = THREE.MathUtils.lerp(speed, want, 1 - Math.exp(-8 * dt));
    s += speed * dt * direction;
    if (turned && s <= 0) break;
    const p = path.at(s);
    const target = surface(p.x, feet.y + .3, p.z) ?? feet.y;
    supportY = Math.abs(target - supportY) > .35 ? target : Math.max(target, Math.min(target + .075, supportY + (target - supportY) * (1 - Math.exp(-18 * dt))));
    feet.set(p.x, supportY, p.z);
    const yaw = direction > 0 ? p.yaw : p.yaw + Math.PI;
    avatar.root.position.copy(feet);
    avatar.root.rotation.y += Math.atan2(Math.sin(yaw - avatar.root.rotation.y), Math.cos(yaw - avatar.root.rotation.y)) * (1 - Math.exp(-10 * dt));
    avatar.update(dt, speed, 0, .55, undefined, stairContact);
    avatar.root.updateMatrixWorld(true);
    stats.frames++;
    if (process.env.DEBUG && stats.frames % Math.round(hz / 10) === 0) { const L = avatar.root.getObjectByName('Bip01_L_Foot').getWorldPosition(new THREE.Vector3()), R = avatar.root.getObjectByName('Bip01_R_Foot').getWorldPosition(new THREE.Vector3()), st = avatar.locomotion; console.log('t', t.toFixed(2), 's', s.toFixed(2), 'v', speed.toFixed(2), 'u', st.stairU?.toFixed(2), 'stair', st.stair.toFixed(2), 'phase', st.phase.toFixed(2), 'rootY', feet.y.toFixed(3), 'yaw', (avatar.root.rotation.y/DEG).toFixed(0), 'modelYaw', (avatar.root.children[0].rotation.y/DEG).toFixed(0), 'modelY', avatar.root.children[0].position.y.toFixed(3), 'L', L.y.toFixed(3), 'surfL', surface(L.x, L.y, L.z)?.toFixed(3), 'R', R.y.toFixed(3), 'surfR', surface(R.x, R.y, R.z)?.toFixed(3)); }
    // Shoes against the surface.
    const lowest = [{ y: Infinity, gap: Infinity, x: 0, z: 0 }, { y: Infinity, gap: Infinity, x: 0, z: 0 }];
    meshes.forEach((mesh, i) => { for (const [index, side] of shoe[i]) {
      mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld);
      const ground = surface(v.x, v.y, v.z) ?? feet.y;
      const gap = v.y - ground, depth = surface(v.x, v.y, v.z) === undefined ? Math.max(0, -gap) : penetration(v.x, v.y, v.z);
      if (t > .3 && depth > stats.sink) { stats.sink = depth; stats.sinkAt = `t=${t.toFixed(2)} s=${s.toFixed(2)} u=${avatar.locomotion.stairU?.toFixed(2)} stair=${avatar.locomotion.stair.toFixed(2)} side=${'LR'[side]} vtx=(${v.x.toFixed(2)},${v.y.toFixed(3)},${v.z.toFixed(2)}) vu=${locateFlight(v.x, v.y, v.z, 4)?.u.toFixed(2)} ground=${ground.toFixed(3)} rootY=${feet.y.toFixed(3)}`; }
      if (gap < lowest[side].gap) lowest[side] = { gap, x: v.x, z: v.z, mesh: i, index };
    } });
    for (const side of [0, 1]) {
      const l = lowest[side], c = contact[side];
      // The vertex that carried the foot last frame: how far it moved while it stayed within 1 cm of its surface.
      if (c) {
        meshes[c.mesh].getVertexPosition(c.index, v).applyMatrix4(meshes[c.mesh].matrixWorld);
        const g = surface(v.x, v.y, v.z) ?? feet.y;
        if (v.y - g < .003 && t > .5) { const step = Math.hypot(v.x - c.x, v.z - c.z); c.moved += step; if (process.env.DEBUG_SLIDE && step > .004) console.log('SLIDE', 'LR'[side], 'step', (step*100).toFixed(2), 'moved', (c.moved*100).toFixed(1), 't', t.toFixed(3), 'u', avatar.locomotion.stairU?.toFixed(3), 'stair', avatar.locomotion.stair.toFixed(2), 'phase', avatar.locomotion.phase.toFixed(3), 'speed', speed.toFixed(2)); stats.slide = Math.max(stats.slide, c.moved); }
        else c.moved = 0;
      }
      contact[side] = l.gap < .003 ? { mesh: l.mesh, index: l.index, x: l.x, z: l.z, moved: c && l.index === c.index ? c.moved : 0 } : undefined;
      if (l.gap < .03 && l.gap > .01 && contact[side] === undefined && Math.abs(l.gap) < .03) stats.hover = Math.max(stats.hover, l.gap);
    }
    // Steps per second of the floor walk/run while moving at over 0.4 m/s off the flight (slow motion reads below ~1.5).
    { const ph = avatar.locomotion.phase; if (stats.lastPhase !== undefined && speed > .4 && avatar.locomotion.stair < .05 && t > .5) stats.cadence = Math.min(stats.cadence, 2 * (((ph - stats.lastPhase) % 1) + 1) % 1 / dt); stats.lastPhase = ph; }
    // Standing still on a flight (stopped for over 0.8 s): the worse shoe's lowest point from its tread.
    if (stoppedFor > .8 && stoppedFor < 1.5) stats.stand = Math.max(stats.stand ?? 0, Math.abs(lowest[0].gap), Math.abs(lowest[1].gap));
    // Pops: joint rotation per frame, and hip acceleration.
    bones.forEach((b, i) => { b.getWorldQuaternion(q); const d = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[i])))) / DEG; prevQ[i].copy(q);
      if (process.env.DEBUG2 && d > 6) console.log('POP', b.name, d.toFixed(1), 't', t.toFixed(3), 'u', avatar.locomotion.stairU?.toFixed(3), 'stair', avatar.locomotion.stair.toFixed(3), 'phase', avatar.locomotion.phase.toFixed(3), 'w', JSON.stringify(avatar.locomotion.weights));
      if (t > .3 && d > stats.pop) { stats.pop = d; stats.popAt = `${b.name} t=${t.toFixed(2)} s=${s.toFixed(2)} u=${avatar.locomotion.stairU?.toFixed(2)}`; } });
    pelvisY.push(bones[0].getWorldPosition(v).y);
    if (pelvisY.length > 2) stats.hipAcc = Math.max(stats.hipAcc, Math.abs(pelvisY.at(-1) - 2 * pelvisY.at(-2) + pelvisY.at(-3)) * hz * hz);
  }
  return stats;
}

const filter = process.argv[2] ?? '';
const SCENARIOS = [
  ...Object.keys(PATHS).flatMap(p => [[p, {}], [p + ':run', { sprint: true }]]),
  ['spiral-up-1.45:stop', { stopAt: 2.4 }], ['spiral-down-1.45:stop', { stopAt: 3.1 }], ['gallery-up:stop', { stopAt: 3.2 }], ['gallery-down:stop', { stopAt: 2.55 }], ['entrance-up:stop', { stopAt: 3.15 }],
];
console.log('scenario'.padEnd(26), 'Hz ', 'sink cm', 'hover cm', 'slide cm', 'pop deg/frame', 'hip m/s2');
for (const [name, options] of SCENARIOS) for (const hz of [60, 164]) {
  if (!name.includes(filter)) continue;
  const r = await run(name, hz, options);
  console.log(name.padEnd(26), String(hz).padEnd(3), (r.sink * 100).toFixed(1).padStart(7), (r.hover * 100).toFixed(1).padStart(8), (r.slide * 100).toFixed(1).padStart(8), r.pop.toFixed(1).padStart(13), r.hipAcc.toFixed(1).padStart(8), ' ', r.sink > .01 ? 'sink@' + r.sinkAt : '', r.pop > 6 ? 'pop@' + r.popAt : '', 'floor steps/s min ' + (r.cadence === Infinity ? '-' : r.cadence.toFixed(2)), r.stand === undefined ? '' : 'standing: worse shoe ' + (r.stand * 100).toFixed(1) + ' cm off its tread');
}
