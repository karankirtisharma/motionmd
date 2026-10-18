import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Execute the shipped TypeScript without a build, a browser or temporary files.
// Resolving Three to an ESM file URL preserves the same Three instance as the loader.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (relativePath) => ts.transpileModule(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const movementURL = dataModule(transpile('../src/runtime/interaction/movement.ts'));
const avatarSource = transpile('../src/runtime/interaction/RocketboxAvatar.ts')
    .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
    .replace("from './movement'", `from ${JSON.stringify(movementURL)}`);
const { createRocketboxAvatar } = await import(dataModule(avatarSource));
const { smoothSupportHeight } = await import(movementURL);
// Geometry, skinning and all animation buffers remain intact. Texture decoding
// needs browser APIs and is unrelated to this numerical pose check.
const bytes = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const oldLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + oldLength));
delete json.images;
delete json.textures;
delete json.samplers;
json.materials = json.materials.map((material) => ({ name: material.name }));
let encoded = Buffer.from(JSON.stringify(json));
encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8);
header.writeUInt32LE(encoded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
const load = () => new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
const { createCollisionWorld } = await import('../src/runtime/interaction/CollisionWorld.ts');
const { createStairSurfaces } = await import('../src/runtime/interaction/StairSurfaces.ts');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
async function asset(url, images = false) { let b = fs.readFileSync('public' + url); if (images) {
    const len = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + len));
    delete j.images;
    delete j.textures;
    delete j.samplers;
    j.materials = j.materials.map(m => ({ name: m.name }));
    let e = Buffer.from(JSON.stringify(j));
    e = Buffer.concat([e, Buffer.alloc((4 - e.length % 4) % 4, 32)]);
    const h = Buffer.alloc(20);
    h.writeUInt32LE(0x46546c67, 0);
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(20 + e.length + b.length - 20 - len, 8);
    h.writeUInt32LE(e.length, 12);
    h.writeUInt32LE(0x4e4f534a, 16);
    b = Buffer.concat([h, e, b.subarray(20 + len)]);
} return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '')).scene; }
test('shoe skin clears actual glass treads with bounded knee flexion, including stops and turns', async (context) => {
    const manifest = JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
    const collision = new THREE.Group();
    for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls])
        collision.add(await asset(url));
    const scene = new THREE.Scene();
    for (const id of ['v13', 'v18', 'v19', 'entrance', 'shell'])
        scene.add(await asset(manifest.chunks.find(c => c.id === id).url, true));
    const sample = createStairSurfaces(scene);
    const physics = await createCollisionWorld(scene, undefined, collision, [], manifest.explorationBounds);
    const route = [];
    for (let i = 0; i <= 160; i++) {
        const a = (60 + 315 / 46) - (315 + 315 / 46) * i / 160, r = a * Math.PI / 180;
        route.push([18.76 + 1.55 * Math.cos(r), 3.67 / 24 * ((60 - a) / (315 / 23) + .5), -(20.2 + 1.55 * Math.sin(r))]);
    }
    const routes = [
      {label: 'spiral', route},
      {label: 'entrance', route: Array.from({length:101},(_,i)=>[-7+i*.025,-.35,-17.1])},
      {label: 'rounded landing', route: Array.from({length:101},(_,i)=>[8.5-i*.035,3.675,-23])},
    ];
    for (const {label,route} of routes)
    for (const [hz, speed] of [[60, 1.38], [144, 1.38], [60, 3.35]])
        for (const direction of [1, -1]) {
            const avatar = createRocketboxAvatar(await load());
            const shoes = [];
            avatar.root.traverse(m => { if (!m.isSkinnedMesh)
                return; const ix = m.geometry.attributes.skinIndex, w = m.geometry.attributes.skinWeight; for (let v = 0; v < ix.count; v++) {
                let weight = 0;
                for (let k = 0; k < 4; k++)
                    if (/Bip01_[LR]_(Foot|Toe)/.test(m.skeleton.bones[ix.getComponent(v, k)].name))
                        weight += w.getComponent(v, k);
                if (weight > .95)
                    shoes.push({ m, v });
            } });
            const points = direction === 1 ? route : [...route].reverse(), feet = new THREE.Vector3(...points[0]);
            feet.y = physics.groundAt(feet);
            physics.place(feet);
            let renderedY = feet.y, actualSpeed = 0;
            let grounded = true, vy = 0, minGap = Infinity, maxFootJump = 0, kneeMin = 180, kneeMax = 0, previous, frames = 0, worst, jumpWorst;
            for (const p of points.slice(1))
                for (let n = 0; n < 180; n++) {
                    const d = new THREE.Vector3(p[0] - feet.x, 0, p[2] - feet.z);
                    if (d.length() < .045)
                        break;
                    d.clampLength(0, speed / hz);
                    vy = grounded ? -.5 : Math.max(-16, vy - 9.81 / hz);
                    d.y = vy / hz;
                    const old = feet.clone();
                    grounded = physics.move(d, 1 / hz, feet);
                    assert.ok(Math.hypot(feet.x-old.x,feet.z-old.z) <= speed/hz+.005, 'stair assist cannot lunge forward beyond the requested stride');
                    renderedY = smoothSupportHeight(renderedY, feet.y, 1 / hz);
                    avatar.root.position.copy(feet).setY(renderedY);
                    avatar.root.rotation.y = Math.atan2(d.x, d.z);
                    const achievedSpeed = Math.hypot(feet.x - old.x, feet.z - old.z) * hz;
                    actualSpeed = THREE.MathUtils.lerp(actualSpeed, achievedSpeed < .06 ? 0 : achievedSpeed, 1-Math.exp(-16/hz));
                    avatar.update(1 / hz, actualSpeed, 0, .55, undefined, { sample });
                    avatar.root.updateMatrixWorld(true);
                    const footPoints = [];
                    for (const side of ['L', 'R']) {
                        const [h, k, f] = ['Thigh', 'Calf', 'Foot'].map(part => avatar.root.getObjectByName('Bip01_' + side + '_' + part).getWorldPosition(new THREE.Vector3()));
                        const angle = h.sub(k).angleTo(f.clone().sub(k)) * 180 / Math.PI;
                        kneeMin = Math.min(kneeMin, angle);
                        kneeMax = Math.max(kneeMax, angle);
                        footPoints.push(f);
                    }
                    if (previous) {
                        const jump = Math.max(...footPoints.map((f, i) => f.distanceTo(previous[i])));
                        if (jump > maxFootJump) {
                            maxFootJump = jump;
                            jumpWorst = { frame: frames, root: feet.toArray(), clearance: avatar.locomotion.stairClearance };
                        }
                    }
                    previous = footPoints;
                    for (const { m, v } of shoes) {
                        const p = m.localToWorld(m.getVertexPosition(v, new THREE.Vector3())), y = sample(p, avatar.root.position.y);
                        if (y !== undefined && p.y - y < minGap) {
                            minGap = p.y - y;
                            worst = { root: feet.toArray(), point: p.toArray(), tread: y, frame: frames };
                        }
                    }
                    frames++;
                }
            // Stop on a mid-flight tread at several headings. Actual root stays fixed.
            for (const degrees of [-30, -110, -210])
                for (const heading of [0, Math.PI / 2, Math.PI]) {
                    const r = degrees * Math.PI / 180;
                    feet.set(18.76 + 1.55 * Math.cos(r), 3.67 / 24 * ((60 - degrees) / (315 / 23) + .5), -(20.2 + 1.55 * Math.sin(r)));
                    feet.y = physics.groundAt(feet);
                    physics.place(feet);
                    avatar.root.position.copy(feet);
                    avatar.root.rotation.y = heading;
                    avatar.update(0, 0, 0, .55); // clear previous contact history
                    for (let i = 0; i < hz; i++)
                        avatar.update(1 / hz, 0, 0, .55, undefined, { sample });
                    avatar.root.updateMatrixWorld(true);
                    for (const { m, v } of shoes) {
                        const p = m.localToWorld(m.getVertexPosition(v, new THREE.Vector3())), y = sample(p, feet.y);
                        if (y !== undefined)
                            assert.ok(p.y - y > -.002, 'standing shoe must clear its tread');
                    }
                }
            context.diagnostic(JSON.stringify({ label, hz, speed, direction, frames, minGap, maxFootJump, kneeMin, kneeMax, worst, jumpWorst }));
            assert.ok(Number.isFinite(minGap) && minGap > -.002, 'actual shoe skin must not penetrate the visible tread');
            assert.ok(kneeMin > 75 && kneeMax < 179, 'knees stay anatomically flexed');
            assert.ok(maxFootJump < (speed > 2 ? .15 : .085), 'no large per-frame foot snaps');
            avatar.dispose();
        }
    physics.dispose();
});
