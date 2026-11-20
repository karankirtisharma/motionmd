import { DataUtils, Vector3, type Mesh, type Texture } from 'three';

const LEVEL = [3.5, 4.6];     // the same walking surfaces as floorLightBalance.ts
const WIDTH = [0.03, 0.4];    // metres: wider than a chamfer, narrower than any walkable slab
const FLUSH = 0.006;          // metres: a neighbour this level with a strip is the same floor
const RADIUS = 0.6, STEP = 0.1, SIGMA = 0.25; // metres: where a strip looks for its neighbours' light
const CELL = 0.25;            // metres: lookup grid for "which face is the floor here"

type Floor = { mesh: Mesh; material: { lightMap: Texture | null; lightMapIntensity?: number } };
type Pixels = { data: Uint16Array | Float32Array; width: number; height: number };
// World x,z and lightmap texel coordinates of the three corners of one top face.
type Triangle = { floor: Floor; island: number; y: number; p: number[]; t: number[] };

/** An edge band or threshold strip of the upper floor is a separate slab only a few
 * lightmap texels wide: it was baked noisy and at its own level, so it reads as a darker,
 * blotchy strip between two hard lines. A gain map cannot repair texel noise, so before
 * the balance is built, rewrite those few texels with the baked light of the wide slabs
 * the strip is level with. Load time only; the shader is unchanged. */
