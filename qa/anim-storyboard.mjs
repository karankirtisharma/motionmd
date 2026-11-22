// Storyboard of the baked locomotion (public/assets/character/locomotion-v1.json), rendered on the CPU:
// the visitor posed exactly as the game will pose it, standing on the flight each clip was fitted to.
// Planted shoes are green, tread centres are dark lines. 8 frames per cycle (two steps), camera fixed per row.
//   node qa/anim-storyboard.mjs [outDir]
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import sharp from 'sharp';
import { geometryFixture } from './helpers/geometry-fixture.mjs';

const OUT = (process.argv[2] ?? 'D:/MD Website Perf Audit/evidence/storyboard').replace(/\\/g, '/').replace(/\/?$/, '/');
fs.mkdirSync(OUT, { recursive: true });
const VERSION = process.env.LOCO ?? 'v1';
const data = JSON.parse(fs.readFileSync(new URL(`../public/assets/character/locomotion-${VERSION}.json`, import.meta.url)));
// The visitor's own base-colour textures (PNG in the GLB), decoded for the renderer.
const glb = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const glbJsonLength = glb.readUInt32LE(12), glbJson = JSON.parse(glb.subarray(20, 20 + glbJsonLength)), glbBin = glb.subarray(28 + glbJsonLength);
const images = await Promise.all(glbJson.images.map(async image => {
  const view = glbJson.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
  const { data: px, info } = await sharp(glbBin.subarray(start, start + view.byteLength)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px };
}));
const textureOf = Object.fromEntries(glbJson.materials.map(m => [m.name, images[glbJson.textures[m.pbrMetallicRoughness.baseColorTexture.index].source]]));
const decode = s => { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

// ---------- the visitor exactly as RocketboxAvatar sets it up
const gltf = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf, model = gltf.scene;
const rest = new Map(); model.traverse(o => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
{
  const mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).play(); mixer.update(0); model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(1.86 / (bounds.max.y - bounds.min.y)); model.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(model); model.position.y -= bounds.min.y;
  mixer.stopAllAction(); mixer.uncacheRoot(model);
}
const baseline = model.position.y;
const resetPose = () => { for (const [o, [p, q, s]] of rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); } };
const bones = data.bones.map(name => model.getObjectByName(name));
if (bones.some(b => !b)) throw new Error('bone missing: ' + data.bones.filter((n, i) => !bones[i]).join(','));
const pelvis = model.getObjectByName('Bip01_Pelvis');
const meshes = []; model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
// Per vertex: which shoe it belongs to (0 none, 1 left, 2 right); per mesh: a clay colour.
for (const mesh of meshes) {
  const w = mesh.geometry.getAttribute('skinWeight'), j = mesh.geometry.getAttribute('skinIndex'), shoe = new Uint8Array(w.count);
  for (let v = 0; v < w.count; v++) {
    let left = 0, right = 0;
    for (let k = 0; k < 4; k++) { const n = mesh.skeleton.bones[j.getComponent(v, k)].name, x = w.getComponent(v, k); if (/L_(Foot|Toe)/.test(n)) left += x; if (/R_(Foot|Toe)/.test(n)) right += x; }
    shoe[v] = left > .6 ? 1 : right > .6 ? 2 : 0;
  }
  const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name.toLowerCase();
  mesh.userData.shoe = shoe;
  mesh.userData.tex = textureOf[(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name];
  mesh.userData.colour = /head/.test(name) ? [196, 152, 124] : /opacity|hair/.test(name) ? [60, 50, 44] : [128, 140, 156];
}

function pose(clip, frame) {
  resetPose();
  const q = new Int16Array(decode(clip.rotations)), p = new Float32Array(decode(clip.pelvis)), n = data.bones.length;
  bones.forEach((bone, b) => bone.quaternion.set(q[(frame * n + b) * 4] / 32767, q[(frame * n + b) * 4 + 1] / 32767, q[(frame * n + b) * 4 + 2] / 32767, q[(frame * n + b) * 4 + 3] / 32767).normalize());
  pelvis.position.set(p[frame * 3], p[frame * 3 + 1], p[frame * 3 + 2]);
}
const mod1 = x => ((x % 1) + 1) % 1;
const planted = (clip, phase, side) => { const c = clip.contacts[side]; return mod1(phase - c.phase) <= c.duration; };

// ---------- geometry: a triangle list [x,y,z]*3 + colour
function quad(list, a, b, c, d, colour) { list.push([a, b, c, colour], [a, c, d, colour]); }
function stairs(row) {
  const list = [], { clip } = row, dir = clip.direction ?? 1;
  if (clip.kind === 'flat') {
    for (let z = -2; z < 4; z += .5) {
      quad(list, [-.8, 0, z], [.8, 0, z], [.8, 0, z + .5], [-.8, 0, z + .5], (Math.round(z * 2) & 1) ? [214, 208, 198] : [226, 221, 212]);
      quad(list, [-.8, .001, z - .004], [.8, .001, z - .004], [.8, .001, z + .004], [-.8, .001, z + .004], [150, 144, 136]);
    }
    return list;
  }
  const R = clip.riser, G = clip.going, sigma = clip.turn, r = clip.radius;
  const top = k => dir * R * (k + .5);
  const at = (u, rho, y) => {   // world point on the flight
    if (!sigma) return [rho, y, u * G];
    const a = u * G / r, cx = sigma * r; return [cx - sigma * rho * Math.cos(a), y, rho * Math.sin(a)];
  };
  // lateral range: straight +-0.55 m; spiral: the real annulus .36..2.47, clipped to 0.7 m either side of the walking line
  const lat = sigma ? [Math.max(.36, r - .7), Math.min(2.47, r + .7)] : [-.55, .55];
  const toRho = x => sigma ? x : x;   // straight: rho is x
  const segs = sigma ? 6 : 1;
  for (let k = Math.floor(clip.rootTreadAtStart) - 4; k <= Math.ceil(clip.rootTreadAtStart) + 5; k++) {
    const y = top(k), light = (k & 1) ? [222, 215, 203] : [232, 226, 215], side = [186, 178, 166];
    for (let s = 0; s < segs; s++) {
      const u0 = k + s / segs, u1 = k + (s + 1) / segs, [i, o] = lat.map(toRho);
      quad(list, at(u0, i, y), at(u0, o, y), at(u1, o, y), at(u1, i, y), light);
      quad(list, at(u0, i, y - .6), at(u0, i, y), at(u1, i, y), at(u1, i, y - .6), side);
      quad(list, at(u0, o, y - .6), at(u0, o, y), at(u1, o, y), at(u1, o, y - .6), side);
    }
    // risers at both ends of the tread
    for (const u of [k, k + 1]) {
      const [i, o] = lat.map(toRho);
      quad(list, at(u, i, y - .6), at(u, o, y - .6), at(u, o, y), at(u, i, y), side);
    }
    // tread centre line
    const [i, o] = lat.map(toRho), c = k + .5, half = .006 / G;
    for (let s = 0; s < segs; s++) {
      const r0 = i + (o - i) * s / segs, r1 = i + (o - i) * (s + 1) / segs;
      quad(list, at(c - half, r0, y + .001), at(c - half, r1, y + .001), at(c + half, r1, y + .001), at(c + half, r0, y + .001), [96, 90, 84]);
    }
  }
  return list;
}
// Root placement in the world for a phase: straight / flat along +z; spiral around its column.
function root(row, phase) {
  const c = row.clip;
  if (c.kind === 'flat') return { position: new THREE.Vector3(0, 0, phase * c.cycleDistance), yaw: 0 };
  const u = c.rootTreadAtStart + 2 * phase, dir = c.direction;
  if (!c.turn) return { position: new THREE.Vector3(0, dir * c.riser * u, u * c.going), yaw: 0 };
  const psi = c.turn * u * c.going / c.radius, cx = c.turn * c.radius;
  const off = new THREE.Vector3(-cx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), psi);
  return { position: new THREE.Vector3(cx + off.x, dir * c.riser * u, off.z), yaw: psi };
}

