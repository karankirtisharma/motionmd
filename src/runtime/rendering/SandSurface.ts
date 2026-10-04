import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(u: number, v: number, period: number, seed: number) {
  const x = u * period, y = v * period, ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const a = tx * tx * (3 - 2 * tx), b = ty * ty * (3 - 2 * ty);
  const sample = (dx: number, dy: number) => hash((ix + dx) % period, (iy + dy) % period, seed);
  const bottom = sample(0, 0) * (1 - a) + sample(1, 0) * a;
  const top = sample(0, 1) * (1 - a) + sample(1, 1) * a;
  return bottom * (1 - b) + top * b;
}

/** Packed, deterministic surface data: R variation, G roughness, B ripple height. */
export function createSandSurfaceTexture() {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    const low = periodicNoise(u, v, 5, 17), medium = periodicNoise(u, v, 19, 53);
    const detail = periodicNoise(u, v, 67, 97), grain = hash(x, y, 139);
    const ripple = Math.sin(2 * Math.PI * (u * 42 + low * 0.42 + Math.sin(v * Math.PI * 6) * 0.19));
    const index = (y * size + x) * 4;
    data[index] = Math.round(255 * (low * 0.5 + medium * 0.35 + detail * 0.15));
    data[index + 1] = Math.round(255 * (0.45 + detail * 0.4 + grain * 0.15));
    data[index + 2] = Math.round(255 * (0.5 + ripple * 0.25 + (detail - 0.5) * 0.18 + (grain - 0.5) * 0.04));
    data[index + 3] = 255;
  }
  const surface = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  surface.name = 'MD | static packed sand surface'; surface.colorSpace = NoColorSpace;
  surface.wrapS = surface.wrapT = RepeatWrapping;
  surface.minFilter = LinearMipmapLinearFilter; surface.magFilter = LinearFilter;
  surface.generateMipmaps = true; surface.anisotropy = 4; surface.needsUpdate = true;
  return surface;
}
