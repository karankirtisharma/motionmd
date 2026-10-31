/** Window validity only: this does not infer whether a gap came from browser
 * scheduling, an inactive tab, JavaScript, or GPU work. Sparse callback timing
 * must not automatically spend visual quality on an unrepresentative sample. */
export function qualifiesAdaptiveWindow(frames: number, elapsedSeconds: number, longGapFrames: number, longGapSeconds: number): boolean {
  if (!Number.isInteger(frames) || frames < 8 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return false;
  if (!Number.isInteger(longGapFrames) || longGapFrames < 0 || longGapFrames > frames || !Number.isFinite(longGapSeconds) || longGapSeconds < 0 || longGapSeconds > elapsedSeconds + 1e-6) return false;
  // A >=250ms interval is recorded as a long gap by the frame loop. Keep ordinary
  // sustained low frame rates eligible, but discard sparse or gap-dominated
  // windows. Time share catches a single inactive gap among many fast frames.
  return frames / elapsedSeconds >= 8 && longGapFrames / frames < 0.1 && longGapSeconds / elapsedSeconds < 0.2;
}