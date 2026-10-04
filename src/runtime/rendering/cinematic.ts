import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { SceneManifest, TourFrame, Vec3 } from '../../types.ts';

export const CINEMATIC_SECONDS = 58;

/** A compact edit of the source walkthrough. The full inspection route stays in the manifest. */
export function cinematicFrames(manifest: SceneManifest): TourFrame[] {
  const source = (manifest.tour ?? []).filter(frame => frame.sourceFrame !== undefined && frame.sourceFrame <= 469);
  if (source.length < 3) return manifest.tour?.length ? manifest.tour : manifest.cameras;
  const exterior = manifest.cameras.find(frame => frame.id.includes('Exterior overview'));
  const handoff = (manifest.tour ?? []).filter(frame => ['Lounge standing approach', 'Explore handoff'].includes(frame.id ?? ''));
  const prefix: TourFrame[] = exterior ? [
    exterior,
    { id: 'Exterior descent', position: [-18, 6.8, -24], target: [-10, 4.2, -19.3], fov: 39 },
    { id: 'Entrance approach', position: [-13.4, 3.8, -20.8], target: [-5.4, 2.6, -17.7], fov: 47 },
  ] : [];
  // Remove the centimetre-scale bob from the walking source camera; preserve its route.
  const glide = source.map((frame, index) => ({ ...frame, position: [frame.position[0], index === 0 || index === source.length - 1 ? frame.position[1] : (source[index - 1].position[1] + 2 * frame.position[1] + source[index + 1].position[1]) / 4, frame.position[2]] as Vec3 }));
  return [...prefix, ...glide, ...handoff];
}

/** Integrate a cosine velocity ramp: zero speed/acceleration at either endpoint. */
export function cinematicDistance(progress: number): number {
  const time = MathUtils.clamp(progress, 0, 1) * CINEMATIC_SECONDS;
  const ramp = 6, travel = CINEMATIC_SECONDS - ramp;
  const start = (t: number) => (t - ramp / Math.PI * Math.sin(Math.PI * t / ramp)) / (2 * travel);
  if (time < ramp) return start(time);
  if (time > CINEMATIC_SECONDS - ramp) return 1 - start(CINEMATIC_SECONDS - time);
  return (time - ramp / 2) / travel;
}

function tangent(previous: Quaternion, current: Quaternion, next: Quaternion): Quaternion {
  const inverse = current.clone().invert();
  const logarithm = (value: Quaternion) => {
    const w = MathUtils.clamp(value.w, -1, 1), angle = Math.acos(w), sine = Math.sin(angle);
    return new Vector3(value.x, value.y, value.z).multiplyScalar(Math.abs(sine) < 1e-7 ? 1 : angle / sine);
  };
  const sum = logarithm(inverse.clone().multiply(previous)).add(logarithm(inverse.clone().multiply(next))).multiplyScalar(-0.25);
  const angle = sum.length(), scale = angle < 1e-7 ? 1 : Math.sin(angle) / angle;
  return current.clone().multiply(new Quaternion(sum.x * scale, sum.y * scale, sum.z * scale, Math.cos(angle))).normalize();
}

export class CinematicPath {
  readonly frames: TourFrame[];
  readonly curve: CatmullRomCurve3;
  private orientations: Quaternion[];
  private tangents: Quaternion[];
  private lookTrack: Quaternion[];

  constructor(manifest: SceneManifest) {
    this.frames = cinematicFrames(manifest);
    const points = this.frames.map(frame => new Vector3(...frame.position));
    if (points.length === 1) points.push(points[0].clone());
    this.curve = new CatmullRomCurve3(points, false, 'centripetal');
    // Align lookup samples with every knot: a sample straddling unequal source
    // segments otherwise introduces a brief velocity spike at that boundary.
    this.curve.arcLengthDivisions = Math.max(1, points.length - 1) * 1024;
    this.curve.updateArcLengths();
    const camera = new PerspectiveCamera();
    this.orientations = this.frames.map(frame => {
      camera.position.fromArray(frame.position); camera.lookAt(new Vector3(...frame.target));
      return camera.quaternion.clone();
    });
    // Keep the same quaternion hemisphere, including through 180-degree yaw.
    for (let i = 1; i < this.orientations.length; i++) {
      if (this.orientations[i - 1].dot(this.orientations[i]) < 0) {
        const q = this.orientations[i]; q.set(-q.x, -q.y, -q.z, -q.w);
      }
    }
    this.tangents = this.orientations.map((q, i) => tangent(this.orientations[Math.max(0, i - 1)], q, this.orientations[Math.min(this.orientations.length - 1, i + 1)]));
    // The source walking camera turns quickly between some closely spaced frames.
    // Filter its orientation in time rather than changing the collision-checked route.
    const sampleRate = 20, count = CINEMATIC_SECONDS * sampleRate;
    const raw = Array.from({ length: count + 1 }, (_, index) => this.rawSample(index / count).quaternion);
    const sigma = 1.75 * sampleRate, radius = Math.ceil(3 * sigma);
    this.lookTrack = raw.map((reference, index) => {
      const sum = new Quaternion(0, 0, 0, 0);
      for (let offset = -radius; offset <= radius; offset++) {
        const value = raw[MathUtils.clamp(index + offset, 0, count)];
        const weight = Math.exp(-0.5 * (offset / sigma) ** 2) * (reference.dot(value) < 0 ? -1 : 1);
        sum.x += value.x * weight; sum.y += value.y * weight; sum.z += value.z * weight; sum.w += value.w * weight;
      }
      sum.normalize();
      const seconds = index / sampleRate;
      if (seconds < 3) return raw[0].clone().slerp(sum, MathUtils.smootherstep(seconds, 0, 3));
      if (seconds > CINEMATIC_SECONDS - 3) return sum.slerp(raw[count], MathUtils.smootherstep(seconds, CINEMATIC_SECONDS - 3, CINEMATIC_SECONDS));
      return sum;
    });
  }

  private rawSample(progress: number) {
    const parameter = this.curve.getUtoTmapping(cinematicDistance(progress), 0);
    const index = parameter * (this.frames.length - 1);
    const lo = Math.floor(index), hi = Math.min(lo + 1, this.frames.length - 1), alpha = index - lo;
    const orientation = this.orientations[lo].clone().slerp(this.orientations[hi], alpha);
    const control = this.tangents[lo].clone().slerp(this.tangents[hi], alpha);
    orientation.slerp(control, 2 * alpha * (1 - alpha));
    return { position: this.curve.getPoint(parameter), quaternion: orientation, fov: MathUtils.lerp(this.frames[lo].fov, this.frames[hi].fov, MathUtils.smootherstep(alpha, 0, 1)) };
  }

  sample(progress: number) {
    const pose = this.rawSample(progress);
    const index = MathUtils.clamp(progress, 0, 1) * (this.lookTrack.length - 1);
    const lo = Math.floor(index), hi = Math.min(lo + 1, this.lookTrack.length - 1);
    pose.quaternion = this.lookTrack[lo].clone().slerp(this.lookTrack[hi], index - lo);
    return pose;
  }
}
