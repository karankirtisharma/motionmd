import { CatmullRomCurve3, Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { SceneManifest, TourFrame, Vec3 } from '../../types.ts';

// A compact architectural edit: dolly back into the lift while retaining the room view.
export const CINEMATIC_SECONDS = 90;
export const LIFT_TIMING = { board: 64, turn: 64, close: 65.5, arrive: 73.5, open: 75 };
export const CINEMATIC_HANDOFF = { position: [13.35, 4.23, -6.93] as Vec3, yaw: -1.93966 };

/** Authored room reveals. The source inspection route is retained unmodified. */
export function cinematicFrames(manifest: SceneManifest): TourFrame[] {
  const frame = (id: string, position: Vec3, target: Vec3, fov = 50): TourFrame => ({ id, position, target, fov });
  const existing = (id: string) => {
    const value = manifest.tour?.find(f => f.id === id);
    if (!value) throw new Error('Missing architectural tour anchor: ' + id);
    return { ...value, position: [...value.position] as Vec3, target: [...value.target] as Vec3, fov: 52 };
  };
  return [
    frame('Desert architecture', [-20, 7, -25], [4, 4.8, -18], 43),
    frame('Facade reveal', [-15, 4.8, -21], [1, 3.8, -17], 45),
    frame('Entrance approach', [-10, 2.5, -18.6], [1, 2.2, -17.2], 49),
    frame('Entrance threshold', [-3.5, 1.75, -17.5], [6, 2.1, -17.4]),
    frame('Atrium arrival', [1, 1.8, -17.5], [9, 3.1, -18.3]),
    existing('Hall turn toward studio'), existing('Studio corridor'), existing('Studio portal'),
    existing('Studio threshold'),
    frame('Studio work floor', [8.5, 1.85, -28.5], [12, 1.2, -31.54], 50),
    // Workstation detail, then a compact arc back to the atrium instead of stairs.
    frame('Workstation approach', [9.5, 2.1, -31], [12, 1.22, -31.54], 50),
    frame('PC screen reveal', [10.8, 1.8, -33], [12, 1.22, -31.54], 45),
    frame('PC screen tracking', [13, 1.8, -33], [12, 1.22, -31.54], 45),
    frame('Workstation orbit exit', [13.5, 2.5, -30.5], [16.375, 4.8, -29.4], 52),
    // SC02 is the visible suspended bronze installation; old founder chandeliers are hidden.
    frame('Studio chandelier reveal', [12, 3.8, -29.4], [16.375, 5.3, -29.4], 60),
    frame('Studio chandelier parallax', [10.5, 3.6, -28.3], [16.375, 5.3, -29.4], 58),
    frame('Studio exit sweep', [9, 2.05, -27.7], [5.61, 1.9, -23], 52),
    existing('Return Studio threshold'), existing('Return Studio portal'),
    frame('Atrium return', [5.6, 2.2, -19.3], [14.47, 2.3, -17.1], 48),
    frame('MD sculpture reveal', [8.2, 2.5, -17.2], [14.47, 2.4, -17.1], 52),
    frame('MD sculpture parallax', [8.2, 3.1, -14.2], [14.47, 2.6, -17.1], 52),
    frame('Lounge approach', [5.8, 2.3, -13], [7, 1.8, -8], 51),
    frame('Lounge portal', [5.6, 1.8, -11.5], [10, 1.5, -6], 51),
    frame('Lounge arrival', [5.6, 1.8, -7.2], [11.6, 1.3, -6.2], 51),
    frame('Seating reveal', [7.9, 1.85, -3.3], [11.6, 1.2, -6.2], 53),
    frame('Presentation screen', [11.6, 1.8, -3.2], [11.6, 1.9, -10.5], 53),
    frame('Glass lift approach', [13.24, 1.75, -2.9], [11.6, 1.8, -10.5], 54),
    frame('Lift threshold', [13.24, 1.69, -.55], [12.2, 1.69, -6], 56),
    frame('Cabin boarding', [13.24, 1.69, .7], [13.24, 1.69, -4], 58),
    frame('Cabin departure', [13.24, 1.69, 1.4], [13.24, 1.69, -4], 58),
  ];
}

function arrivalFrames(): TourFrame[] {
  return [
    { id: 'Founder lift arrival', position: [13.24, 5.885, 1.4], target: [13.24, 5.885, -4], fov: 58 },
    { id: 'Upper lift threshold', position: [13.24, 5.885, -.6], target: [13.8, 5.7, -5], fov: 56 },
    { id: 'Founder interior arrival', position: [13.3, 5.95, -3.1], target: [16.8, 5.3, -5.3], fov: 52 },
    { id: 'Founder room reveal', position: [13.6, 6, -5.2], target: [17.1, 6, -5.3], fov: 52 },
    { id: 'Founder desk', position: [13.8, 5.95, -6.8], target: [17.4, 5.3, -4.6], fov: 50 },
    { id: 'Founder interior', position: [12.4, 6.02, -8.2], target: [17, 5.3, -5.2], fov: 52 },
    { id: 'Explore handoff', position: [11.092, 6.07, -7.803], target: [13.35, 5.58, -6.93], fov: 54 },
  ];
}

/** Integrate a cosine velocity ramp: zero speed/acceleration at either endpoint. */
export function cinematicDistance(progress: number, duration = CINEMATIC_SECONDS): number {
  const time = MathUtils.clamp(progress, 0, 1) * duration;
  const ramp = Math.min(6, duration / 4), travel = duration - ramp;
  const start = (t: number) => (t - ramp / Math.PI * Math.sin(Math.PI * t / ramp)) / (2 * travel);
  if (time < ramp) return start(time);
  if (time > duration - ramp) return 1 - start(duration - time);
  return (time - ramp / 2) / travel;
}

class CameraTrack {
  readonly frames: TourFrame[];
  readonly curve: CatmullRomCurve3;
  private angles: Array<{ yaw: number; pitch: number }>;
  private lookTrack: Array<{ yaw: number; pitch: number }>;

  private duration: number;
  private timing: number[];
  constructor(frames: TourFrame[], duration: number) {
    this.duration = duration;
    this.frames = frames;
    const points = this.frames.map(frame => new Vector3(...frame.position));
    if (points.length === 1) points.push(points[0].clone());
    this.curve = new CatmullRomCurve3(points, false, 'centripetal');
    // Align lookup samples with every knot: a sample straddling unequal source
    // segments otherwise introduces a brief velocity spike at that boundary.
    this.curve.arcLengthDivisions = Math.max(1, points.length - 1) * 1024;
    this.curve.updateArcLengths();
    // Reserve time at tight corners instead of maintaining drone speed through
    // stair landings. This changes timing only; the clearance-tested path stays fixed.
    const count = 16384, pointsOnArc = Array.from({ length: count + 1 }, (_, i) => this.curve.getPointAt(i / count));
    const cost = pointsOnArc.map((p, i) => {
      if (!i || i === count) return 1;
      const before = p.clone().sub(pointsOnArc[i - 1]), after = pointsOnArc[i + 1].clone().sub(p);
      return 1 + 1.8 * before.angleTo(after) / Math.max(.0001, (before.length() + after.length()) / 2);
    });
    const timingRadius = Math.ceil(.45 / this.curve.getLength() * count);
    this.timing = [0];
    for (let i = 1; i <= count; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - timingRadius); j <= Math.min(count, i + timingRadius); j++) { const weight = Math.exp(-4.5 * ((j - i) / timingRadius) ** 2); sum += cost[j] * weight; n += weight; }
      this.timing.push(this.timing[i - 1] + sum / n);
    }
    const total = this.timing[count]; this.timing = this.timing.map(value => value / total);
    this.angles = this.frames.map(frame => {
      const direction = new Vector3(...frame.target).sub(new Vector3(...frame.position)).normalize();
      return { yaw: Math.atan2(-direction.x, -direction.z), pitch: Math.asin(direction.y) };
    });
    for (let i = 1; i < this.angles.length; i++) {
      const previous = this.angles[i - 1].yaw, current = this.angles[i].yaw;
      this.angles[i].yaw = previous + Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
    }
    // Unwrapped yaw/pitch filtering preserves a level horizon and never flips
    // quaternion hemispheres when a shot passes through a 180-degree heading.
    const sampleRate = 30, sampleCount = Math.ceil(duration * sampleRate);
    const raw = Array.from({ length: sampleCount + 1 }, (_, i) => this.rawSample(i / sampleCount).angles);
    const sigma = 1.25 * sampleRate, radius = Math.ceil(3 * sigma);
    this.lookTrack = raw.map((_, index) => {
      let yaw = 0, pitch = 0, total = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const value = raw[MathUtils.clamp(index + offset, 0, sampleCount)], weight = Math.exp(-0.5 * (offset / sigma) ** 2);
        yaw += value.yaw * weight; pitch += value.pitch * weight; total += weight;
      }
      yaw /= total; pitch /= total;
      const start = MathUtils.smootherstep(index / sampleRate, 0, 3), end = MathUtils.smootherstep(index / sampleRate, duration - 3, duration);
      return { yaw: MathUtils.lerp(MathUtils.lerp(raw[0].yaw, yaw, start), raw[sampleCount].yaw, end), pitch: MathUtils.lerp(MathUtils.lerp(raw[0].pitch, pitch, start), raw[sampleCount].pitch, end) };
    });
  }

  private rawSample(progress: number) {
    const distance = cinematicDistance(progress, this.duration);
    let left = 0, right = this.timing.length - 1;
    while (right - left > 1) { const mid = (left + right) >>> 1; if (this.timing[mid] < distance) left = mid; else right = mid; }
    const u = (left + (distance - this.timing[left]) / (this.timing[right] - this.timing[left])) / (this.timing.length - 1);
    const parameter = this.curve.getUtoTmapping(u, 0);
    const index = parameter * (this.frames.length - 1), lo = Math.floor(index), hi = Math.min(lo + 1, this.frames.length - 1), alpha = index - lo;
    return { position: this.curve.getPoint(parameter), angles: { yaw: MathUtils.lerp(this.angles[lo].yaw, this.angles[hi].yaw, alpha), pitch: MathUtils.lerp(this.angles[lo].pitch, this.angles[hi].pitch, alpha) }, fov: MathUtils.lerp(this.frames[lo].fov, this.frames[hi].fov, MathUtils.smootherstep(alpha, 0, 1)) };
  }

  sample(progress: number) {
    const pose = this.rawSample(progress);
    const index = MathUtils.clamp(progress, 0, 1) * (this.lookTrack.length - 1);
    const lo = Math.floor(index), hi = Math.min(lo + 1, this.lookTrack.length - 1);
    const alpha = index - lo;
    const quaternion = new Quaternion().setFromEuler(new Euler(MathUtils.lerp(this.lookTrack[lo].pitch, this.lookTrack[hi].pitch, alpha), MathUtils.lerp(this.lookTrack[lo].yaw, this.lookTrack[hi].yaw, alpha), 0, 'YXZ'));
    return { position: pose.position, fov: pose.fov, quaternion };
  }
}

