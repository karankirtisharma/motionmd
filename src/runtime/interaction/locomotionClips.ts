import * as THREE from 'three';
import { locateFlight, type FlightHit } from './stairFlights';

// Baked locomotion (scripts/locomotion/bake.mjs -> locomotion-v16.json): Mixamo motion-capture walk and run on the
// visitor rig (his own torso posture kept), and stair clips fitted from that walk to each of the building's flights.
// Every clip is one cycle (two steps) from the left heel strike, 64 frames, played by phase (time = phase).
//   Floor:  walk and run blended by speed in one sync group; the phase advances with distance, so feet never slide.
//   Stairs: the phase is locked to the position on the flight (two treads per cycle), so every foot lands on the
//           centre of a tread; joining and leaving happen inside the stance of the last floor / first landing step.
export type LocomotionClip = {
  name: string; kind: 'flat' | 'stairs'; frames: number; contacts: Array<{ phase: number; duration: number }>;
  cycleDistance?: number; naturalSpeed?: number; strikeAhead?: number;
  flight?: FlightHit['id']; radius?: number; riser?: number; going?: number; direction?: number; rootTreadAtStart?: number;
  /** Stairs: where a planted foot's centre stands, from its tread's centre (treads, along the way of travel). */
  footOffset?: number;
  /** Stairs: standing still, both feet down: the stride frozen at each footfall (phases: left, right), sampled with
   *  the root at each of `deltas` (cycle phase) from it. Frames: left footfall's deltas, then the right's. */
  stand?: { phases: number[]; deltas: number[] }; standRotations?: string; standPelvis?: string;
  rotations: string; pelvis: string;
};
export type LocomotionData = { version: number; bones: string[]; frames: number; clips: LocomotionClip[] };

/** Ground speeds the clips are made for (m/s). The controller moves the visitor at these. */
export const GAIT = { walk: 1.5, run: 3.0 };
/** Steps per second on stairs: the controller's speed there is this times the tread depth. */
// (Running on stairs is a brisker walk, not a sprint: 2.8 steps/s read as frantic, cartoon-fast legs.)
// Walking 2.1 steps a second (0.73 m/s on the spiral) read as dawdling; 2.4 is a brisk, purposeful climb.
// Sprinting on a flight is a quarter faster (it was a barely noticeable 8%).
export const STAIR_CADENCE = { walk: 2.4, run: 3.0 };

// The legs hang from the first spine bone on this rig (Bip01 Spine): it belongs to the legs' layer, or standing on a
// step with the arms at rest (idle upper body) swung the legs and a planted shoe 7 cm into its tread.
const LOWER = /Pelvis|Thigh|Calf|Foot|Toe|^Bip01$|^Bip01_Spine$/;
const lowerTrack = (name: string) => LOWER.test(name.slice(0, name.lastIndexOf('.')));
const mod1 = (x: number) => ((x % 1) + 1) % 1;
const wrapHalf = (x: number) => mod1(x + .5) - .5;
const wrapPi = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const SPIRAL_RADII = [1.1, 1.45, 1.8, 2.2];   // the 0.8 m variant is too tight for a shoe; inside 1.1 m uses 1.1
// Blend windows (tread coordinates) lie around the footfall on the last floor tread (joining) or inside the stance on
// the landing (leaving), taken from the stair clip's own contacts: before then the clip still stands on an imaginary
// step below the floor. Joining upwards happens while the other foot swings over the floor (see ENTRY); leaving
// downwards waits until the trailing foot has swung past the last riser.
const STEER = .2;   // the floor rhythm may run at most this much faster or slower while it lines up with the flight

