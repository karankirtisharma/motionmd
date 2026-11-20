import { DataTexture, DataUtils, HalfFloatType, LinearFilter, Mesh, RedFormat, Vector2, Vector3, type Object3D, type Texture } from 'three';
import { float, mix, positionWorld, step, texture, vec2 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { BakedPhysicalMaterial } from './BakedPhysicalMaterial';
import { relightNarrowSlabs } from './floorNarrowSlabs';

const CELL = 0.1;            // metres per balance texel
const LEVEL = [3.5, 4.6];    // upper gallery (3.675) and upper floor (4.2) walking surfaces
const REACH = 14;            // cells: the correction fades out 1.4 m from a seam
const BLUR = 8;              // cells: Gaussian radius of the shared target lighting

/** The upper-floor marble is one stone, but its slabs were light-baked in separate
 * sessions, so the baked illumination steps at every slab edge and reads as hard
 * lines and lighter or darker bands. Build one small world-space gain map that, in
 * a band either side of each seam, eases every slab toward the lighting both sides
 * share (a blur of the baked values across the seam). Away from seams the gain is
 * exactly 1, so each slab keeps its own bake; no texture, UV or geometry changes. */
export function balanceFloorLight(root: Object3D): Texture | undefined {
  root.updateMatrixWorld(true);
  type Floor = { mesh: Mesh; material: BakedPhysicalMaterial; id: number };
  const floors: Floor[] = [], ids = new Map<string, number>();
  root.traverse(object => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material;
    if (!(material instanceof BakedPhysicalMaterial) || !material.lightMap || !material.userData.sourceFloorRestored) return;
    const image = material.lightMap.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
    if (!image?.data || !image.width || !image.height || !object.geometry.getAttribute(`uv${material.lightMap.channel || ''}`)) return;
    const key = material.lightMap.source.uuid;
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    floors.push({ mesh: object, material, id: ids.get(key)! });
  });
  relightNarrowSlabs(floors);
  if (ids.size < 2) return undefined;

  // Pass 1: bounds of the walking surfaces on this level.
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const ua = new Vector2(), ub = new Vector2(), uc = new Vector2();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const eachFloorTriangle = (floor: Floor, visit: (uvA: Vector2, uvB: Vector2, uvC: Vector2) => void) => {
    const geometry = floor.mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
    const uv = geometry.getAttribute(`uv${floor.material.lightMap!.channel || ''}`), world = floor.mesh.matrixWorld;
    const count = index ? index.count : position.count;
    for (let t = 0; t < count; t += 3) {
      const i = index ? index.getX(t) : t, j = index ? index.getX(t + 1) : t + 1, k = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(position, i).applyMatrix4(world);
      if (a.y < LEVEL[0] || a.y > LEVEL[1]) continue;
      b.fromBufferAttribute(position, j).applyMatrix4(world); c.fromBufferAttribute(position, k).applyMatrix4(world);
      if (Math.abs(b.y - a.y) > 0.02 || Math.abs(c.y - a.y) > 0.02) continue;
      if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).y <= 0) continue;            // top faces only
      ua.set(uv.getX(i), uv.getY(i)); ub.set(uv.getX(j), uv.getY(j)); uc.set(uv.getX(k), uv.getY(k));
      visit(ua, ub, uc);
    }
  };
  for (const floor of floors) eachFloorTriangle(floor, () => {
    minX = Math.min(minX, a.x, b.x, c.x); maxX = Math.max(maxX, a.x, b.x, c.x);
    minZ = Math.min(minZ, a.z, b.z, c.z); maxZ = Math.max(maxZ, a.z, b.z, c.z);
  });
  if (!Number.isFinite(minX)) return undefined;
  minX -= CELL * 2; minZ -= CELL * 2;
  const nx = Math.min(1024, Math.ceil((maxX - minX) / CELL) + 2), nz = Math.min(1024, Math.ceil((maxZ - minZ) / CELL) + 2);
  const light = new Float32Array(nx * nz), owner = new Uint16Array(nx * nz), height = new Float32Array(nx * nz).fill(-Infinity);

  // Pass 2: rasterise each slab's baked luminance into the grid.
  for (const floor of floors) {
    const map = floor.material.lightMap!, image = map.image as { data: ArrayLike<number>; width: number; height: number };
    const channels = Math.round(image.data.length / (image.width * image.height)), half = image.data instanceof Uint16Array;
    const intensity = floor.material.lightMapIntensity ?? 1;
    const luminance = (u: number, v: number) => {
      const x = Math.min(image.width - 1, Math.max(0, Math.floor((u * map.repeat.x + map.offset.x) * image.width)));
      const y = Math.min(image.height - 1, Math.max(0, Math.floor((v * map.repeat.y + map.offset.y) * image.height)));
      const at = (y * image.width + x) * channels, read = (o: number) => half ? DataUtils.fromHalfFloat(image.data[at + o]) : image.data[at + o];
      return (channels >= 3 ? 0.2126 * read(0) + 0.7152 * read(1) + 0.0722 * read(2) : read(0)) * intensity;
    };
    eachFloorTriangle(floor, (uvA, uvB, uvC) => {
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / CELL)), x1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / CELL));
      const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - minZ) / CELL)), z1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - minZ) / CELL));
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) return;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const px = minX + (x + 0.5) * CELL, pz = minZ + (z + 0.5) * CELL;
        const w0 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d, w1 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d, w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const cell = z * nx + x, y = a.y * w0 + b.y * w1 + c.y * w2;
        if (y <= height[cell]) continue;                                                // the visible top surface wins
        const value = luminance(uvA.x * w0 + uvB.x * w1 + uvC.x * w2, uvA.y * w0 + uvB.y * w1 + uvC.y * w2);
        if (!(value > 1e-4)) continue;
        height[cell] = y; light[cell] = value; owner[cell] = floor.id;
      }
    });
  }

  // Shared target: a normalised Gaussian blur of the baked light across slab edges.
  const kernel = Float32Array.from({ length: BLUR * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - BLUR) / (BLUR / 2)) ** 2));
  const blur = (source: Float32Array, weight: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(nx * nz), outWeight = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let sum = 0, total = 0;
      for (let k = -BLUR; k <= BLUR; k++) {
        const sx = horizontal ? x + k : x, sz = horizontal ? z : z + k;
        if (sx < 0 || sz < 0 || sx >= nx || sz >= nz) continue;
        const cell = sz * nx + sx, w = kernel[k + BLUR] * weight[cell];
        sum += source[cell] * w; total += w;
      }
      out[z * nx + x] = total > 0 ? sum / total : 0; outWeight[z * nx + x] = total > 0 ? 1 : 0;
    }
    return [out, outWeight] as const;
  };
  const covered = Float32Array.from(owner, id => id ? 1 : 0);
  const [rows, rowWeight] = blur(light, covered, true);
  const [target] = blur(rows, rowWeight, false);

  // Distance (in cells) from the nearest edge between two different bakes.
  const distance = new Uint8Array(nx * nz).fill(255);
  let frontier: number[] = [];
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const cell = z * nx + x, id = owner[cell];
    if (!id) continue;
    const other = (n: number) => owner[n] !== 0 && owner[n] !== id;
    if ((x > 0 && other(cell - 1)) || (x < nx - 1 && other(cell + 1)) || (z > 0 && other(cell - nx)) || (z < nz - 1 && other(cell + nx))) { distance[cell] = 0; frontier.push(cell); }
  }
  let seams = frontier.length;
  for (let step = 1; step <= REACH && frontier.length; step++) {
    const next: number[] = [];
    for (const cell of frontier) for (const n of [cell - 1, cell + 1, cell - nx, cell + nx]) {
      if (n < 0 || n >= nx * nz || !owner[n] || distance[n] !== 255) continue;
      if (Math.abs((n % nx) - (cell % nx)) > 1) continue;                               // no wrap across rows
      distance[n] = step; next.push(n);
    }
    frontier = next;
  }

  const gain = new Uint16Array(nx * nz);
  const one = DataUtils.toHalfFloat(1);
  for (let cell = 0; cell < nx * nz; cell++) {
    if (!owner[cell] || distance[cell] === 255 || !(target[cell] > 0)) { gain[cell] = one; continue; }
    const t = 1 - distance[cell] / REACH, weight = t * t * (3 - 2 * t);
    gain[cell] = DataUtils.toHalfFloat(Math.min(2.5, Math.max(0.4, Math.pow(target[cell] / light[cell], weight))));
  }
  const balance = new DataTexture(gain, nx, nz, RedFormat, HalfFloatType);
  balance.name = 'Upper floor | baked light balance';
  balance.magFilter = balance.minFilter = LinearFilter; balance.generateMipmaps = false; balance.flipY = false; balance.needsUpdate = true;

  const sampled = texture(balance, positionWorld.xz.sub(vec2(minX, minZ)).div(vec2(nx * CELL, nz * CELL))).r;
  const onLevel = step(float(LEVEL[0]), positionWorld.y).mul(step(positionWorld.y, float(LEVEL[1])));
  const node = mix(float(1), sampled, onLevel) as unknown as Node<'float'>;
  const materials = new Set(floors.map(floor => floor.material));
  for (const material of materials) { material.lightBalanceNode = node; material.needsUpdate = true; }
  console.info('[MD floor light balance]', { slabs: floors.length, bakes: ids.size, materials: materials.size, grid: [nx, nz], seamCells: seams });
  return balance;
}
