import { Box3, Matrix4, PerspectiveCamera, Vector2, Vector3, Vector4 } from 'three';
const point = new Vector3();
/** Crop the reflected frustum to the visible pane, retaining the previous texel density.
 * A near-plane crossing falls back to the complete image instead of clipping the mirror.
 */
export function reflectionCrop(bounds: Box3, world: Matrix4, view: PerspectiveCamera, full: Vector2, current: Vector2, result: Vector4) {
  let minU = 1, minV = 1, maxU = 0, maxV = 0;
  for (let i = 0; i < 8; i++) {
    point.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
      .applyMatrix4(world).applyMatrix4(view.matrixWorldInverse);
    if (-point.z <= view.near) return result.set(0, 0, 1, 1);
    point.applyMatrix4(view.projectionMatrix);
    const u = (1 - point.x) / 2, v = (1 - point.y) / 2;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  minU = Math.max(0, minU); maxU = Math.min(1, maxU);
  minV = Math.max(0, minV); maxV = Math.min(1, maxV);
  const extent = (span: number, pixels: number, previous: number) => {
    const needed = Math.min(pixels, Math.max(64, Math.ceil((span * pixels + 8) / 64) * 64));
    // Hysteresis avoids reallocating an MSAA target on every camera pixel.
    return previous >= needed && needed >= previous * .6 && previous <= pixels ? previous : needed;
  };
  const width = extent(maxU - minU, full.x, current.x) / full.x;
  const height = extent(maxV - minV, full.y, current.y) / full.y;
  return result.set(Math.max(0, Math.min(1 - width, (minU + maxU - width) / 2)),
    Math.max(0, Math.min(1 - height, (minV + maxV - height) / 2)), width, height);
}
/** Change only projection X/Y; the physical oblique clipping plane and depth stay intact. */
export function cropReflectionCamera(camera: PerspectiveCamera, crop: Vector4) {
  const p = camera.projectionMatrix.elements;
  const cx = 2 * crop.x + crop.z - 1, cy = 1 - 2 * crop.y - crop.w;
  for (let column = 0; column < 4; column++) {
    const i = column * 4;
    p[i] = (p[i] - cx * p[i + 3]) / crop.z;
    p[i + 1] = (p[i + 1] - cy * p[i + 3]) / crop.w;
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
