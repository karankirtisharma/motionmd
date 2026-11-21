// Plays the real InteractionController (Rapier collision on the shipped collision meshes, the shipped avatar and
// locomotion clips) through stair scenarios steered as a visitor would, and reports per-frame jitter:
//   body   - kink in the pelvis / head path (second difference, mm): a one-frame jump in the body
//   camera - kink in the camera path (mm)
//   legs   - angular acceleration of thighs, calves, feet (deg/frame^2): a pop in the legs
//   sink   - deepest shoe vertex inside a flight's treads (cm); float - both shoes above the treads on a flight (cm)
//   node qa/stair-play-audit.mjs [filter] [hz]      (survey: node qa/stair-play-audit.mjs survey)
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
delete manifest.lift;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = relative => ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const three = JSON.stringify(import.meta.resolve('three'));
const movementURL = new URL('../src/runtime/interaction/movement.ts', import.meta.url).href;
const flightsURL = dataModule(transpile('../src/runtime/interaction/stairFlights.ts'));
const locomotionURL = dataModule(transpile('../src/runtime/interaction/locomotionClips.ts')
  .replace("from 'three'", `from ${three}`).replace("from './stairFlights'", `from ${JSON.stringify(flightsURL)}`));
const { createRocketboxAvatar } = await import(dataModule(transpile('../src/runtime/interaction/RocketboxAvatar.ts')
  .replace("from 'three'", `from ${three}`).replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './locomotionClips'", `from ${JSON.stringify(locomotionURL)}`)));
const { locateFlight } = await import(flightsURL);
const key = '__mdStairPlayQA';
const controllerSource = transpile('../src/runtime/interaction/InteractionController.ts')
  .replace("from 'three'", `from ${three}`)
  .replace("from '../presentation/FounderCRM'", `from ${JSON.stringify(dataModule('export const createFounderCRM=()=>undefined;'))}`)
  .replace("from './ComputerScreens'", `from ${JSON.stringify(new URL('../src/runtime/interaction/ComputerScreens.ts', import.meta.url).href)}`)
  .replace("from './Workstation'", `from ${JSON.stringify(new URL('../src/runtime/interaction/Workstation.ts', import.meta.url).href)}`)
  .replace("from './StairSurfaces'", `from ${JSON.stringify(new URL('../src/runtime/interaction/StairSurfaces.ts', import.meta.url).href)}`)
  .replace("from './stairFlights'", `from ${JSON.stringify(flightsURL)}`)
  .replace("from './locomotionClips'", `from ${JSON.stringify(locomotionURL)}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './GlassLift'", `from ${JSON.stringify(new URL('../src/runtime/interaction/GlassLift.ts', import.meta.url).href)}`)
  .replace("from './CollisionWorld'", `from ${JSON.stringify(dataModule(`export const createCollisionWorld=async()=>globalThis.${key}.physics;`))}`)
  .replace("from './Avatar'", `from ${JSON.stringify(dataModule(`export const loadAvatar=async()=>globalThis.${key}.avatar;`))}`)
  .replace("from '../presentation/PresentationScreen'", `from ${JSON.stringify(dataModule(`export const createPresentationScreen=()=>globalThis.${key}.screen;`))}`)
  .replace("from '../presentation/screenPreviews.ts'", `from ${JSON.stringify(dataModule('export const loadScreenPreviews=async()=>({dispose(){}});'))}`)
  .replace("from '../rendering/assets'", `from ${JSON.stringify(new URL('../src/runtime/rendering/assets.ts', import.meta.url).href)}`);
const { createInteractionController } = await import(dataModule(controllerSource));

async function load(url, omitImages = false) {
  let bytes = fs.readFileSync(new URL(`../public${url}`, import.meta.url));
  if (omitImages) {
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
    delete json.images; delete json.textures; delete json.samplers;
    json.materials = json.materials.map(material => ({ name: material.name }));
    let encoded = Buffer.from(JSON.stringify(json));
    encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - length, 8);
    header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    bytes = Buffer.concat([header, encoded, bytes.subarray(20 + length)]);
  }
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}
const locomotion = JSON.parse(fs.readFileSync(process.env.LOCO_FILE ?? new URL('../public/assets/character/locomotion-v16.json', import.meta.url)));
const collisionRoot = new THREE.Group(), scene = new THREE.Scene();
for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) collisionRoot.add((await load(url)).scene);
for (const id of ['v13', 'v18', 'v19', 'entrance', 'shell']) scene.add((await load(manifest.chunks.find(c => c.id === id).url, true)).scene);
globalThis.document = { pointerLockElement: null, addEventListener() {}, removeEventListener() {}, exitPointerLock() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, performance: globalThis.performance }; globalThis.matchMedia = () => ({ matches: false });

// The flights' analytic treads (as in locomotion-audit): depth of a point inside the stair solid.
function penetration(x, y, z) {
  const hit = locateFlight(x, y, z, 4);
  if (!hit) return undefined;
  const top = k => hit.line(-.5) + hit.riser * THREE.MathUtils.clamp(k, 0, hit.treads + 1);
  const along = hit.u * hit.going;
  let best = Infinity;
  for (let j = Math.floor(hit.u) - 1; j <= Math.floor(hit.u) + 1; j++) {
    const dx = Math.max(0, j * hit.going - along, along - (j + 1) * hit.going), dy = Math.max(0, top(j + 1) - y);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return { depth: best, gap: y - top(Math.floor(hit.u) + 1) };
}

const G = { cx: -6.489, cz: -19.622, r: 14.392 }, S = { cx: 18.76, cz: -20.2 };
const galleryAt = (radius, z) => ({ x: G.cx + Math.sqrt(radius ** 2 - (z - G.cz) ** 2), z });
const galleryUp = (x, z) => { const dx = x - G.cx, dz = z - G.cz, r = Math.hypot(dx, dz); return [-dx / r, -dz / r]; };
const spiralAt = (r, u) => { const a = (59.995 - u * 13.695) * Math.PI / 180; return { x: S.cx + r * Math.cos(a), z: S.cz - r * Math.sin(a) }; };
const spiralUp = (x, z) => { const a = Math.atan2(-(z - S.cz), x - S.cx); return [Math.sin(a), Math.cos(a)]; };
const rotate = ([x, z], deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [x * c - z * s, x * s + z * c]; };

if (process.argv[2] === 'survey') {
  // Where the real treads are: ground height across the width of the gallery and entrance flights.
  const physics = await createCollisionWorld(scene, undefined, collisionRoot, [], process.env.NOBOUNDS ? undefined : manifest.explorationBounds);
  const p = new THREE.Vector3();
  console.log('gallery: tread levels (3.675 + 0.175 k) along the radius, per z; * = locateFlight finds it');
  for (let z = Number(process.env.Z0 ?? -27.5); z <= Number(process.env.Z1 ?? -18.5); z += .5) {
    let row = '';
    for (let r = G.r + .6; r >= G.r - .9; r -= .145) {
      const q = galleryAt(r, z); p.set(q.x, 4.4, q.z);
      const y = physics.groundAt(p, 2), k = Math.round((y - 3.675) / .175);
      row += (Math.abs(y - 3.675 - .175 * k) < .02 && k >= 0 && k <= 3 ? String(k) : '?') + (locateFlight(q.x, y, q.z, .01) ? '*' : ' ');
    }
    console.log(z.toFixed(1).padStart(6), row);
  }
  console.log('entrance: levels (-0.355 + 0.1725 k) along x, per z');
  for (let z = -21; z <= -13; z += .5) {
    let row = '';
    for (let x = -7.4; x <= -5.3; x += .17) { p.set(x, .3, z); const y = physics.groundAt(p, 2), k = Math.round((y + .355) / .1725); row += (Math.abs(y + .355 - .1725 * k) < .02 && k >= 0 && k <= 2 ? String(k) : '?') + (locateFlight(x, y, z, .01) ? '*' : ' '); }
    console.log(z.toFixed(1).padStart(6), row);
  }
  process.exit(0);
}

// A scenario: start pose, then segments of steering. dir(feet) -> world direction [x, z] or null (no input).
const up = f => galleryUp(f[0], f[2]), down = f => galleryUp(f[0], f[2]).map(v => -v);
const sUp = f => spiralUp(f[0], f[2]), sDown = f => spiralUp(f[0], f[2]).map(v => -v);
const onLanding = f => f[1] > 4.15, onFloor = f => f[1] < 3.7;
const SCENARIOS = {
  'gallery-up trail': { start: { ...galleryAt(G.r + 2.5, -23), y: 3.675 }, face: up, segments: [{ dir: up, until: onLanding, after: .8 }] },
  'gallery-up edge z-21.4': { start: { ...galleryAt(G.r + 2.5, -21.4), y: 3.675 }, face: up, segments: [{ dir: up, until: onLanding, after: .8 }] },
  'gallery-up edge z-24.6': { start: { ...galleryAt(G.r + 2.5, -24.6), y: 3.675 }, face: up, segments: [{ dir: up, until: onLanding, after: .8 }] },
  'gallery-up 35deg': { start: { ...galleryAt(G.r + 2.2, -24.2), y: 3.675 }, face: f => rotate(up(f), 35), segments: [{ dir: f => rotate(up(f), 35), until: onLanding, after: .8, max: 6 }] },
  'gallery-up 55deg': { start: { ...galleryAt(G.r + 1.8, -24.6), y: 3.675 }, face: f => rotate(up(f), 55), segments: [{ dir: f => rotate(up(f), 55), until: onLanding, after: .8, max: 6 }] },
  'gallery-up 70deg': { start: { ...galleryAt(G.r + 1.2, -24.6), y: 3.675 }, face: f => rotate(up(f), 70), segments: [{ dir: f => rotate(up(f), 70), until: onLanding, after: .8, max: 6 }] },
  'gallery-up -55deg': { start: { ...galleryAt(G.r + 1.8, -21.4), y: 3.675 }, face: f => rotate(up(f), -55), segments: [{ dir: f => rotate(up(f), -55), until: onLanding, after: .8, max: 6 }] },
  'gallery side-then-up': { start: { ...galleryAt(G.r + .45, -24.2), y: 3.675 }, face: f => rotate(up(f), 90), segments: [{ dir: f => rotate(up(f), 90), until: f => f[2] > -22.4 }, { dir: up, until: onLanding, after: .8, max: 6 }] },
  'gallery-up z-19.5': { start: { ...galleryAt(G.r + .55, -19.5), y: 3.675 }, face: up, segments: [{ dir: up, until: onLanding, after: .8 }] },
  'gallery-up end z-16.6': { start: { x: 8.35, z: -16.6, y: 3.675 }, face: () => [-1, 0], segments: [{ dir: () => [-1, 0], until: onLanding, after: .8, max: 6 }] },
  'gallery-down end z-16.6': { start: { x: 6.3, z: -16.6, y: 4.2 }, face: () => [1, 0], segments: [{ dir: () => [1, 0], until: onFloor, after: .8, max: 6 }] },
  'gallery-down trail': { start: { ...galleryAt(G.r - 1.6, -23), y: 4.2 }, face: down, segments: [{ dir: down, until: onFloor, after: .8 }] },
  'gallery-down edge z-21.4': { start: { ...galleryAt(G.r - 1.6, -21.4), y: 4.2 }, face: down, segments: [{ dir: down, until: onFloor, after: .8 }] },
  'gallery-down 50deg': { start: { ...galleryAt(G.r - 1.4, -21.6), y: 4.2 }, face: f => rotate(down(f), 50), segments: [{ dir: f => rotate(down(f), 50), until: onFloor, after: .8, max: 6 }] },
  'gallery up-sideways-up': { start: { ...galleryAt(G.r + 2.5, -23), y: 3.675 }, face: up, segments: [{ dir: up, until: f => f[1] > 3.8 }, { dir: f => rotate(up(f), 90), until: (f, t) => t > 1 }, { dir: up, until: onLanding, after: .8, max: 5 }] },
  'gallery up-stop-up': { start: { ...galleryAt(G.r + 2.5, -23), y: 3.675 }, face: up, segments: [{ dir: up, until: f => f[1] > 3.8 }, { dir: () => null, until: (f, t) => t > 1.2 }, { dir: up, until: onLanding, after: .8, max: 5 }] },
  'gallery up-turn-down': { start: { ...galleryAt(G.r + 2.5, -23), y: 3.675 }, face: up, segments: [{ dir: up, until: f => f[1] > 3.9 }, { dir: down, until: onFloor, after: .8, max: 5 }] },
  'gallery twice': { start: { ...galleryAt(G.r + 2.5, -23), y: 3.675 }, face: up, segments: [{ dir: up, until: onLanding, after: .5 }, { dir: down, until: onFloor, after: 1.5 }, { dir: up, until: onLanding, after: .5 }] },
  'entrance-up trail': { start: { x: -9.5, z: -17.1, y: -.355 }, face: () => [1, 0], segments: [{ dir: () => [1, 0], until: f => f[0] > -4.5 }] },
  'entrance-up z-15.4': { start: { x: -9.5, z: -15.4, y: -.355 }, face: () => [1, 0], segments: [{ dir: () => [1, 0], until: f => f[0] > -4.5 }] },
  'entrance-up 50deg': { start: { x: -8.5, z: -18.9, y: -.355 }, face: () => rotate([1, 0], 50), segments: [{ dir: () => rotate([1, 0], 50), until: f => f[0] > -5 || f[2] > -15.3, max: 6 }] },
  'entrance-down trail': { start: { x: -4, z: -17.1, y: -.01 }, face: () => [-1, 0], segments: [{ dir: () => [-1, 0], until: f => f[0] < -8.5 }] },
  'entrance-down 50deg': { start: { x: -4.6, z: -15.4, y: -.01 }, face: () => rotate([-1, 0], 50), segments: [{ dir: () => rotate([-1, 0], 50), until: f => f[0] < -8 || f[2] < -19, max: 6 }] },
  'spiral-up trail': { start: { ...spiralAt(1.45, -5), y: 0 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > 1.6 }] },
  'spiral-up outer 2.2': { start: { ...spiralAt(2.2, -5), y: 0 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > 1.6 }] },
  'spiral-up inner 0.9': { start: { ...spiralAt(.9, -5), y: 0 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > 1.6 }] },
  'spiral-up 40deg': { start: { ...spiralAt(2.3, -3), y: 0 }, face: f => rotate(sUp(f), -40), segments: [{ dir: f => rotate(sUp(f), -40), until: f => f[1] > .6, max: 6 }, { dir: sUp, until: f => f[1] > 1.6 }] },
  'spiral up-sideways-up': { start: { ...spiralAt(1.45, 2), y: .5 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > .8 }, { dir: f => rotate(sUp(f), 90), until: (f, t) => t > 1 }, { dir: sUp, until: f => f[1] > 1.8 }] },
  'spiral up-stop-up': { start: { ...spiralAt(1.45, 2), y: .5 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > .9 }, { dir: () => null, until: (f, t) => t > 1.2 }, { dir: sUp, until: f => f[1] > 1.8 }] },
  'spiral up-turn-down': { start: { ...spiralAt(1.45, 2), y: .5 }, face: sUp, segments: [{ dir: sUp, until: f => f[1] > 1.2 }, { dir: sDown, until: f => f[1] < .5 }] },
  'spiral-down trail': { start: { ...spiralAt(1.45, 20), y: 3.2 }, face: sDown, segments: [{ dir: sDown, until: f => f[1] < 1.8 }] },
};

const tracked = ['Bip01_Pelvis', 'Bip01_Head', 'Bip01_L_Foot', 'Bip01_R_Foot'];
const legBones = ['Bip01_L_Thigh', 'Bip01_R_Thigh', 'Bip01_L_Calf', 'Bip01_R_Calf', 'Bip01_L_Foot', 'Bip01_R_Foot'];
async function play(name, { hz = 60, sprint = false } = {}) {
  const scenario = SCENARIOS[name];
  const physics = await createCollisionWorld(scene, undefined, collisionRoot, [], process.env.NOBOUNDS ? undefined : manifest.explorationBounds);
  const avatar = createRocketboxAvatar(await load(manifest.character.url, true), locomotion);
  globalThis[key] = { physics, avatar };
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, .1, 1800);
  const controller = await createInteractionController({ scene, camera, canvas: { addEventListener() {}, removeEventListener() {}, focus() {} }, manifest: { ...manifest, screen: undefined } });
  const shoes = []; avatar.root.traverse(mesh => { if (!mesh.isSkinnedMesh) return; const w = mesh.geometry.attributes.skinWeight, j = mesh.geometry.attributes.skinIndex;
    for (let v = 0; v < w.count; v++) { let L = 0, R = 0; for (let k = 0; k < 4; k++) { const n = mesh.skeleton.bones[j.getComponent(v, k)].name, x = w.getComponent(v, k); if (/L_(Foot|Toe)/.test(n)) L += x; if (/R_(Foot|Toe)/.test(n)) R += x; } if (L > .6) shoes.push([mesh, v, 0]); else if (R > .6) shoes.push([mesh, v, 1]); } });
  const dt = 1 / hz, frames = [];
  try {
    const face = scenario.face([scenario.start.x, scenario.start.y, scenario.start.z]);
    const yaw = Math.atan2(-face[0], -face[1]);
    controller.enterExplore(undefined, { position: [scenario.start.x, scenario.start.y, scenario.start.z], yaw });
    for (let i = 0; i < hz; i++) controller.update(dt);
    const v = new THREE.Vector3(), q = new THREE.Quaternion();
    let t = 0;
    for (const [index, segment] of scenario.segments.entries()) {
      let segmentTime = 0, done = -1;
      while (segmentTime < (segment.max ?? 8)) {
        const feet = controller.diagnostics.state.feet;
        if (done < 0 && segment.until(feet, segmentTime)) done = segmentTime;
        if (done >= 0 && segmentTime - done >= (segment.after ?? 0)) break;
        const d = segment.dir(feet);
        if (d) controller.setVirtualInput(Math.cos(yaw) * d[0] - Math.sin(yaw) * d[1], -Math.sin(yaw) * d[0] - Math.cos(yaw) * d[1], 0, 0, sprint);
        else controller.setVirtualInput(0, 0, 0, 0, false);
        controller.update(dt); t += dt; segmentTime += dt;
        avatar.root.updateMatrixWorld(true);
        const loco = avatar.locomotion, f = controller.diagnostics.state.feet;
        const frame = { t, segment: index, feet: f, stair: loco.stair, u: loco.stairU, phase: loco.phase, speed: loco.speed, lift: loco.soleLift,
          points: tracked.map(n => avatar.root.getObjectByName(n).getWorldPosition(v).toArray()), camera: camera.position.toArray(),
          legs: legBones.map(n => avatar.root.getObjectByName(n).getWorldQuaternion(q).clone()), modelYaw: avatar.root.rotation.y + avatar.root.children[0].rotation.y,
          sink: 0, low: [Infinity, Infinity], flight: !!locateFlight(f[0], f[1], f[2], .2) };
        for (const [mesh, index, side] of shoes) {
          mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld);
          const p = penetration(v.x, v.y, v.z);
          const gap = p ? p.gap : v.y - f[1];
          if (p) frame.sink = Math.max(frame.sink, p.depth);
          frame.low[side] = Math.min(frame.low[side], gap);
        }
        frames.push(frame);
      }
    }
  } finally { controller.dispose(); delete globalThis[key]; }
  return frames;
}

function analyse(frames, hz) {
  const kink = (a, b, c) => Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]) * 1000;
  const angular = (a, b) => { const d = a.clone().invert().premultiply(b); d.normalize(); const angle = 2 * Math.acos(Math.min(1, Math.abs(d.w))); const s = Math.sqrt(Math.max(1e-12, 1 - d.w * d.w)) * Math.sign(d.w || 1); return new THREE.Vector3(d.x / s, d.y / s, d.z / s).multiplyScalar(angle); };
  const out = { body: [0], camera: [0], legs: [0], sink: [0], float: [0], yaw: [0] };
  const note = (key, value, i) => { if (value > out[key][0]) out[key] = [value, i]; };
  for (let i = 1; i < frames.length - 1; i++) {
    const [a, b, c] = [frames[i - 1], frames[i], frames[i + 1]];
    if (b.t < .3) continue;
    note('body', Math.max(kink(a.points[0], b.points[0], c.points[0]), kink(a.points[1], b.points[1], c.points[1])), i);
    note('camera', kink(a.camera, b.camera, c.camera), i);
    let legs = 0;
    for (let k = 0; k < a.legs.length; k++) legs = Math.max(legs, angular(a.legs[k], b.legs[k]).sub(angular(b.legs[k], c.legs[k])).length() * 180 / Math.PI);
    note('legs', legs, i);
    note('yaw', Math.abs(Math.atan2(Math.sin(a.modelYaw - 2 * b.modelYaw + c.modelYaw), Math.cos(a.modelYaw - 2 * b.modelYaw + c.modelYaw))) * 180 / Math.PI, i);
    note('sink', b.sink * 100, i);
    if (b.stair > .9 && b.speed > .2) note('float', Math.min(...b.low) * 100, i);
  }
  return out;
}
const where = f => f ? `t=${f.t.toFixed(2)} seg${f.segment} u=${f.u?.toFixed(2) ?? '-'} stair=${f.stair.toFixed(2)} v=${f.speed.toFixed(2)} y=${f.feet[1].toFixed(3)}` : '';

const filter = process.argv[2] ?? '', hz = Number(process.argv[3] ?? 60);
console.log(`at ${hz} Hz. body/camera kink mm, legs deg/frame^2, yaw deg/frame^2, sink/float cm`);
for (const name of Object.keys(SCENARIOS)) for (const sprint of [false, true]) {
  if (!`${name}${sprint ? ' run' : ''}`.includes(filter)) continue;
  const frames = await play(name, { hz, sprint }), r = analyse(frames, hz);
  const fmt = (k, digits = 1) => `${k} ${r[k][0].toFixed(digits).padStart(5)} @${where(frames[r[k][1]])}`;
  console.log(`${name}${sprint ? ' run' : ''}`.padEnd(30), `end y ${frames.at(-1).feet[1].toFixed(2)}`);
  for (const k of ['body', 'camera', 'legs', 'yaw', 'sink', 'float']) console.log('   ', fmt(k));
  if (process.env.TRACE && `${name}${sprint ? ' run' : ''}` === process.env.TRACE) for (const f of frames) console.log(where(f), 'x', f.feet[0].toFixed(3), 'z', f.feet[2].toFixed(3), 'phase', f.phase.toFixed(3), 'yaw', (f.modelYaw * 180 / Math.PI).toFixed(1), 'pelvisY', f.points[0][1].toFixed(3), 'lowL', (f.low[0] * 100).toFixed(1), 'lowR', (f.low[1] * 100).toFixed(1), 'sink', (f.sink * 100).toFixed(1), 'boom', Math.hypot(f.camera[0] - f.feet[0], f.camera[1] - f.feet[1] - 1.35, f.camera[2] - f.feet[2]).toFixed(2));
}
process.exit(0);
