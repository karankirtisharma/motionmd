/**
 * Procedural studio environment and key-light cookie.
 *
 * The kit ships E01_studio_warm.hdr as optional analytical lighting data (three
 * soft panels on a neutral field; see lighting_recipe.json). In the browser the
 * same idea is rebuilt as a few kilobytes of code: a warm ivory cyclorama with
 * soft panels, so the bronze reflects the room the visitor sees in the artwork
 * and no HDR download competes with the real scene.
 */
import {
  CanvasTexture,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';

const DEG = Math.PI / 180;
const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function angleDelta(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * @param {object} spec
 * @param {number[]} spec.zenith   linear RGB radiance straight up
 * @param {number[]} spec.horizon  linear RGB radiance at the horizon
 * @param {number[]} spec.nadir    linear RGB radiance straight down (studio floor)
 * @param {Array<{azimuthDeg:number,elevationDeg:number,widthDeg:number,heightDeg:number,radiance:number[],softDeg?:number}>} spec.panels
 * Azimuth 0 is +X, 90 is +Z (towards the default camera side), measured in the XZ plane.
 */
export function buildStudioEnvironment(spec, { width = 256, height = 128 } = {}) {
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j += 1) {
    const elevation = ((j + 0.5) / height) * 180 - 90;
    const up = Math.sin(elevation * DEG);
    for (let i = 0; i < width; i += 1) {
      const azimuth = ((i + 0.5) / width - 0.5) * 360;
      const o = (j * width + i) * 4;
      // Cyclorama: floor below, a bright seamless horizon band, softer ceiling.
      const toHorizon = 1 - Math.abs(up);
      const band = toHorizon ** (spec.horizonSharpness ?? 3);
      const pole = up >= 0 ? spec.zenith : spec.nadir;
      let r = pole[0] + (spec.horizon[0] - pole[0]) * band;
      let g = pole[1] + (spec.horizon[1] - pole[1]) * band;
      let b = pole[2] + (spec.horizon[2] - pole[2]) * band;
      // A broad directional warm-to-cool drift so reflections are not uniform.
      if (spec.drift) {
        const k = 0.5 + 0.5 * Math.cos(angleDelta(azimuth, spec.drift.azimuthDeg) * DEG);
        const gain = 1 + (spec.drift.gain - 1) * k;
        r *= gain; g *= gain; b *= gain;
      }
      for (const panel of spec.panels) {
        const soft = panel.softDeg ?? 6;
        const dx = Math.abs(angleDelta(azimuth, panel.azimuthDeg)) * Math.max(0.05, Math.cos(elevation * DEG));
        const dy = Math.abs(elevation - panel.elevationDeg);
        const wx = 1 - smooth(panel.widthDeg / 2 - soft / 2, panel.widthDeg / 2 + soft / 2, dx);
        const wy = 1 - smooth(panel.heightDeg / 2 - soft / 2, panel.heightDeg / 2 + soft / 2, dy);
        const w = wx * wy;
        if (w <= 0) continue;
        r += panel.radiance[0] * w;
        g += panel.radiance[1] * w;
        b += panel.radiance[2] * w;
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Positions are fractions of the cookie; the cookie spans the key light's cone.
const DEFAULT_BRANCHES = [
  // Behind and to the right of the plinth, where the long shadow falls.
  { x: 0.74, y: 0.3, spread: 0.16, heading: 2.5, twigs: 8, alpha: 0.5 },
  // In front and to the right, at the foot of the page.
  { x: 0.8, y: 0.6, spread: 0.14, heading: 2.9, twigs: 6, alpha: 0.42 },
];

/**
 * Key-light cookie: the soft shadow of a branch just out of frame, plus two
 * faint architectural bands. White lets the light through.
 * Returns a controller that redraws the texture at a given strength.
 */
export function createKeyCookie({ size = 512, seed = 11, branches = DEFAULT_BRANCHES, blurSteps = [0.25] } = {}) {
  const pattern = document.createElement('canvas');
  pattern.width = pattern.height = size;
  const p = pattern.getContext('2d');
  p.fillStyle = '#fff';
  p.fillRect(0, 0, size, size);

  const random = mulberry(seed);

  // Twigs and leaves entering from one corner. The rest stays clear so the
  // model and the copy side of the page keep clean light.
  function leaf(x, y, length, angle, alpha) {
    p.save();
    p.translate(x, y);
    p.rotate(angle);
    p.fillStyle = `rgba(36,20,8,${alpha})`;
    p.beginPath();
    p.moveTo(0, 0);
    p.bezierCurveTo(length * 0.35, -length * 0.42, length * 0.85, -length * 0.22, length, 0);
    p.bezierCurveTo(length * 0.85, length * 0.22, length * 0.35, length * 0.42, 0, 0);
    p.fill();
    p.restore();
  }
  for (const branch of branches) {
    for (let t = 0; t < branch.twigs; t += 1) {
      let x = size * (branch.x + (random() - 0.5) * branch.spread);
      let y = size * (branch.y + (random() - 0.5) * branch.spread);
      let heading = branch.heading + (random() - 0.5) * 0.9;
      const steps = 7 + Math.floor(random() * 5);
      for (let i = 0; i < steps; i += 1) {
        heading += (random() - 0.5) * 0.4;
        const stride = size * (0.022 + random() * 0.014);
        x += Math.cos(heading) * stride;
        y += Math.sin(heading) * stride;
        const side = i % 2 ? 1 : -1;
        const length = size * (0.026 + random() * 0.024);
        leaf(x, y, length, heading + side * (0.75 + random() * 0.5), branch.alpha * (0.7 + random() * 0.3));
        if (random() > 0.5) leaf(x, y, length * 0.8, heading - side * (0.6 + random() * 0.5), branch.alpha * (0.55 + random() * 0.3));
      }
    }
  }

  // Soften with a cheap, universally supported blur: shrink and enlarge.
  const blurred = document.createElement('canvas');
  blurred.width = blurred.height = size;
  const b = blurred.getContext('2d');
  const small = document.createElement('canvas');
  b.drawImage(pattern, 0, 0);
  for (const factor of blurSteps) {
    small.width = small.height = Math.max(8, Math.round(size * factor));
    const s = small.getContext('2d');
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = 'high';
    s.drawImage(blurred, 0, 0, small.width, small.height);
    b.imageSmoothingEnabled = true;
    b.imageSmoothingQuality = 'high';
    b.clearRect(0, 0, size, size);
    b.drawImage(small, 0, 0, size, size);
  }

  const output = document.createElement('canvas');
  output.width = output.height = size;
  const o = output.getContext('2d');
  const texture = new CanvasTexture(output);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  let current = -1;
  function setStrength(strength) {
    const value = Math.min(1, Math.max(0, strength));
    if (Math.abs(value - current) < 0.004) return;
    current = value;
    o.globalAlpha = 1;
    o.fillStyle = '#fff';
    o.fillRect(0, 0, size, size);
    o.globalAlpha = value;
    o.drawImage(blurred, 0, 0);
    o.globalAlpha = 1;
    texture.needsUpdate = true;
  }
  setStrength(1);
  return { texture, setStrength, dispose: () => texture.dispose() };
}