/** Three continuous phases, driven by one clock. Scrubbing and replay are deterministic. */
export class CinematicPath {
  readonly frames: TourFrame[];
  readonly curve: CatmullRomCurve3;
  private departure: CameraTrack;
  private arrival: CameraTrack;
  constructor(manifest: SceneManifest) {
    this.departure = new CameraTrack(cinematicFrames(manifest), LIFT_TIMING.board);
    this.arrival = new CameraTrack(arrivalFrames(), CINEMATIC_SECONDS - LIFT_TIMING.open);
    this.frames = [...this.departure.frames, ...this.arrival.frames];
    this.curve = this.departure.curve;
  }
  sample(progress: number) {
    const time = MathUtils.clamp(progress, 0, 1) * CINEMATIC_SECONDS;
    const ease = (v: number) => MathUtils.smootherstep(v, 0, 1);
    const liftHeight = 4.195 * ease((time - LIFT_TIMING.close) / (LIFT_TIMING.arrive - LIFT_TIMING.close));
    const doorOpen = time < LIFT_TIMING.close ? 1 - ease((time - LIFT_TIMING.turn) / 1.5) : ease((time - LIFT_TIMING.arrive) / 1.5);
    let pose;
    if (time < LIFT_TIMING.board) pose = this.departure.sample(time / LIFT_TIMING.board);
    else if (time > LIFT_TIMING.open) pose = this.arrival.sample((time - LIFT_TIMING.open) / (CINEMATIC_SECONDS - LIFT_TIMING.open));
    else {
      pose = this.departure.sample(1); pose.position.y += liftHeight;
      // The camera boards backwards, already looking through the doors; no idle spin.
      pose.quaternion.identity();
    }
    return { ...pose, lift: { height: liftHeight, openness: doorOpen, floor: time >= LIFT_TIMING.arrive ? 1 : 0 } };
  }
}
