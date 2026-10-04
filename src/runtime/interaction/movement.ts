/** Frame-rate independent response, also used by camera and animation weights. */
export function damping(rate: number, dt: number) {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
}

export function normalizeInput(x: number, y: number) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

export function cameraRelativeMove(x: number, y: number, yaw: number) {
  const input = normalizeInput(x, y);
  return {
    x: Math.cos(yaw) * input.x - Math.sin(yaw) * input.y,
    z: -Math.sin(yaw) * input.x - Math.cos(yaw) * input.y,
  };
}

export function smoothAngle(current: number, target: number, alpha: number) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * Math.max(0, Math.min(1, alpha));
}

export function smootherStep(value: number) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export type CameraView = 'thirdPerson' | 'bodyCam';

/** Pitch is positive when looking down; yaw matches cameraRelativeMove. */
export function cameraLookDirection(yaw: number, pitch: number) {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

export function applyLookInput(yaw: number, pitch: number, dx: number, dy: number, view: CameraView) {
  const minimum = view === 'bodyCam' ? -1.15 : -0.30;
  const maximum = view === 'bodyCam' ? 1.35 : 0.95;
  return { yaw: yaw - dx * 0.0021, pitch: Math.max(minimum, Math.min(maximum, pitch + dy * 0.0018)) };
}

/** Edge-triggered view controls must not run on key repeat or while editing UI. */
export function cameraShortcut(code: string, repeat: boolean, editing: boolean) {
  if (repeat || editing) return null;
  return code === 'KeyL' ? 'pointerLock' : code === 'KeyV' ? 'cameraView' : null;
}

/** Step-height smoothing only: no idle bob, roll, animated-head jitter or yaw drift. */
export function smoothEyeHeight(current: number, target: number, dt: number) {
  return current + (target - current) * damping(18, dt);
}
