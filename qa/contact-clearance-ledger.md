# Contact clearance correction — 28 October 2026

Active copy: D:/Motion Design MD BACKUP 26-10-2026. Protected FINAL and source assets unchanged.

The prior collision audit reserved 0.28 m beyond the upper-body sweep indefinitely. It was intended to accommodate long running strides but remained after locomotion settled, producing a visible invisible-wall gap. Simply removing it with the old linear slowdown caused 135 mm shoe penetration in the real-skin test, so that trial was rejected. Progressive quadratic braking settles the gait early, followed by a bounded slow final approach to the existing physical collider. No authored colliders, stair support radius, character scale, chair path or animation clips are shrunk to disguise clipping.

A smaller upper-body guard was also rejected: it changed chair clearance restoration timing and caused the alternate-entry desk skin regression. The final guard retains its existing 0.35 m radius and 0.35 m half-segment. Front wall root contact is now about 0.365 m rather than the previous 0.52–0.63 m. This is root distance, not visible skin distance; a conservative body envelope remains necessary for hands and turns.

Close slow diagonal approaches exposed a separate Rapier snap issue: a supported capsule could cross the flat top by 65 mm. The reconciliation ray now starts above the previous support height and catches the crossed horizontal top, rather than starting below it. It does not bridge missing floors, lift onto walls, or change the authored stair ramp.

Tests now assert an upper bound on final wall distance as well as no body/skin penetration. Added alongside-wall and retreat checks prevent sticky tangential movement. Final integration and browser evidence follow below.

Rollback/evidence: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/contact-clearance-2026-10-27.

## Combined regression

All 121 tests passed together on the integrated collision, glass and stair revision (full-final-tests.log, 127 seconds). This includes real skinned wall approaches, side travel and retreat, stair ascent/descent/stop routes, both founder desk approaches and repeat entries, the existing mirror system and source asset checks. Production build and TypeScript passed. Debug-only spiral/rounded-stair spawn buttons and a one-second sprint control were then added for in-site verification without desktop input; ten runtime/cinematic tests pass after that addition. These controls are gated behind the existing diagnostic mode.

The collision regression preserves the existing 0.35 m shoulder guard and 15 mm numerical contact skin. It removes the additional stride-length dead zone; it does not promise anatomical point-contact for every orientation of a capsule-based controller.

## Stair prediction interaction found during browser review

The actual in-site rounded-stair sprint check exposed a prediction bug not covered by the older collision-only stair route fixture. A horizontal torso sweep saw the future raised landing as a wall although the physical controller could step up to it. Exact full-scene controller reproduction stalled at x7.754 on the rounded stair. Only the anticipatory speed query now excludes explicitly named authored tread/ramp/landing solids; every physical capsule/torso sweep still collides with them, and railings, walls and posts remain in both prediction and physics. The full-scene walk/sprint reproduction reaches the landing after this correction. Permanent bidirectional controller coverage is added to prevent a recurrence.
