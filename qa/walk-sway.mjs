// How far the visitor moves left and right while walking straight, as the game shows him: the shipped
// RocketboxAvatar and locomotion clips (every runtime layer on top of the clip included), walking 6 m along +x at
// walking speed after a run-up. Lateral (z) range of head, chest, hips and both shoes' planted points, in cm.
//   node qa/walk-sway.mjs [clips.json]
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
const { GAIT } = await import(locoURL);

const bytes = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const oldLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + oldLength));
delete json.images; delete json.textures; delete json.samplers; json.materials = json.materials.map(m => ({ name: m.name }));
let encoded = Buffer.from(JSON.stringify(json)); encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8); header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
const gltf = await new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
const file = process.argv[2] ?? new URL('../public/assets/character/locomotion-v16.json', import.meta.url);
const avatar = createRocketboxAvatar(gltf, JSON.parse(fs.readFileSync(file)));

const dt = 1 / 60, root = avatar.root, at = new THREE.Vector3();
root.position.set(0, 0, -8); root.rotation.y = Math.PI / 2; avatar.resetMotion(); avatar.update(0, 0, 0);
const pick = n => root.getObjectByName(n);
const parts = { head: pick('Bip01_Head'), chest: pick('Bip01_Spine2'), hips: pick('Bip01_Pelvis'), 'left shoe': pick('Bip01_L_Foot'), 'right shoe': pick('Bip01_R_Foot') };
for (const [gait, target] of [['walking', GAIT.walk], ['sprinting', GAIT.run]]) {
root.position.set(0, 0, -8); avatar.resetMotion(); avatar.update(0, 0, 0);
const z = Object.fromEntries(Object.keys(parts).map(k => [k, []])), y = { head: [], hips: [], lift: [] };
let speed = 0;
for (let t = 0; t < 6; t += dt) {
  speed += (target - speed) * (1 - Math.exp(-8 * dt));
  root.position.x += speed * dt;
  avatar.update(dt, speed, 0, .55, undefined, undefined);
  root.updateMatrixWorld(true);
  if (t > 2) { for (const [k, bone] of Object.entries(parts)) z[k].push(bone.getWorldPosition(at).z); y.head.push(parts.head.getWorldPosition(at).y); y.hips.push(parts.hips.getWorldPosition(at).y); y.lift.push(avatar.locomotion.soleLift); }
}
const r = l => ((Math.max(...l) - Math.min(...l)) * 100).toFixed(1);
console.log(`${gait} straight at ${target} m/s with ${String(file).split('/').pop()}: up-down head ${r(y.head)} cm, hips ${r(y.hips)} cm (runtime sole lift ${r(y.lift)} cm); side-to-side head ${r(z.head)}, chest ${r(z.chest)}, hips ${r(z.hips)} cm`);
}
avatar.dispose?.();
