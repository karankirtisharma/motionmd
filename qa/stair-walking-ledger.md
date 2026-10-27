# Stair support refinement — 18 October 2026

Baseline: `1242fa6`, including accepted seated palm/finger contact. Local changes only.

## Diagnosis and research

The spiral's collision surface is `V13 | helical stair walking ramp`, while its visible geometry is individual glass treads. Sampling the ramp as a foot contact target is inaccurate. An early experimental vertical-leg IK layer produced visibly wrong knee bends. That entire experiment (terrain probes, pelvis offsets, stride changes and leg corrections) was reverted before this change.

The baseline fixed-step capsule route has vertical increments up to 34.3 mm at 60 Hz. Interpolating physics removes refresh-rate judder but does not remove abrupt changes in vertical velocity. Altering the skeleton to compensate for those impulses conflated two different problems.

Primary references:
- [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/): autostep and snap-to-ground move a collision body, not animated feet.
- [Khronos foot placement](https://github.com/KhronosGroup/Vulkan-Tutorial/blob/main/en/Advanced_glTF/Procedural_Animation_IK/04_foot_placement.adoc): contact-phase weighting, target smoothing, pelvis support and foot orientation must cooperate; an IK layer must not fight the swing phase.
- [Epic two-bone IK](https://dev.epicgames.com/documentation/en-us/unreal-engine/two-bone-ik?application_version=4.27): explicit effector/joint target spaces and stretch constraints matter.

## Initial support smoothing

Only the rendered support height is softened, on the fixed 60 Hz simulation clock. The existing interpolation then presents both avatar and camera target at that same time. Maximum deviation from interpolated collision support is 25 mm. Horizontal position, collision geometry, movement speeds, stride phase and every source leg rotation remain unchanged.

The filter bypasses chair animation, riding the lift, substantial falls and teleports. Entry/reset/respawn clears its history. Stopping settles to the exact support height. No Blender edits, asset exports, clip retargeting or new leg IK. Temporary bottom/top stair inspection buttons were used for browser checks and removed afterward.

This is a bounded smoothing improvement, not a claim of anatomically exact tread contact. Precise stair foot planting remains a separate task requiring correct visible-tread targets, planted/swing phases and calibrated knee constraints.

## Verification

- Recorded full ascent/descent at 1.38 m/s: sum of squared frame-to-frame vertical displacement changes reduced by 76.9% ascending and 66.9% descending. This is a motion diagnostic, not a visual-quality score. Maximum filter offset: 25 mm.
- Actual controller and source collision route: full ascent/descent at 60 and 144 Hz; both floor endpoints, stop settling, teleport reset and source-leg quaternion identity passed.
- Flat-ground invariance and bounded support/filter bypass checks passed.
- `npm test`: 67/67 passed, including approved chair entry/exit, palm contact, feet/knee constraints, lift and normal movement checks.
- `npm run build`: passed. Initial sandbox mkdir restriction was resolved by rerunning the same build with approved filesystem access.
- Live browser verification: sampled moving ascent and descent, stopping, and short entrance-step traversal in the original third-person view. The trial knee contortions are absent; the original ramp-versus-visible-tread contact limitation remains. Captures: ascent.png, descent.png, entrance.png. This session used the existing WebGL 2 fallback after a WebGPU device-loss report during reload; no renderer settings were changed.

Evidence/backups are outside the site in `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/stair-polish/`.

## Follow-up: idle drift and visible shoe collision

The next request specifically identified downhill movement while standing and shoe/tread intersection. Two separate corrections now accompany the support smoothing above:

- Rapier's downward support probe was converted into downhill movement on the helical collision ramp. Once horizontal input and deceleration have stopped, sliding is disabled only when a downward ray identifies `helical stair walking ramp`. Walking retains ordinary wall/slope sliding. Applying this globally initially broke two chair-approach tests; that broad rule was discarded and both tests pass with the ramp-only condition.
- `StairSurfaces.ts` indexes horizontal world-space triangles from the visible glass treads and entrance/landing marble. The shoe layer samples the actual skinned shoe vertices against those surfaces, rather than using the invisible capsule ramp or a guessed ankle offset. It only raises an ankle for clearance, preserves its animated orientation, and uses the rig's calibrated two-bone hinge frames. An 18 cm continuous edge margin anticipates higher treads; release is damped. There are no new pelvis offsets, stride changes or horizontal foot targets. Chair states, lifts and substantial falls bypass this layer.

This is collision clearance, not a new root-motion stair clip or full planted-foot locomotion system. A shoe spanning two treads can have clearance above the lower tread. The collision capsule still travels on the approved ramp. All Blender files, GLBs, lighting, materials and the accepted chair/palm implementation remain unchanged.

### Follow-up verification

- Real source-collision idle test at seven spiral positions: maximum drift over ten seconds changed from 241.5 mm to zero.
- Actual interaction controller: walking release, five-second idle hold and continued stair-contact activation passed at 60 and 144 Hz.
- Actual shoe skin versus source visible triangles: ascent and descent at 60/144 Hz walking and 60 Hz running, plus stationary checks at three stair positions and three headings. Minimum sampled clearance was approximately 2.0 mm. Knee flexion remained within the regression limits; foot displacement stayed below the tested per-frame bounds. These numerical checks are not a general visual-quality score.
- `npm test`: 69/69 passed, including chair entry/exit and palm-contact regressions.
- `npm run build`: passed after temporary inspection controls were removed.
- Live WebGPU browser: sampled ascent/descent motion, a stationary hold longer than ten seconds, and an angled stationary view. No downhill idle movement or shoe/tread cutting was observed in these views. Camera rotation near the outer wall can still occlude the view; camera collision was not changed in this task.
- Temporary stair-up/down inspection controls were removed. No GitHub push.

Current backups, logs and screenshots are outside the site in `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/stair-contact/`: `all-tests.txt`, `build.txt`, `ascent.png`, `descent.png`, `idle-before.png`, `idle-after.png`, `stopped-side.png`.

## Follow-up: smoother step assistance, camera collision and runtime cost

18 October 2026. Local changes; no asset exports or GitHub push.

- Increased the bounded render-support smoothing allowance from 25 mm to 75 mm and reduced its response constant from 24 to 18. Physics remains fixed at 60 Hz, with the avatar and camera using the same interpolated support height. Chair/lift/teleport bypasses remain intact.
- Reduced Rapier's autostep minimum landing width from 180 mm to 80 mm, retaining its 270 mm maximum height. This helps the short stone treads. A trial horizontal-movement clamp was removed after measured motion showed riser slowdown, not a forward teleport.
- Extended visible shoe-contact coverage to the v19 rounded landing and shell entrance limestone. The entrance top faces have reversed winding; only horizontal limestone triangles below 50 mm are accepted from that orientation. No geometry or normals were edited.
- Narrowed the triangle grid, cached triangle bounds and avoided duplicate triangle tests per query. Cached bind-space shoe influences now produce world-space skin positions without repeatedly updating entire ancestor matrices. Morphing/nonstandard skin bindings retain the original sampling fallback. The independent regression still measures Three.js skinned vertices, rather than trusting this cache.
- Camera obstruction retracts the follow distance immediately and restores it gradually. The camera follows the already-interpolated body directly instead of lagging in world space through corners. After collision shortening, it aims again at the actual follow target. A central ray supplements the sphere sweep, and a forced minimum distance no longer pushes the camera through a close obstacle. Cinematic entry and first-person blending remain.
- Auto resolution now responds below 55 FPS instead of 35 FPS, with 5% changes and separate recovery thresholds. This targets smoother delivery while retaining the existing resolution floor, materials, geometry, lighting and texture settings. It is not a guarantee of 60 FPS in every view.

### Verification

- `npm test`: 70/70 passed. Actual geometry checks cover spiral, entrance and rounded stairs in both directions at 60/144 Hz walking and 60 Hz running. Minimum sampled shoe clearance is approximately 2 mm. Bounded foot displacement, knee angles, horizontal body travel and stationary holds pass, alongside the existing chair/palm and lift checks.
- Added an actual-controller corner-orbit regression at 30/60/144 Hz: camera sphere stays outside both walls, aim stays on the follow target, and outward recovery remains bounded. The backed-up controller fails its aim assertion; the new controller passes.
- Avatar microbenchmark: contact-update median/p95 decreased from 3.85/7.25 ms to 2.12/3.36 ms in the recorded runs. These are CPU measurements, not a whole-scene FPS guarantee.
- Live WebGPU verification sampled third-person rounded ascent, spiral descent, entrance step traversal and camera orbit near the staircase/walls. The final pre-cleanup views varied approximately 43-82 FPS at 100% resolution depending on view and movement. Temporary inspection controls were removed afterward.
- `npm run build`: passed, including TypeScript and static generation.

This remains a bounded contact-clearance layer over the accepted locomotion clips, not a new authored stair gait or complete planted-foot system. Foreground walls may still occlude part of a tight view; camera collision prevents passing through tested solid colliders, rather than making walls transparent.

Evidence and backups: `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/stair-smooth/` (`all-tests.txt`, `build.txt`, `camera-before.txt`, `camera-tests.txt`, `cpu-before.txt`, `cpu-after.txt`, `rounded-ascent.png`, `spiral-descent.png`, `entrance-ascent.png`, `wall-orbit.png`).

Final reload after cleanup: the normal Explore view loaded successfully with the temporary stair controls absent. At the gallery landing, Auto recovered to 61-83 FPS at 70-75% resolution in sampled diagnostics; the final moving sample reported 78 FPS and 12.5/16.3 ms median/p95. These are short view-dependent observations, not a sustained performance guarantee. Saved `final-local-view.png` and left localhost open for inspection.

## Locomotion contact refinement — 28 October 2026

Active working copy: D:/Motion Design MD BACKUP 26-10-2026. Protected FINAL and original Blender/GLB assets remain unchanged. Backups and numerical logs: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/stair-gait-2026-10-28/.

Two independent animation causes were measured:

- Sole-clearance IK used the seated calibrated knee hinge for every locomotion correction. A 2 mm idle floor adjustment changed the source thigh orientation by up to 9.32 degrees. Locomotion now preserves its animated knee plane and applies only the necessary two-bone swing. Idle thigh change is 1.88 degrees; moving ordinary-floor maximum is 3.65 degrees. Animated foot orientation stays within 3.3e-7 radians of the original. Chair contact still uses its existing calibrated solver and is untouched.
- A stair top became eligible abruptly at render support +270 mm while the render support could lag physical support by75 mm. A rounded ascent frame therefore introduced about70 mm of foot lift at once. For existing authored v13/v19 stair materials only, the anticipatory query now fades through an80 mm reach band. Exact contact queries and ordinary raised ledges retain the270 mm maximum-step rule; no new pelvis, stride, model scale or chair changes. The experiment increasing horizontal edge margin was rejected and the original180 mm margin remains.

Validation: three new regressions pass for source-pose preservation, continuous stair eligibility and exclusion of unreachable ordinary ledges. The combined stair-contact/avatar/reported-defects run passed20/20. Actual source geometry checks cover18 combinations of spiral/entrance/rounded ascent and descent, walking at60/144 Hz and sprinting at60 Hz, plus standing and different headings. Sampled sole clearance remains about2 mm. Rounded walking ascent maximum frame foot displacement changed81.1→70.3 mm at60 Hz and77.4→38.35 mm at144 Hz. These maxima include normal animated foot travel and are not a standalone visual-quality score. Root contact-clearance work is coordinated separately; the final integrated suite/build/browser verification belongs to the parent task.

Scope/limits: these are improvements to the existing source gait and foot-clearance layer, not newly authored root-motion stair clips or a full planted-foot gait scheduler. No desktop/native UI was used by this subtask. Actual browser motion and screenshot verification remain necessary in the integrated release.

### Integrated controller follow-up

Browser review exposed a separate controller bug absent from direct-physics contact tests: the anticipatory torso cast treated an upcoming stair landing as a wall. Full-scene reproduction at [8.3,3.675,-23], yaw PI/2 stalled both walk and sprint at x~7.755 before the first rounded tread. The hit was `V19 | Unified curved pavement and rounded short steps`, ~0.525 m ahead with normal.y~0.52. Spiral sprint was also slowed by `V13 | helical stair landing`, normal.y~0.97. Disabling only the predictor in a numerical diagnostic restored both routes, proving the layer. Parent fixed the predictor using an exact authored-support allowlist; physical KCC collision, rails, walls and furniture checks remain active.

New `qa/stair-controller.test.mjs` runs the real InteractionController, all source collision chunks, visible v13/v18/v19/entrance/shell geometry, actual source avatar, velocity filters and obstacle predictor. Twelve routes pass: three stair systems, both directions, walking and sprinting. Assertions include per-waypoint progress deadlines, total travel time, permitted/requested velocity ratio and real animation blending. Every tested route now has allowed/requested ratio1. Rounded ascent is3.03 s walking/1.10 s sprinting; spiral9.05/3.53 s; entrance2.32/.90 s. Rounded/entrance sprint reach source run weight~0.99. Tight spiral ascent achieves2.60 m/s and uses a0.50 walk/run blend, while descent achieves3.20 m/s and0.96 run weight. This follows actual physical travel instead of forcing a flat-ground run cycle that would slide.

Evidence: `controller-full-path.log` reproduces the failure, `controller-full-fixed.log` validates the predictor fix, `controller-regression.log` records all12 final routes. No additional runtime edit was made by this follow-up; the predictor change belongs to the parent's CollisionWorld patch.
