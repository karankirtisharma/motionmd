// The building's three flights of stairs, measured from their rendered treads (qa/anim-flight-measure.mjs).
// Every flight is described in "tread coordinates": u = 0 at the first riser, +1 per tread going up, risers at
// whole numbers; the floor before the flight is tread 0 and the landing after it is tread n + 1. Tread k's top
// is base + riser * k, so the pitch line through the tread centres is base + riser * (u + 0.5).
// Footsteps lock to these coordinates: a foot lands on the centre of a tread, never on an edge.

export type FlightId = 'spiral' | 'gallery' | 'entrance';
export type FlightHit = {
  id: FlightId;
  /** Tread coordinate (going up). */
  u: number;
  /** Treads between the bottom floor and the landing. */
  treads: number;
  riser: number;
  /** Tread depth along the walking line at this point (spiral: grows with the distance from the column). */
  going: number;
  /** Spiral: distance from the column axis; 0 elsewhere. */
  radius: number;
  /** Unit direction of climbing, on the ground plane. */
  uphillX: number; uphillZ: number;
  /** Height of the pitch line at tread coordinate `u`. */
  line(u: number): number;
};

const SPIRAL = { cx: 18.76, cz: -20.2, firstRiser: 59.995, step: 13.695, riser: 0.152917, treads: 23, inner: .36, outer: 2.47 };
// Gallery steps: concentric arcs from the wall (z -24.55) to z -17.5; there the risers straighten (x = 7.75, measured to
// +-3 cm) and run on to the rounded end (z -15.9). Measured on the collision treads (qa/stair-play-audit.mjs survey).
const GALLERY = { cx: -6.489, cz: -19.622, firstRadius: 14.392, going: .29, riser: .175, base: 3.675, treads: 2,
  zMin: -24.55, zMax: -15.9, straightX: 7.75, bend: [-17.7, -17.3] };
const ENTRANCE = { firstX: -6.49, going: .341, riser: .1725, base: -.355, treads: 1, zMin: -19.2, zMax: -15.0 };
const DEG = Math.PI / 180;

/** The flight under a point, when it is within `reach` treads of it (floor before, landing after). */
export function locateFlight(x: number, y: number, z: number, reach = 1.2): FlightHit | undefined {
  // Spiral: angle a as in the controller's prepared route (x = cx + r cos a, z = -(cz + r sin a)), rising as a falls.
  {
    const dx = x - SPIRAL.cx, dz = -(z - SPIRAL.cz), radius = Math.hypot(dx, dz);
    if (radius > SPIRAL.inner - .2 && radius < SPIRAL.outer + .2) {
      const a = Math.atan2(dz, dx) / DEG;
      // Pick the turn whose pitch line is closest to the visitor's height (the flight turns 315 deg).
      let best: { u: number; miss: number } | undefined;
      for (const turn of [a, a - 360, a + 360]) {
        const u = (SPIRAL.firstRiser - turn) / SPIRAL.step;
        if (u < -reach || u > SPIRAL.treads + reach) continue;
        const miss = Math.abs(SPIRAL.riser * (THREE_clamp(u, -.5, SPIRAL.treads + .5) + .5) - y);
        if (!best || miss < best.miss) best = { u, miss };
      }
      if (best && best.miss < .6) {
        const ar = (SPIRAL.firstRiser - best.u * SPIRAL.step) * DEG;
        return { id: 'spiral', u: best.u, treads: SPIRAL.treads, riser: SPIRAL.riser, going: SPIRAL.step * DEG * radius, radius,
          uphillX: Math.sin(ar), uphillZ: Math.cos(ar), line: u => SPIRAL.riser * (u + .5) };
      }
    }
  }
  // Gallery steps: concentric arcs, rising towards their centre, then straight risers (rising along -x) to the rounded
  // end, blended over 0.4 m where the two agree to 1.4 cm. The height check uses the floor / landing level beyond the
  // ends (as the spiral's does): the pitch line run on below the floor hid the flight more than ~3.5 treads out, which
  // cut the stride's run-up to the first step in half. (Recognised only on z -25..-21 before: on the other 4.6 m of the
  // same steps he climbed them with the floor walk, bumped up a step at a time by the collision capsule.)
  if (x > 5.6 && z > GALLERY.zMin && z < GALLERY.zMax) {
    const dx = x - GALLERY.cx, dz = z - GALLERY.cz, radius = Math.hypot(dx, dz);
    const t = smoothstep(z, GALLERY.bend[0], GALLERY.bend[1]);
    const u = (1 - t) * (GALLERY.firstRadius - radius) / GALLERY.going + t * (GALLERY.straightX - x) / GALLERY.going;
    const ux = (1 - t) * -dx / radius - t, uz = (1 - t) * -dz / radius, length = Math.hypot(ux, uz);
    if (u > -reach && u < GALLERY.treads + reach && Math.abs(GALLERY.base + GALLERY.riser * (THREE_clamp(u, -.5, GALLERY.treads + .5) + .5) - y) < .6)
      return { id: 'gallery', u, treads: GALLERY.treads, riser: GALLERY.riser, going: GALLERY.going, radius: 0,
        uphillX: ux / length, uphillZ: uz / length, line: v => GALLERY.base + GALLERY.riser * (v + .5) };
  }
  // Entrance steps: straight, rising along +x.
  {
    const u = (x - ENTRANCE.firstX) / ENTRANCE.going;
    if (u > -reach && u < ENTRANCE.treads + reach && z > ENTRANCE.zMin && z < ENTRANCE.zMax && Math.abs(ENTRANCE.base + ENTRANCE.riser * (THREE_clamp(u, -.5, ENTRANCE.treads + .5) + .5) - y) < .6)
      return { id: 'entrance', u, treads: ENTRANCE.treads, riser: ENTRANCE.riser, going: ENTRANCE.going, radius: 0,
        uphillX: 1, uphillZ: 0, line: v => ENTRANCE.base + ENTRANCE.riser * (v + .5) };
  }
  return undefined;
}
function THREE_clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)); }
function smoothstep(v: number, a: number, b: number) { const t = THREE_clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/**
 * Where a visitor on a flight belongs across it: how far a point (x, z) lies beside that (m) and the unit direction
 * (ground plane) in which that distance grows. Spiral: its middle trail, the 1.45 m circle about the column, half-way
 * across the treads (the treads' depth changes across them; its clips are made for that circle). Gallery and entrance
 * steps are the same all the way across: anywhere on them, keeping 0.4 m clear of their ends (offset 0 there). A
 * single middle line on these wide flights pulled him metres sideways while he climbed.
 */
export function flightTrail(hit: FlightHit, x: number, z: number): { offset: number; x: number; z: number } {
  if (hit.id === 'spiral') {
    const dx = x - SPIRAL.cx, dz = z - SPIRAL.cz, r = Math.hypot(dx, dz) || 1;
    return { offset: r - SPIRAL_TRAIL, x: dx / r, z: dz / r };
  }
  const [low, high] = hit.id === 'gallery' ? [GALLERY.zMin + .4, GALLERY.zMax - .4] : [ENTRANCE.zMin + .4, ENTRANCE.zMax - .4];
  return { offset: z < low ? z - low : z > high ? z - high : 0, x: 0, z: 1 };
}
const SPIRAL_TRAIL = 1.45;