function decode(base64: string) {
  const bytes = typeof atob === 'function' ? Uint8Array.from(atob(base64), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(base64, 'base64'));
  return bytes.buffer;
}
function buildClip(clip: LocomotionClip, data: LocomotionData) {
  const n = data.frames, bones = data.bones, rotations = new Int16Array(decode(clip.rotations)), pelvis = new Float32Array(decode(clip.pelvis));
  const times = Float32Array.from({ length: n + 1 }, (_, k) => k / n), tracks: THREE.KeyframeTrack[] = [];
  bones.forEach((bone, b) => {
    const values = new Float32Array((n + 1) * 4);
    for (let k = 0; k <= n; k++) for (let c = 0; c < 4; c++) values[k * 4 + c] = rotations[((k % n) * bones.length + b) * 4 + c] / 32767;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  });
  const position = new Float32Array((n + 1) * 3);
  for (let k = 0; k <= n; k++) for (let c = 0; c < 3; c++) position[k * 3 + c] = pelvis[(k % n) * 3 + c];
  tracks.push(new THREE.VectorKeyframeTrack('Bip01_Pelvis.position', times, position));
  // Bones the clips do not drive stay at the rig's rest pose (the mixer's original state), as in the bake.
  return new THREE.AnimationClip(`${clip.name}:${clip.flight ?? 'floor'}:${clip.radius ?? 0}`, 1, tracks);
}
// A stand pose (legs and hips only), its root offsets spread over time 0..1.
function buildStand(clip: LocomotionClip, data: LocomotionData, lead: number) {
  const bones = data.bones, count = clip.stand!.deltas.length, first = lead * count;
  const rotations = new Int16Array(decode(clip.standRotations!)), pelvis = new Float32Array(decode(clip.standPelvis!));
  const times = Float32Array.from({ length: count }, (_, k) => k / (count - 1)), tracks: THREE.KeyframeTrack[] = [];
  bones.forEach((bone, b) => {
    if (!lowerTrack(`${bone}.quaternion`)) return;
    const values = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) for (let c = 0; c < 4; c++) values[k * 4 + c] = rotations[((first + k) * bones.length + b) * 4 + c] / 32767;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  });
  const position = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) for (let c = 0; c < 3; c++) position[k * 3 + c] = pelvis[(first + k) * 3 + c];
  tracks.push(new THREE.VectorKeyframeTrack('Bip01_Pelvis.position', times, position));
  return new THREE.AnimationClip(`${clip.name}:${clip.flight}:${clip.radius ?? 0}:stand${lead}`, 1, tracks);
}
const part = (clip: THREE.AnimationClip, lower: boolean) =>
  new THREE.AnimationClip(`${clip.name}:${lower ? 'lower' : 'upper'}`, clip.duration, clip.tracks.filter(t => lowerTrack(t.name) === lower));

export type StairSettle = { distance: number; x: number; z: number; speed: number };