export function relightNarrowSlabs(floors: Floor[]) {
  const started = performance.now();
  const islands: { area: number; box: number[]; faces: Triangle[] }[] = [], cells = new Map<number, Triangle[]>();
  const cell = (x: number, z: number) => (Math.floor(x / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  for (const floor of floors) {
    const map = floor.material.lightMap!, image = map.image as Pixels;
    const geometry = floor.mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
    const uv = geometry.getAttribute(`uv${map.channel || ''}`), world = floor.mesh.matrixWorld;
    // Faces that share a lightmap vertex belong to one slab.
    const parent = new Map<string, string>(), ids = new Map<string, number>();
    const find = (key: string): string => { const up = parent.get(key); if (up === undefined || up === key) return key; const root = find(up); parent.set(key, root); return root; };
    const found: [Triangle, string][] = [], count = index ? index.count : position.count;
    for (let t = 0; t < count; t += 3) {
      const corners = [0, 1, 2].map(n => index ? index.getX(t + n) : t + n);
      a.fromBufferAttribute(position, corners[0]).applyMatrix4(world);
      if (a.y < LEVEL[0] || a.y > LEVEL[1]) continue;
      b.fromBufferAttribute(position, corners[1]).applyMatrix4(world); c.fromBufferAttribute(position, corners[2]).applyMatrix4(world);
      if (Math.abs(b.y - a.y) > 0.02 || Math.abs(c.y - a.y) > 0.02) continue;
      if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).y <= 0) continue;              // top faces only
      const keys = corners.map(i => `${Math.round(uv.getX(i) * 1e5)},${Math.round(uv.getY(i) * 1e5)}`);
      parent.set(find(keys[1]), find(keys[0])); parent.set(find(keys[2]), find(keys[0]));
      const texels = corners.flatMap(i => [(uv.getX(i) * map.repeat.x + map.offset.x) * image.width, (uv.getY(i) * map.repeat.y + map.offset.y) * image.height]);
      found.push([{ floor, island: 0, y: a.y, p: [a.x, a.z, b.x, b.z, c.x, c.z], t: texels }, keys[0]]);
    }
    for (const [face, key] of found) {
      const root = find(key), p = face.p;
      if (!ids.has(root)) { ids.set(root, islands.length); islands.push({ area: 0, box: [Infinity, -Infinity, Infinity, -Infinity], faces: [] }); }
      const island = islands[face.island = ids.get(root)!], box = [Math.min(p[0], p[2], p[4]), Math.max(p[0], p[2], p[4]), Math.min(p[1], p[3], p[5]), Math.max(p[1], p[3], p[5])];
      island.area += Math.abs((p[2] - p[0]) * (p[5] - p[1]) - (p[4] - p[0]) * (p[3] - p[1])) / 2; island.faces.push(face);
      island.box = [Math.min(island.box[0], box[0]), Math.max(island.box[1], box[1]), Math.min(island.box[2], box[2]), Math.max(island.box[3], box[3])];
      for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[1] / CELL); x++) for (let z = Math.floor(box[2] / CELL); z <= Math.floor(box[3] / CELL); z++) {
        const key = cell(x * CELL, z * CELL), list = cells.get(key);
        if (list) list.push(face); else cells.set(key, [face]);
      }
    }
  }
  const narrow = islands.map(({ area, box }) => { const width = area / Math.max(box[1] - box[0], box[3] - box[2], 1e-6); return width >= WIDTH[0] && width < WIDTH[1]; });

  // Barycentric weights of (x, y) in the triangle whose corners are q[0..5].
  const weights = (q: number[], x: number, y: number, out: number[]) => {
    const d = (q[3] - q[5]) * (q[0] - q[4]) + (q[4] - q[2]) * (q[1] - q[5]);
    out[0] = ((q[3] - q[5]) * (x - q[4]) + (q[4] - q[2]) * (y - q[5])) / d; out[1] = ((q[5] - q[1]) * (x - q[4]) + (q[0] - q[4]) * (y - q[5])) / d; out[2] = 1 - out[0] - out[1];
    return d;
  };
  // The floor seen from above at (x, z): the highest top face there, its weights left in `hit`.
  const w = [0, 0, 0], v = [0, 0, 0], hit = [0, 0, 0];
  const surfaceAt = (x: number, z: number) => {
    let top: Triangle | undefined;
    for (const face of cells.get(cell(x, z)) ?? []) {
      if (top && face.y <= top.y) continue;
      weights(face.p, x, z, v);
      if (v[0] < -1e-3 || v[1] < -1e-3 || v[2] < -1e-3) continue;
      top = face; hit[0] = v[0]; hit[1] = v[1]; hit[2] = v[2];
    }
    return top;
  };
  // Only a wide slab that is the visible floor there, level with the strip, lends its light.
  const lender = (x: number, z: number, y: number) => { const top = surfaceAt(x, z); return top && !narrow[top.island] && Math.abs(top.y - y) <= FLUSH ? top : undefined; };
  const channelsOf = (image: Pixels) => Math.round(image.data.length / (image.width * image.height));
  const read = (image: Pixels, at: number) => image.data instanceof Uint16Array ? DataUtils.fromHalfFloat(image.data[at]) : image.data[at];
  const taps: number[] = [];
  for (let z = -RADIUS; z <= RADIUS + 1e-6; z += STEP) for (let x = -RADIUS; x <= RADIUS + 1e-6; x += STEP) if (x * x + z * z <= RADIUS * RADIUS + 1e-6) taps.push(x, z, Math.exp(-0.5 * (x * x + z * z) / (SIGMA * SIGMA)));
  const tap = new Float32Array(taps.length / 3 * 4);
  const relit: Record<string, unknown>[] = [];

  islands.forEach((island, id) => {
    if (!narrow[id]) return;
    const { faces, box } = island, { floor, y } = faces[0];
    // A strip with level neighbours along only part of its length (a stair tread) keeps its own bake.
    let reached = 0;
    for (const { p } of faces) for (let n = 0; n < taps.length; n += 3) {
      if (!lender((p[0] + p[2] + p[4]) / 3 + taps[n], (p[1] + p[3] + p[5]) / 3 + taps[n + 1], y)) continue;
      reached += Math.abs((p[2] - p[0]) * (p[5] - p[1]) - (p[4] - p[0]) * (p[3] - p[1])) / 2; break;
    }
    if (reached < island.area * 0.9) return;
    const map = floor.material.lightMap!, image = map.image as Pixels, channels = channelsOf(image), intensity = floor.material.lightMapIntensity ?? 1;
    const seen = new Set<number>(), pending: number[] = [];
    let visible = 0;
    for (const { t, p } of faces) {
      const x0 = Math.max(0, Math.floor(Math.min(t[0], t[2], t[4]) - 1)), x1 = Math.min(image.width - 1, Math.ceil(Math.max(t[0], t[2], t[4]) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(t[1], t[3], t[5]) - 1)), y1 = Math.min(image.height - 1, Math.ceil(Math.max(t[1], t[3], t[5]) + 1));
      const edges = [Math.hypot(t[2] - t[4], t[3] - t[5]), Math.hypot(t[4] - t[0], t[5] - t[1]), Math.hypot(t[0] - t[2], t[1] - t[3])];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const texel = ty * image.width + tx, d = Math.abs(weights(t, tx + 0.5, ty + 0.5, w));
        // The strip's own texels plus the rim that bilinear filtering reads.
        if (seen.has(texel) || !(d > 1e-9) || Math.min(w[0] * d / edges[0], w[1] * d / edges[1], w[2] * d / edges[2]) < -0.75) continue;
        seen.add(texel);
        const px = p[0] * w[0] + p[2] * w[1] + p[4] * w[2], pz = p[1] * w[0] + p[3] * w[1] + p[5] * w[2];
        if ((surfaceAt(px, pz)?.y ?? y) > y + FLUSH) continue;                          // under a step or another slab
        visible++;
        let brightest = 0, used = 0;
        for (let n = 0; n < taps.length; n += 3) {
          const top = lender(px + taps[n], pz + taps[n + 1], y);
          if (!top) continue;
          const source = top.floor.material.lightMap!.image as Pixels, k = channelsOf(source), gain = (top.floor.material.lightMapIntensity ?? 1) / intensity, s = top.t;
          const sx = Math.min(source.width - 1, Math.max(0, Math.floor(s[0] * hit[0] + s[2] * hit[1] + s[4] * hit[2]))), sy = Math.min(source.height - 1, Math.max(0, Math.floor(s[1] * hit[0] + s[3] * hit[1] + s[5] * hit[2])));
          const at = (sy * source.width + sx) * k, red = read(source, at) * gain, green = k >= 3 ? read(source, at + 1) * gain : red, blue = k >= 3 ? read(source, at + 2) * gain : red;
          tap[used * 4] = red; tap[used * 4 + 1] = green; tap[used * 4 + 2] = blue; tap[used * 4 + 3] = taps[n + 2]; used++;
          brightest = Math.max(brightest, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
        }
        // Texels hidden under a wall or pier were baked black: they are not the floor's light.
        let red = 0, green = 0, blue = 0, total = 0;
        for (let n = 0; n < used * 4; n += 4) {
          if (0.2126 * tap[n] + 0.7152 * tap[n + 1] + 0.0722 * tap[n + 2] < brightest * 0.15) continue;
          red += tap[n] * tap[n + 3]; green += tap[n + 1] * tap[n + 3]; blue += tap[n + 2] * tap[n + 3]; total += tap[n + 3];
        }
        if (total > 0 && brightest > 1e-4) pending.push(texel, red / total, green / total, blue / total);
      }
    }
    if (!pending.length || pending.length / 4 < visible * 0.9) return;
    for (let n = 0; n < pending.length; n += 4) {
      const value = channels >= 3 ? [pending[n + 1], pending[n + 2], pending[n + 3]] : [0.2126 * pending[n + 1] + 0.7152 * pending[n + 2] + 0.0722 * pending[n + 3]];
      value.forEach((light, channel) => { image.data[pending[n] * channels + channel] = image.data instanceof Uint16Array ? DataUtils.toHalfFloat(light) : light; });
    }
    map.needsUpdate = true;
    relit.push({ mesh: floor.mesh.name, x: [+box[0].toFixed(2), +box[1].toFixed(2)], z: [+box[2].toFixed(2), +box[3].toFixed(2)], y: +y.toFixed(3), texels: pending.length / 4 });
  });
  if (relit.length) console.info('[MD floor narrow slabs]', JSON.stringify(relit), `${Math.round(performance.now() - started)} ms`);
}
