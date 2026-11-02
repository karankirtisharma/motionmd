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
  const w = matrix[3] * x + matrix[7] * y + 1;
  return { x: (matrix[0] * x + matrix[4] * y + matrix[12]) / w,
    y: (matrix[1] * x + matrix[5] * y + matrix[13]) / w };
}
