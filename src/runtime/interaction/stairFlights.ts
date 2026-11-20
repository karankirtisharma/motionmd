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
const GALLERY = { cx: -6.489, cz: -19.622, firstRadius: 14.392, going: .29, riser: .175, base: 3.675, treads: 2 };
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
  // Gallery steps: concentric arcs, rising towards their centre. The height check uses the floor / landing level
  // beyond the ends (as the spiral's does): the pitch line run on below the floor hid the flight more than ~3.5
  // treads out, which cut the stride's run-up to the first step in half.
  {
    const dx = x - GALLERY.cx, dz = z - GALLERY.cz, radius = Math.hypot(dx, dz), u = (GALLERY.firstRadius - radius) / GALLERY.going;
    if (u > -reach && u < GALLERY.treads + reach && x > 5.6 && z > -25 && z < -21 && Math.abs(GALLERY.base + GALLERY.riser * (THREE_clamp(u, -.5, GALLERY.treads + .5) + .5) - y) < .6)
      return { id: 'gallery', u, treads: GALLERY.treads, riser: GALLERY.riser, going: GALLERY.going, radius: 0,
        uphillX: -dx / radius, uphillZ: -dz / radius, line: v => GALLERY.base + GALLERY.riser * (v + .5) };
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
