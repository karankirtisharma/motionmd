import { Matrix4, Vector4, WebGPUCoordinateSystem, type Camera, type Vector3 } from 'three';

export type Point2 = { x: number; y: number };
export type ScreenQuad = [Point2, Point2, Point2, Point2];

/** Map a DOM rectangle onto the projected TV corners, including perspective.
 * Corner order is top-left, top-right, bottom-right, bottom-left. */
export function screenHomography(quad: ScreenQuad, width: number, height: number): number[] | null {
  const [a, b, c, d] = quad;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 1e-6 || width <= 0 || height <= 0) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const matrix = [(b.x - a.x + g * b.x) / width, (b.y - a.y + g * b.y) / width, 0, g / width,
    (d.x - a.x + h * d.x) / height, (d.y - a.y + h * d.y) / height, 0, h / height,
    0, 0, 1, 0, a.x, a.y, 0, 1];
  return matrix.every(Number.isFinite) ? matrix : null;
}

export function mapScreenPoint(matrix: number[], x: number, y: number): Point2 {
  const w = matrix[3] * x + matrix[7] * y + matrix[15];
  return { x: (matrix[0] * x + matrix[4] * y + matrix[12]) / w,
    y: (matrix[1] * x + matrix[5] * y + matrix[13]) / w };
}


export type ProjectedScreenPlane = {
  matrix: number[];
  /** Visible screen extent, clipped to the viewport and the camera depth range. */
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  /** Source-pixel clip on the iframe host, before its projective transform. */
  clipPolygon: string | null;
};

// Synchronous scratch storage: clipping a convex quad against seven planes adds
// at most seven vertices. Nothing in these buffers escapes the function.
const screenViewProjection = new Matrix4();
const screenClipA = Array.from({ length: 16 }, () => new Vector4());
const screenClipB = Array.from({ length: 16 }, () => new Vector4());
const sourceClipA = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));
const sourceClipB = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));

/** Register a rectangular DOM surface directly to its world-space screen plane.
 * Unlike a corner-normalized homography, this keeps the camera's homogeneous W:
 * corners behind the eye must stay behind it instead of flipping the entire DOM
 * surface or causing all of the still-visible screen to disappear.
 *
 * Corners are top-left, top-right, bottom-right, bottom-left. The screen's actual
 * depth-tested mesh remains responsible for furniture/character occlusion. */
export function projectScreenPlane(
  corners: readonly Vector3[], camera: Camera, viewportWidth: number, viewportHeight: number,
  domWidth: number, domHeight: number,
): ProjectedScreenPlane | null {
  if (corners.length !== 4 || ![viewportWidth, viewportHeight, domWidth, domHeight].every(v => Number.isFinite(v) && v > 0)) return null;
  screenViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
    screenClipA[i].set(p.x, p.y, p.z, 1).applyMatrix4(screenViewProjection);
    sourceClipA[i].x = i === 1 || i === 2 ? domWidth : 0;
    sourceClipA[i].y = i >= 2 ? domHeight : 0;
  }
  const a = screenClipA[0], b = screenClipA[1], d = screenClipA[3];
  const ux = (b.x - a.x) / domWidth, uy = (b.y - a.y) / domWidth, uw = (b.w - a.w) / domWidth;
  const vx = (d.x - a.x) / domHeight, vy = (d.y - a.y) / domHeight, vw = (d.w - a.w) / domHeight;
  const halfW = viewportWidth / 2, halfH = viewportHeight / 2;
  const matrix = [
    (ux + uw) * halfW, (uw - uy) * halfH, 0, uw,
    (vx + vw) * halfW, (vw - vy) * halfH, 0, vw,
    0, 0, 1, 0,
    (a.x + a.w) * halfW, (a.w - a.y) * halfH, 0, a.w,
  ];
  if (!matrix.every(Number.isFinite)) return null;
  // Three uses zero-to-one clip depth for both WebGPU and reversed depth on
  // either backend. Forward-depth WebGL alone uses minus-one-to-one.
  const zeroToOne = camera.coordinateSystem === WebGPUCoordinateSystem || camera.reversedDepth;
  let input = screenClipA, output = screenClipB, count = 4;
  let sourceIn = sourceClipA, sourceOut = sourceClipB, clipped = false;
  for (let plane = 0; plane < 7 && count; plane++) {
    const distance = (p: Vector4) => {
      switch (plane) {
        case 0: return p.w - 1e-7;
        case 1: return p.x + p.w;
        case 2: return p.w - p.x;
        case 3: return p.y + p.w;
        case 4: return p.w - p.y;
        case 5: return zeroToOne ? p.z : p.z + p.w;
        default: return p.w - p.z;
      }
    };
    let outCount = 0, previous = input[count - 1], previousDistance = distance(previous);
    let previousSource = sourceIn[count - 1];
    for (let i = 0; i < count; i++) {
      const current = input[i], currentDistance = distance(current);
      if ((previousDistance >= 0) !== (currentDistance >= 0)) {
        const t = previousDistance / (previousDistance - currentDistance);
        sourceOut[outCount].x = previousSource.x + (sourceIn[i].x - previousSource.x) * t;
        sourceOut[outCount].y = previousSource.y + (sourceIn[i].y - previousSource.y) * t;
        output[outCount++].copy(previous).lerp(current, t);
        clipped = true;
      }
      if (currentDistance >= 0) {
        sourceOut[outCount].x = sourceIn[i].x; sourceOut[outCount].y = sourceIn[i].y;
        output[outCount++].copy(current);
      }
      previous = current; previousDistance = currentDistance;
      previousSource = sourceIn[i];
    }
    count = outCount;
    const swap = input; input = output; output = swap;
    const sourceSwap = sourceIn; sourceIn = sourceOut; sourceOut = sourceSwap;
  }
  if (count < 3) return { matrix, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false, clipPolygon: null };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, area = 0;
  let previous = input[count - 1];
  let previousX = (previous.x / previous.w + 1) * halfW, previousY = (1 - previous.y / previous.w) * halfH;
  for (let i = 0; i < count; i++) {
    const p = input[i], x = (p.x / p.w + 1) * halfW, y = (1 - p.y / p.w) * halfH;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    area += previousX * y - x * previousY; previousX = x; previousY = y;
  }
  // Roundoff at clip-plane intersections should not spill controls beyond the
  // viewport; preserve subpixel extent rather than rounding to whole pixels.
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(viewportWidth, right); bottom = Math.min(viewportHeight, bottom);
  return { matrix, bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    visible: Math.abs(area) > 1e-5 && right > left && bottom > top,
    clipPolygon: clipped ? 'polygon(' + sourceIn.slice(0, count).map(p => p.x.toFixed(3) + 'px ' + p.y.toFixed(3) + 'px').join(',') + ')' : null };
}
