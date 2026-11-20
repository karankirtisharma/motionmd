import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

const SIZE = 512;

function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** One tileable gradient-noise layer, roughly -0.7…0.7, with `period` cells across the tile. */
function noiseLayer(period: number, seed: number) {
  const out = new Float32Array(SIZE * SIZE), gx = new Float32Array(period * period), gy = new Float32Array(period * period);
  for (let i = 0; i < period * period; i++) { const angle = hash(i % period, i / period | 0, seed) * Math.PI * 2; gx[i] = Math.cos(angle); gy[i] = Math.sin(angle); }
  const cell = new Int32Array(SIZE), next = new Int32Array(SIZE), part = new Float32Array(SIZE), fade = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const p = (i + 0.5) / SIZE * period, t = p - Math.floor(p);
    cell[i] = Math.floor(p); next[i] = (cell[i] + 1) % period; part[i] = t; fade[i] = t * t * t * (t * (t * 6 - 15) + 10);
  }
  for (let y = 0, index = 0; y < SIZE; y++) {
    const row = cell[y] * period, above = next[y] * period, ty = part[y], b = fade[y];
    for (let x = 0; x < SIZE; x++, index++) {
      const c = cell[x], n = next[x], tx = part[x], a = fade[x];
      const bottom = (gx[row + c] * tx + gy[row + c] * ty) * (1 - a) + (gx[row + n] * (tx - 1) + gy[row + n] * ty) * a;
      const top = (gx[above + c] * tx + gy[above + c] * (ty - 1)) * (1 - a) + (gx[above + n] * (tx - 1) + gy[above + n] * (ty - 1)) * a;
      out[index] = bottom * (1 - b) + top * b;
    }
  }
  return out;
}

/**
 * Packed, deterministic, tileable surface data.
 * R tone variation, G ripple height (cavity/roughness), B and A the height slope along U and V
 * (0.5 = flat). Storing the slope lets the material shade ripples from the samples it already
 * takes, and mip filtering fades them to flat instead of letting them shimmer.
 */
export function createSandSurfaceTexture() {
  const size = SIZE, mask = size - 1, data = new Uint8Array(size * size * 4), height = new Float32Array(size * size);
  const low = noiseLayer(3, 17), medium = noiseLayer(8, 53), fine = noiseLayer(21, 97), swell = noiseLayer(6, 211), drift = noiseLayer(5, 401), kink = noiseLayer(13, 641);
  const wave = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) wave[i] = Math.cos(i / 1024 * Math.PI * 2);
  const cosine = (cycles: number) => { const f = (cycles - Math.floor(cycles)) * 1024, i = f | 0; return wave[i] + (wave[i + 1] - wave[i]) * (f - i); };
  for (let y = 0, index = 0; y < size; y++) for (let x = 0; x < size; x++, index++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    // Three wind-ripple trains of slightly different spacing and heading. Where they fall out of
    // step the crests fork and die out, as real ripples do, instead of running as ruled lines.
    const warp = low[index] * 0.6 + medium[index] * 0.34 + kink[index] * 0.13, bend = drift[index] * 0.7 - kink[index] * 0.1;
    const p1 = 36 * u + v + warp, p2 = 38 * u - 4 * v + bend + 0.31, p3 = 33 * u + 5 * v - warp * 0.6 + bend + 0.67;
    const re = cosine(p1) + 0.8 * cosine(p2) + 0.55 * cosine(p3), im = cosine(p1 - 0.25) + 0.8 * cosine(p2 - 0.25) + 0.55 * cosine(p3 - 0.25);
    const length = Math.sqrt(re * re + im * im) + 1e-6, sine = im / length, skew = 0.42 * sine, strength = length / 2.35;
    // sin(theta - 0.42 sin(theta)): a gentle windward side and a steeper lee side.
    const profile = sine * (1 - skew * skew * 0.5) - re / length * (skew - skew * skew * skew / 6);
    const ripple = strength / (strength + 0.22) * 1.22 * profile;
    // Ripples plus a soft swell about seven ripples long, in units where both give similar slopes.
    height[index] = ripple / 345 + (swell[index] * 0.75 + medium[index] * 0.25) / 30;
    data[index * 4] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + low[index] * 0.34 + medium[index] * 0.26 + fine[index] * 0.18 + ripple * 0.035 + (hash(x, y, 139) - 0.5) * 0.11)));
    data[index * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + ripple * 0.3 + swell[index] * 0.16 + fine[index] * 0.1 + (hash(x, y, 311) - 0.5) * 0.12)));
  }
  for (let y = 0, index = 0; y < size; y++) for (let x = 0; x < size; x++, index++) {
    const du = (height[y * size + (x + 1 & mask)] - height[y * size + (x - 1 & mask)]) * size * 0.5;
    const dv = (height[(y + 1 & mask) * size + x] - height[(y - 1 & mask) * size + x]) * size * 0.5;
    data[index * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + du * 0.5)));
    data[index * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dv * 0.5)));
  }
  const surface = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  surface.name = 'MD | static packed sand surface'; surface.colorSpace = NoColorSpace;
  surface.wrapS = surface.wrapT = RepeatWrapping;
  surface.minFilter = LinearMipmapLinearFilter; surface.magFilter = LinearFilter;
  surface.generateMipmaps = true; surface.anisotropy = 4; surface.needsUpdate = true;
  return surface;
}
