/** One navigation per wheel gesture, with a quiet gap to reject momentum tails. */
export function createWheelNavigation() {
  let sum = 0, last = -Infinity, fired = false, direction = 0;
  return (delta: number, time: number): -1 | 0 | 1 => {
    if (!Number.isFinite(delta) || !delta) return 0;
    const sign = Math.sign(delta);
    if (time - last > 180 || sign !== direction) { sum = 0; fired = false; }
    last = time; direction = sign;
    if (fired) return 0;
    sum += delta;
    if (Math.abs(sum) < 45) return 0;
    fired = true;
    return sign as -1 | 1;
  };
}