// ---------- rasteriser (orthographic, z-buffered, 2x supersampled)
const PW = 250, PH = 380, SS = 2, PX = PH * SS / 2.7;   // 2.7 m of height per panel
function render(row, phase, target, view) {
  const W = PW * SS, H = PH * SS, rgb = new Uint8ClampedArray(W * H * 3).fill(247), depth = new Float32Array(W * H).fill(Infinity);
  const f = view.clone().negate().normalize(), right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, f);
  const light = new THREE.Vector3(.45, 1, .6).normalize();
  const tris = stairs(row);
  // character
  const frame = Math.round(phase * data.frames) % data.frames, { position, yaw } = root(row, phase);
  pose(row.clip, frame);
  model.position.set(position.x, baseline + position.y, position.z); model.rotation.y = yaw; model.updateMatrixWorld(true);
  const plantedSide = [planted(row.clip, phase, 0), planted(row.clip, phase, 1)];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv'), index = mesh.geometry.index, shoe = mesh.userData.shoe;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z; }
    const n = index ? index.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const ids = [0, 1, 2].map(k => index ? index.getX(t + k) : t + k);
      const s = shoe[ids[0]];
      const tint = s && s === shoe[ids[1]] && s === shoe[ids[2]] && plantedSide[s - 1];
      tris.push([...ids.map(id => [world[id * 3], world[id * 3 + 1], world[id * 3 + 2]]), mesh.userData.colour, ids.map(id => [uv.getX(id), uv.getY(id)]), mesh.userData.tex, tint]);
    }
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const sx = p => (p.clone().sub(target).dot(right)) * PX + W / 2, sy = p => H * .4 - (p.clone().sub(target).dot(up)) * PX, sz = p => p.clone().sub(target).dot(f);
  for (const [p0, p1, p2, colour, uvs, tex, tint] of tris) {
    a.fromArray(p0); b.fromArray(p1); c.fromArray(p2);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize(); if (nrm.dot(f) > 0) nrm.negate();
    const shade = tex ? .58 + .5 * Math.max(0, nrm.dot(light)) : .42 + .58 * Math.max(0, nrm.dot(light));
    const X = [sx(a), sx(b), sx(c)], Y = [sy(a), sy(b), sy(c)], Z = [sz(a), sz(b), sz(c)];
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]); if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(W - 1, Math.ceil(Math.max(...X))), y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(H - 1, Math.ceil(Math.max(...Y)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5;
      const w0 = ((X[1] - px) * (Y[2] - py) - (X[2] - px) * (Y[1] - py)) / area, w1 = ((X[2] - px) * (Y[0] - py) - (X[0] - px) * (Y[2] - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], i = y * W + x;
      if (z >= depth[i]) continue;
      let r = colour[0], g = colour[1], bl = colour[2];
      if (tex) {
        const u = w0 * uvs[0][0] + w1 * uvs[1][0] + w2 * uvs[2][0], v = w0 * uvs[0][1] + w1 * uvs[1][1] + w2 * uvs[2][1];
        const tx = Math.min(tex.w - 1, Math.floor((u - Math.floor(u)) * tex.w)), ty = Math.min(tex.h - 1, Math.floor((v - Math.floor(v)) * tex.h)), k = (ty * tex.w + tx) * 4;
        if (tex.px[k + 3] < 128) continue;   // alpha-tested (eyelashes, hair cards)
        r = tex.px[k]; g = tex.px[k + 1]; bl = tex.px[k + 2];
        if (tint) { r = r * .45 + 40 * .55; g = g * .45 + 190 * .55; bl = bl * .45 + 90 * .55; }
      }
      depth[i] = z; rgb[i * 3] = r * shade; rgb[i * 3 + 1] = g * shade; rgb[i * 3 + 2] = bl * shade;
    }
  }
  // downsample
  const out = new Uint8ClampedArray(PW * PH * 3);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) for (let ch = 0; ch < 3; ch++) {
    let sum = 0; for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += rgb[((y * SS + dy) * W + x * SS + dx) * 3 + ch];
    out[(y * PW + x) * 3 + ch] = sum / (SS * SS);
  }
  return out;
}