export function createLocomotion(mixer: THREE.AnimationMixer, data: LocomotionData, idle: THREE.AnimationClip) {
  const actions: THREE.AnimationAction[] = [];
  const held = (clip: THREE.AnimationClip) => { const a = mixer.clipAction(clip); a.play(); a.paused = true; a.setEffectiveWeight(0); actions.push(a); return a; };
  const looping = (clip: THREE.AnimationClip) => { const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); actions.push(a); return a; };
  const find = (name: string) => { const c = data.clips.find(x => x.name === name); if (!c) throw new Error(`locomotion clip ${name} missing`); return c; };
  // short: the walk with short steps at its own cadence (what it becomes below walking speed; absent in older bakes).
  const flat = { walk: find('walk'), run: find('jog'), short: data.clips.find(x => x.name === 'walk-short') };
  const walk = held(buildClip(flat.walk, data)), run = held(buildClip(flat.run, data)), short = flat.short && held(buildClip(flat.short, data));
  const idleUpper = looping(part(idle, false)), idleLower = looping(part(idle, true));
  const stairs = data.clips.filter(c => c.kind === 'stairs' && !(c.flight === 'spiral' && c.radius! < SPIRAL_RADII[0])).map(clip => {
    const full = buildClip(clip, data);
    return { clip, lower: held(part(full, true)), upper: held(part(full, false)), stand: clip.stand ? [0, 1].map(lead => held(buildStand(clip, data, lead))) : undefined };
  });
  const u0 = stairs[0]?.clip.rootTreadAtStart ?? 0, c1 = stairs[0]?.clip.contacts[1].phase ?? .5;   // c1: the right foot's footfall
  // A foot lands on tread centre c when the body is at u0 + c - 0.5 (both feet, to within 0.03 of a tread) and stays
  // down for 2 x its contact duration in treads.
  const stance = 2 * Math.min(...(stairs[0]?.clip.contacts ?? [{ phase: 0, duration: .5 }]).map(c => c.duration));
  // Joining upwards happens while the foot that steps onto the first tread swings over the floor. In the stair walk it
  // leaves an imaginary step one riser below the floor, so the blend may only start once that foot has risen above the
  // floor, and must be over before its toe reaches the first riser (where the floor walk's low swing would carry it
  // into the step). Measured on the shoe mesh (bake.mjs), over all flights: the left foot clears the floor at
  // u0 - 1.12 .. -0.97 and reaches the riser at u0 - .77 .. -.70; the right foot, whose contact ends later in the
  // cycle, at u0 - .97 .. -.87 and u0 - .70 .. -.66. Index: the lead (0: the left foot steps onto the flight).
  // Downwards that foot is over lower treads, and the blend is longer.
  const ENTRY = { up: [[u0 - 1.055, u0 - .785], [u0 - .945, u0 - .705]], down: [u0 - 1 + .03, u0 - 1 + .03 + .75 * stance] };
  const EXIT = { up: [u0 + .03, u0 + .03 + .75 * stance], down: [u0 + .03 + .4 * stance, u0 + .03 + .95 * stance] };
  const state = { phase: 0, stair: 0, up: 1, direction: 1, lead: [0, 0] as number[], flight: undefined as FlightHit | undefined,
    u: 0, lineHeight: 0, travelYaw: 0, rate: 1, target: undefined as number | undefined, settle: undefined as StairSettle | undefined,
    /** Near a flight: the floor its floor walk stands on (the nearer end's), and how much the body stands on that
     *  rather than on the collision capsule (which climbs a riser 0.3 m early, lifting the floor walk off the floor). */
    floor: 0, near: 0 };
  let facingWeight = 0, windowWeight = 0, visit: FlightHit['id'] | undefined, sprinting = 0, resting = 0, nearFlight = 0;
  let lastYaw: number | undefined, turning = 0;   // turning on the spot (0..1)
  const chosen = [false, false];   // lead foot picked for this approach, per direction
  const variants = (gait: 'up-walk' | 'down-walk', flight: FlightHit) => {
    const list = stairs.filter(s => s.clip.name === gait && s.clip.flight === flight.id);
    if (flight.id !== 'spiral') return list.map(s => ({ s, w: 1 }));
    const r = THREE.MathUtils.clamp(flight.radius, SPIRAL_RADII[0], SPIRAL_RADII[SPIRAL_RADII.length - 1]);
    let i = 0; while (i < SPIRAL_RADII.length - 2 && r > SPIRAL_RADII[i + 1]) i++;
    const t = (r - SPIRAL_RADII[i]) / (SPIRAL_RADII[i + 1] - SPIRAL_RADII[i]);
    const at = (radius: number) => list.find(s => s.clip.radius === radius)!;
    return [{ s: at(SPIRAL_RADII[i]), w: 1 - t }, { s: at(SPIRAL_RADII[i + 1]), w: t }];
  };
  // Tread coordinate along the way of travel, and the stair phase there.
  const travelU = (flight: FlightHit, dir: number) => dir > 0 ? flight.u : flight.treads - flight.u;
  const stairPhase = (U: number, lead: number) => mod1((U - u0 + lead) / 2);

  return {
    state,
    reset() {
      state.phase = 0; state.stair = 0; state.flight = undefined; state.settle = undefined; facingWeight = 0; lastYaw = undefined; turning = 0; windowWeight = 0; visit = undefined; sprinting = 0; resting = 0; nearFlight = 0; chosen[0] = chosen[1] = false;
      for (const a of actions) a.setEffectiveWeight(0);
    },
    /**
     * @param speed ground speed this frame (m/s); @param walking 0..1 stepping vs standing (from smoothed speed)
     * @param share 1 - seated; @param yaw the body's facing; @param stairsAllowed the controller's stair gate
     */
    update(dt: number, speed: number, walking: number, share: number, position: THREE.Vector3, yaw: number, sprint: boolean, stairsAllowed: boolean) {
      const running = THREE.MathUtils.smoothstep(speed, GAIT.walk, GAIT.run);
      // Slower than a walk (closing on a staircase at its pace, stopping, setting off) the steps get shorter, at the
      // walk's own cadence. The full-length walk played by distance at the stair pace took 0.7 steps a second: slow
      // motion on the floor before and after every flight, then 2.1 a second on it.
      // Not near a staircase: there the floor walk must swing its foot over the first riser as the stair walk takes
      // over, and the short steps' low swing caught it (2-7 cm); the controller slows down late there instead.
      const flight = stairsAllowed ? locateFlight(position.x, position.y, position.z, 10) : undefined;
      nearFlight += THREE.MathUtils.clamp((flight ? 1 : 0) - nearFlight, -dt * 3, dt * 3);
      const shortening = flat.short ? (1 - nearFlight) * (1 - THREE.MathUtils.smoothstep(speed, flat.short.naturalSpeed!, GAIT.walk)) : 0;
      const mixFlat = (value: (clip: LocomotionClip) => number) =>
        THREE.MathUtils.lerp(THREE.MathUtils.lerp(value(flat.walk), value(flat.short ?? flat.walk), shortening), value(flat.run), running);
      const cycle = mixFlat(c => c.cycleDistance!);
      sprinting += THREE.MathUtils.clamp((sprint ? 1 : 0) - sprinting, -dt * 4, dt * 4);
      const spin = lastYaw === undefined || dt <= 0 ? 0 : Math.abs(wrapPi(yaw - lastYaw)) / dt;
      lastYaw = yaw;
      turning += THREE.MathUtils.clamp((spin > .8 && speed < .15 ? 1 : 0) - turning, -dt * 6, dt * 6);
      state.flight = flight; state.rate = 1; state.settle = undefined; state.target = undefined;
      let target = 0;
      if (flight) {
        if (visit !== flight.id) { visit = flight.id; windowWeight = 0; chosen[0] = chosen[1] = false; }
        const along = Math.sin(yaw) * flight.uphillX + Math.cos(yaw) * flight.uphillZ;
        const direction = Math.abs(along) > .3 ? Math.sign(along) : state.direction;
        // (Also with the stair walk faded out on the treads, as it is while he turns on the spot: missed there, the walk
        // set off a tread out of step, a shoe 15 cm into a tread.)
        if (direction !== state.direction && (state.stair > 0 || (flight.u > -.1 && flight.u < flight.treads + .1))) {
          // Turning round on the flight: the feet stay on the same treads, seen from the other end.
          state.lead[direction > 0 ? 0 : 1] = (((1 - state.lead[state.direction > 0 ? 0 : 1] - flight.treads) % 2) + 2) % 2;
        }
        state.direction = direction;
        const d = direction > 0 ? 0 : 1, U = travelU(flight, direction), n = flight.treads, G = flight.going;
        // The floor walk and the stair walk must stand on the same foot, in the same place, wherever they are
        // blended: the last floor tread before the flight, the landing after it, and (on the flight) the tread
        // the stair walk stands on now. The floor walk lands its foot \`ahead\` m in front of the body; this is the
        // floor phase that puts that foot on tread centre \`centre\`.
        const ahead = mixFlat(c => c.strikeAhead ?? 0);
        const rightStrike = mixFlat(c => c.contacts[1].phase);
        const stance = stairPhase(U, state.lead[d]);
        const centre = U < 0 ? -.5 : U > n - .1 ? n + .5 : U - 2 * (stance % .5) - u0 + .5;
        // The stair walk plants its foot off the tread's centre (away from the riser the long shoe faces): the floor
        // walk puts its foot there too, or the planted foot slides by the difference while the two are blended.
        const spot = centre + variants(direction > 0 ? 'up-walk' : 'down-walk', flight).reduce((sum, { s, w }) => sum + w * (s.clip.footOffset ?? 0), 0);
        const floorPhase = (lead: number) => {
          const leftOn = ((Math.round(centre - .5 + lead) % 2) + 2) % 2 === 0;   // left feet land on centres .5 - lead + 2k
          return mod1((leftOn ? 0 : rightStrike) + ((U - spot) * G + ahead) / cycle);
        };
        // Not on the flight yet: lead with whichever foot is nearer to stepping onto the last floor tread.
        // Chosen once per approach (re-choosing every frame flipped between the two near a half-step and steering never settled).
        // Switched when the other foot becomes clearly nearer: a run slowing to a walk mid-approach changes the stride,
        // and the foot picked at run stride may no longer line up in time. The 0.12-cycle margin stops the two from
        // trading places every frame near a half-step.
        if (state.stair < .001 && U < (direction > 0 ? ENTRY.up[0] : ENTRY.down)[0]) {
          const error = (lead: number) => Math.abs(wrapHalf(floorPhase(lead) - state.phase));
          if (!chosen[d]) { chosen[d] = true; state.lead[d] = error(0) <= error(1) ? 0 : 1; }
          else if (error(1 - state.lead[d]) < error(state.lead[d]) - .12) state.lead[d] = 1 - state.lead[d];
        }
        // Steered over the last 8 treads before the flight (a running stride needs that run-up to line up), on it, and
        // while leaving it, and only while heading along it: further out (the
        // gallery's landing lies within ten treads of its steps) the walk ran up to 20% slow — a slow-motion stroll.
        const exitEnd = n + (direction > 0 ? EXIT.up : EXIT.down)[1];
        state.target = Math.abs(along) > .3 && U > -8 && U < exitEnd ? floorPhase(state.lead[d]) : undefined;
        // Position windows: in from the last floor step, out after the first landing step.
        const exit = direction > 0 ? EXIT.up : EXIT.down;
        // Upwards the join is a straight ramp: a smoothstep's slow start and finish wasted the little room there is.
        const join = direction > 0 ? THREE.MathUtils.clamp((U - ENTRY.up[state.lead[d]][0]) / (ENTRY.up[state.lead[d]][1] - ENTRY.up[state.lead[d]][0]), 0, 1)
          : THREE.MathUtils.smoothstep(U, ENTRY.down[0], ENTRY.down[1]);
        windowWeight = join * (1 - THREE.MathUtils.smoothstep(U, n + exit[0], n + exit[1]));
        // Facing across the flight, off its treads, is walking past it. On the treads the legs stay on their steps
        // whichever way he faces, except while he turns on the spot: then they stand together on the tread under him
        // (state.floor). Swung round in the stair stand, one foot a tread higher, a shoe went through the steps.
        target = (Math.abs(along) > .3 || (flight.u > -.1 && flight.u < n + .1)) && turning < .5 ? 1 : 0;
        // The floor, landing or tread under him: what the floor walk and stand use near and on the flight.
        state.floor = flight.line(-.5) + flight.riser * THREE.MathUtils.clamp(Math.floor(flight.u) + 1, 0, n + 1);
        state.near = 1 - THREE.MathUtils.smoothstep(Math.max(-1 - flight.u, flight.u - n - 1), 0, 1);
        state.u = U; state.lineHeight = flight.line(flight.u);
        state.travelYaw = Math.atan2(flight.uphillX * direction, flight.uphillZ * direction);
      } else { visit = undefined; chosen[0] = chosen[1] = false; windowWeight = Math.max(0, windowWeight - dt * 5); state.near = 0; }
      facingWeight += THREE.MathUtils.clamp(target - facingWeight, -dt * 5, dt * 5);
      state.up += THREE.MathUtils.clamp((state.direction > 0 ? 1 : 0) - state.up, -dt * 4, dt * 4);
      // However fast the windows are crossed (a sprint onto a flight), the blend takes at least 1/6 s: never a snap.
      // At a stair pace (under 3 treads a second) 1/8 s: the join window then lasts about 0.13 s, and 1/6 s finished
      // it after the first riser.
      const rate = flight && speed / flight.going < 3 ? 8 : 6;
      const sw = state.stair = state.stair + THREE.MathUtils.clamp(Math.min(windowWeight, facingWeight) - state.stair, -dt * rate, dt * rate);
      // Stood still on the flight itself (not in a join or leave window, whose stride stands on imaginary steps): the
      // legs go over to the stand pose in 0.2 s, and back as soon as he moves. Not while still slowing down: the walk
      // is then mid-step, and a blend from there cut the corner of the step's nose (2-3 cm into it, going down).
      resting += THREE.MathUtils.clamp((flight && sw > .99 && speed < .05 ? 1 : 0) - resting, -dt * 5, dt * 5);

      // Floor phase: distance over the cycle, steered (at most STEER faster or slower) towards the phase that plants
      // its foot where the stair walk's is; taken over outright while the stair walk is all that shows.
      const natural = Math.max(0, speed) * dt / cycle;
      if (flight && state.target !== undefined && sw > .999) state.phase = state.target;
      else if (flight && state.target !== undefined) {
        const error = wrapHalf(state.target - mod1(state.phase + natural));
        state.rate = 1 + THREE.MathUtils.clamp(error, -STEER * natural, STEER * natural) / Math.max(1e-6, natural);
        state.phase = mod1(state.phase + natural * state.rate);
      } else state.phase = mod1(state.phase + natural);

      // Weights. Upper and lower body are separate layers: standing on a step the arms rest (idle) while the
      // legs keep the step they are on.
      const s = share, m = walking;
      walk.setEffectiveWeight(m * (1 - running) * (short ? 1 - shortening : 1) * (1 - sw) * s); walk.time = state.phase;
      if (short) { short.setEffectiveWeight(m * (1 - running) * shortening * (1 - sw) * s); short.time = state.phase; }
      run.setEffectiveWeight(m * running * (1 - sw) * s); run.time = state.phase;
      idleUpper.setEffectiveWeight((1 - m) * s);
      idleLower.setEffectiveWeight((1 - m) * (1 - sw) * s);
      for (const st of stairs) { st.lower.setEffectiveWeight(0); st.upper.setEffectiveWeight(0); st.stand?.forEach(a => a.setEffectiveWeight(0)); }
      if (flight && sw > 0) {
        for (const [gait, gw, dir] of [['up-walk', state.up, 1], ['down-walk', 1 - state.up, -1]] as const) {
          if (gw <= 0) continue;
          const time = stairPhase(travelU(flight, dir), state.lead[dir > 0 ? 0 : 1]);
          for (const { s: st, w } of variants(gait, flight)) {
            const weight = sw * gw * w * s;
            // At rest near one of its moments, the stand pose there: both shoes flat on their treads (in the walk
            // itself the trailing one has already lifted 4-18 cm by then).
            let still = 0;
            if (st.stand && resting > 0) {
              const { phases, deltas } = st.clip.stand!, from = phases.map(p => wrapHalf(time - p)), j = Math.abs(from[0]) <= Math.abs(from[1]) ? 0 : 1;
              still = resting * (1 - THREE.MathUtils.smoothstep(Math.abs(from[j]), .14, .22));
              st.stand[j].setEffectiveWeight(weight * still);
              st.stand[j].time = THREE.MathUtils.clamp((from[j] - deltas[0]) / (deltas[deltas.length - 1] - deltas[0]), 0, .9999);
            }
            st.lower.setEffectiveWeight(weight * (1 - still)); st.lower.time = time;
            st.upper.setEffectiveWeight(m * weight); st.upper.time = time;
          }
        }
        // Stopping on a flight finishes the step under way: it brakes for the next moment it can stand in (the stand
        // poses' moments, at or just before a footfall), aiming 0.03 of a cycle short of it, as far as the controller
        // coasts on.
        const gait = state.direction > 0 ? 'up-walk' : 'down-walk', rests = variants(gait, flight)[0]?.s.clip.stand?.phases ?? [0, c1];
        const phase = mod1(stairPhase(state.u, state.lead[state.direction > 0 ? 0 : 1]) + .03);
        // A step only just finished counts as finished: with a tighter margin (0.03) the controller, coasting past
        // the footfall it braked for, set off for the next step, and the next: the visitor never stopped.
        const ahead = Math.min(...rests.map(r => mod1(r - phase))), behind = Math.min(...rests.map(r => mod1(phase - r)));
        state.settle = { distance: behind < .1 || ahead < .005 ? 0 : ahead * 2 * flight.going, x: flight.uphillX * state.direction, z: flight.uphillZ * state.direction,
          speed: (sprinting > .5 ? STAIR_CADENCE.run : STAIR_CADENCE.walk) * flight.going };
      }
      return { running, stair: sw };
    },
    /** Body yaw correction on a flight: the clips walk along the flight's own line. It fades out as he turns across
     *  the flight (none at 72 deg or more from it), so turning round does not flip the body: the way of travel
     *  flips by 180 deg there, and the full correction spun him 100 deg in one frame. */
    yawOffset(yaw: number) {
      const align = THREE.MathUtils.smoothstep(Math.cos(state.travelYaw - yaw), .3, .7);
      return state.stair * align * wrapPi(state.travelYaw - yaw);
    },
    /** Top of the step (or of the floor or landing it continues into) under a point near a flight, if any. */
    surface(x: number, y: number, z: number) {
      const hit = locateFlight(x, y, z, 4);
      return hit && hit.line(-.5) + hit.riser * THREE.MathUtils.clamp(Math.floor(hit.u) + 1, 0, hit.treads + 1);
    },
    dispose() { for (const a of actions) { a.stop(); mixer.uncacheAction(a.getClip()); mixer.uncacheClip(a.getClip()); } },
  };
}

/** Speed the controller should move at on a flight (m/s): cadence times tread depth. */
export function stairSpeed(flight: FlightHit, sprint: boolean) { return (sprint ? STAIR_CADENCE.run : STAIR_CADENCE.walk) * flight.going; }
