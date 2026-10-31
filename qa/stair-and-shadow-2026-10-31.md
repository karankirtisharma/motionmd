# Stair contact and studio shadow repair — 31 October 2026

This follows the published microstutter checkpoint `bb23118`. Work is in `D:\Motion Design MD BACKUP 26-10-2026`; the protected FINAL copy and source Blender/GLB assets are unchanged.

## Reported studio reflection defect

The regular diagonal bands on the bronze desktop were sun-shadow self-intersection (shadow acne). They persisted with environment reflections disabled and disappeared with sun shadows disabled. The source material, inspected read-only in Blender, is patinated umber bronze: metalness 0.88, roughness 0.28–0.36, with tiny authored bump detail. UVs were not degenerate. Replacing that material or reducing its reflection would hide the cause and change the intended finish.

The directional-light PCF now compares each sample with the receiver-plane depth at that sample, including a bounded hardware-filter footprint adjustment. It retains the pinned Three.js five-sample Vogel pattern, 4096 High-quality map, radius, real occluders, material textures, lighting and reflection probes. There are no additional shadow maps, render passes or dependencies. The filter has native WGSL and GLSL versions for the existing WebGPU/WebGL backends.

Visual checks cover the matching close view and a low grazing view, with all lighting enabled. Two debug-only reference cameras reproduce them. The static-shadow cache was also compared with the full shadow pass after this change: 6,797,216 HDR components at 1366 × 1244, zero changed pixels, zero maximum component difference and no non-finite components. The measured view submitted 421 draw calls / 14,503,248 triangles with the full pass and 112 / 4,377,594 with the cache. These are same-view render counts, not an overall FPS claim.

## Stair shoes and sprint transition

The restored source gait did not account for the individual tread surfaces above the smoothed movement support. Retain the original rig, clips, gait phase, horizontal foot path and foot orientation. Only raise a shoe if its actual skinned geometry intersects a nearby tread. A deficit shared by both feet raises the visual body instead of folding both knees. Knee bend planes are measured from the original animated chain before raising the target; this avoids the prior inward/backward flip. The correction is bounded to 24 cm and excluded from chair interaction and ordinary floor poses.

Stair proximity and the controller's existing stair hold blend the source run into the source walk without restarting actions. Shift uses the existing controlled brisk stair traversal. Normal flat-ground sprint returns smoothly. No animation assets, head/neck transforms, chair sequence, camera collision or physical stair colliders were replaced.

## Verification and cost

- Full suite: **183 tests passed, zero failed**. TypeScript and production build passed.
- The unchanged strict contact audit passed all 12 combinations of spiral/rounded/entrance stairs, ascending/descending, and walk/sprint input. All 361 shoe vertices were checked; maximum positive tread penetration was zero in these routes, versus up to 20.8 cm at the prior checkpoint.
- Actual-controller tests also retain the 5 mm shoe-penetration assertion.
- 480-frame anatomy regression: maximum foot horizontal displacement 0.000000103 m, foot rotation delta 0.000000267 rad, limb-length delta 0.000000203 m; minimum knee-plane alignment dot product 0.999878. Upper-body source rotations are unchanged.
- 600-frame sprint transition regression checks phase continuity, bounded blend changes and return of flat-ground sprint.
- Browser samples include spiral ascent/descent, rounded ascent at two phases, entrance steps, the normal third-person camera and wider reference angles. Close third-person views can crop the shoes in the tight spiral; only full-body samples are used as foot evidence.
- A five-trial, 600-update analytic avatar fixture measured flat updates at 0.0920 ms before / 0.0905 ms after (effectively unchanged); stair updates at 0.0916 / 0.1644 ms. The extra approximately 0.073 ms is contact work in this CPU fixture; it excludes real scene queries and rendering and is not a device-wide frame-time claim.

Evidence is stored outside the website in `C:\Users\karan_z7alww2\.codex\visualizations\2026\10\17\01a14a42-20bc-7ca3-a5e8-1779e078f8e0\stair-repair-2026-10-31`: `strict-contact-final.txt`, `anatomy-tests.txt`, `final-tests.txt`, `build-reflection.txt`, `avatar-cpu-benchmark.json`, `shadow-cache-after-audit.txt`, `bronze-close-before.png`, `bronze-close-no-reflections.png`, `bronze-close-no-shadows.png`, `bronze-close-after.png`, `bronze-grazing-after.png`, and the named stair screenshots. Original code snapshots are in its `before` directory.

WebGL 2 fallback also loaded and rendered the matching bronze close-up and lounge scene without browser errors; see `bronze-webgl-after.png` and `lounge-webgl-after.png`. This is backend compatibility on the same machine, not validation on a second physical GPU.

## Limits

The contact tests and sampled poses do not prove every arbitrary diagonal turn, tread-edge straddle or device is artifact-free. The clearance layer preserves a simple source gait rather than introducing foot locking or bespoke stair motion capture; perfect planted-foot behavior is not claimed. Background-tab throttling prevents a trustworthy foreground FPS comparison. The microstutter report's startup compilation, reflection/texture memory and low-end-device limitations still apply. This pass resolves the recorded strict stair-contact failures without claiming that all launch performance issues are gone.