// ---------- PNG
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- sheets
const find = (name, flight, radius) => data.clips.find(c => c.name === name && (flight === undefined || c.flight === flight) && (radius === undefined || c.radius === radius));
const SHEETS = {
  'floor-and-gallery': [
    { label: 'Floor walk (1.65 m/s natural)', clip: find('walk') },
    { label: 'Floor run (2.38 m/s natural)', clip: find('run') },
    { label: 'Gallery steps, walking up (17.5 cm risers, 29 cm treads)', clip: find('up-walk', 'gallery') },
    { label: 'Gallery steps, walking down', clip: find('down-walk', 'gallery') },
    { label: 'Gallery steps, running up', clip: find('up-run', 'gallery') },
    { label: 'Gallery steps, running down', clip: find('down-run', 'gallery') },
  ],
  spiral: [
    { label: 'Spiral, walking up, 1.45 m from the column (35 cm treads)', clip: find('up-walk', 'spiral', 1.45) },
    { label: 'Spiral, walking down, 1.45 m', clip: find('down-walk', 'spiral', 1.45) },
    { label: 'Spiral, running up, 1.45 m', clip: find('up-run', 'spiral', 1.45) },
    { label: 'Spiral, running down, 1.45 m', clip: find('down-run', 'spiral', 1.45) },
    { label: 'Spiral, walking up, tight inside line 0.8 m (19 cm treads)', clip: find('up-walk', 'spiral', 0.8) },
    { label: 'Entrance step, walking up (17 cm riser, 34 cm tread)', clip: find('up-walk', 'entrance') },
  ],
};
if (VERSION === 'v2') {
  for (const key of Object.keys(SHEETS)) delete SHEETS[key];
  const c = name => data.clips.find(x => x.name === name);
  SHEETS['v2-walk-jog'] = [
    { label: `Walk (UAL Walk_Loop) — side. Natural ${c('walk').naturalSpeed} m/s, ${c('walk').cycleDistance} m per two steps`, clip: c('walk') },
    { label: 'Walk — front three-quarter', clip: c('walk'), view: 'front' },
    { label: 'Formal walk (UAL Walk_Formal_Loop) — side', clip: c('walk-formal') },
    { label: 'Formal walk — front three-quarter', clip: c('walk-formal'), view: 'front' },
    { label: `Jog (UAL Jog_Fwd_Loop) — side. Natural ${c('jog').naturalSpeed} m/s, ${c('jog').cycleDistance} m per two steps`, clip: c('jog') },
    { label: 'Jog — front three-quarter', clip: c('jog'), view: 'front' },
  ];
}
if (VERSION === 'v3' || VERSION === 'v4') {
  for (const key of Object.keys(SHEETS)) delete SHEETS[key];
  SHEETS[VERSION + '-floor'] = [
    { label: 'Walk — side', clip: find('walk') },
    { label: 'Walk — front three-quarter', clip: find('walk'), view: 'front' },
    { label: 'Run — side', clip: find('jog') },
    { label: 'Run — front three-quarter', clip: find('jog'), view: 'front' },
  ];
  SHEETS[VERSION + '-gallery'] = [
    { label: 'Gallery steps, walking UP (17.5 cm risers, 29 cm treads) — side', clip: find('up-walk', 'gallery') },
    { label: 'Gallery steps, walking UP — front three-quarter', clip: find('up-walk', 'gallery'), view: 'front' },
    { label: 'Gallery steps, walking DOWN — side', clip: find('down-walk', 'gallery') },
    { label: 'Gallery steps, walking DOWN — front three-quarter', clip: find('down-walk', 'gallery'), view: 'front' },
    { label: 'Entrance step, walking UP (17 cm riser, 34 cm tread) — side', clip: find('up-walk', 'entrance') },
    { label: 'Entrance step, walking DOWN — side', clip: find('down-walk', 'entrance') },
  ];
  SHEETS[VERSION + '-spiral'] = [
    { label: 'Spiral, walking UP, 1.45 m from the column (35 cm treads) — outside view', clip: find('up-walk', 'spiral', 1.45) },
    { label: 'Spiral, walking UP, 1.45 m — front three-quarter', clip: find('up-walk', 'spiral', 1.45), view: 'front' },
    { label: 'Spiral, walking DOWN, 1.45 m — outside view', clip: find('down-walk', 'spiral', 1.45) },
    { label: 'Spiral, walking DOWN, 1.45 m — front three-quarter', clip: find('down-walk', 'spiral', 1.45), view: 'front' },
    { label: 'Spiral, walking UP, inner line 1.1 m (26 cm treads)', clip: find('up-walk', 'spiral', 1.1) },
    { label: 'Spiral, walking DOWN, outer line 2.2 m (53 cm treads)', clip: find('down-walk', 'spiral', 2.2) },
  ];
}
const COLS = 8, GAP = 6, LABEL = 30, TOP = 26;
for (const [sheet, rows] of Object.entries(SHEETS)) {
  const width = COLS * PW + (COLS + 1) * GAP, height = TOP + rows.length * (PH + LABEL + GAP) + GAP;
  const canvas = new Uint8ClampedArray(width * height * 3).fill(255);
  rows.forEach((row, r) => {
    const mid = root(row, .5), side = row.clip.turn > 0 ? -1 : 1;
    const target = mid.position.clone().add(new THREE.Vector3(0, .95, 0));
    // view from the walker's left (the outside of the spiral going up), a little in front and above
    const forward = new THREE.Vector3(Math.sin(mid.yaw), 0, Math.cos(mid.yaw)), left = new THREE.Vector3(Math.cos(mid.yaw), 0, -Math.sin(mid.yaw));
    const view = row.view === 'front' ? left.multiplyScalar(side * .75).addScaledVector(forward, .9).add(new THREE.Vector3(0, .12, 0)).normalize() : left.multiplyScalar(side).addScaledVector(forward, .12).add(new THREE.Vector3(0, .1, 0)).normalize();
    for (let k = 0; k < COLS; k++) {
      const follow = row.clip.kind === 'flat' ? root(row, k / COLS).position.clone().add(new THREE.Vector3(0, .95, 0)) : target;
      const img = render(row, k / COLS, follow, view), ox = GAP + k * (PW + GAP), oy = TOP + r * (PH + LABEL + GAP) + LABEL;
      for (let y = 0; y < PH; y++) canvas.set(img.subarray(y * PW * 3, (y + 1) * PW * 3), ((oy + y) * width + ox) * 3);
    }
    process.stdout.write(`${sheet} row ${r + 1}/${rows.length}\n`);
  });
  const pngBytes = png(width, height, canvas);
  fs.writeFileSync(OUT + sheet + '.png', pngBytes);
  const text = [
    `<text x="${GAP}" y="18" font-size="15" font-weight="600">MD visitor locomotion, baked clips (locomotion-${VERSION}). Columns: one cycle = two steps, 1/8 cycle apart. Green shoe = planted; dark line = tread centre.</text>`,
    ...rows.map((row, r) => `<text x="${GAP}" y="${TOP + r * (PH + LABEL + GAP) + 21}" font-size="15">${row.label}</text>`),
  ].join('');
  fs.writeFileSync(OUT + sheet + '.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif" fill="#222"><image width="${width}" height="${height}" href="data:image/png;base64,${pngBytes.toString('base64')}"/>${text}</svg>`);
  console.log('wrote', OUT + sheet + '.png', (pngBytes.length / 1024).toFixed(0), 'KB');
}
