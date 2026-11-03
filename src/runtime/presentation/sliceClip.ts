/** Cover both independently antialiased clip edges without moving a source UV.
 * Returns a local-origin shift M*T(-overlap,0), not a screen-space translation. */
export function curvedSliceClip(matrix: readonly number[] | null, width: number, height: number) {
  if (!matrix) return { matrix: null, overlap: 0 };
  // Keep the raster/layout window constant while the camera moves. A projected
  // pixel-sized guard changes width and left every frame, forcing all fragments
  // through layout/paint instead of compositing their cached surfaces.
  const overlap = 16;
  const shifted = Array.from(matrix);
  for (let i = 0; i < 4; i++) shifted[12 + i] -= overlap * matrix[i];
  return { matrix: shifted, overlap };
}
