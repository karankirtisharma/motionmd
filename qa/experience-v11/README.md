# Experience v11 — collision coverage and complete cinematic

## Pacing refinement — 10 October 2026

User set a firm 60–90 second limit and rejected the first staircase detour. Current edit supersedes both the initial 152-second tour and the intermediate 132-second retiming: **90 seconds total**. Route: exterior → entrance → PC screen-side tracking arc → suspended bronze MD installation in the studio → atrium MD sculpture → presentation seating/screen → lift → founder desk/interior → exploration. The staircase/gallery loop is removed from the cinematic; it remains available in free exploration. Source screen bounds and Blender-to-web coordinates were inspected, then browser verification identified and corrected an initial monitor-back shot. Source assets are unchanged.

The camera dollies backwards into the lift at 64 s, retaining the presentation-room view instead of waiting through a stationary 180-degree turn. Doors close by 65.5 s, the eased hydraulic ascent ends at 73.5 s, and doors open by 75 s. The last 15 seconds reveal the founder interior. Level horizon, curvature-based slowdowns, smooth orientation filtering and focal-length transitions remain. The look-filter window is reduced from 1.75 to 1.25 seconds so adjacent transit directions do not overwhelm feature framing; a 1-second trial exceeded the turn-rate budget and was rejected.

All 42 tests and the production build pass. Current sampled peak speed is 2.31 m/s, acceleration 3.38 m/s² and turning 36.24 degrees/s, within the 2.4 m/s, 4 m/s² and 40 degrees/s budgets. No static intersections in the 9,000-sample audit; synchronized moving-lift clearance also passes. See updated `camera-clearance.json`.

Source inspection correction: FR80/FR83 objects named chandelier are hidden. The requested visible jhumar is the SC02 suspended bronze installation in the PC hall, spanning approximately world x=16.19–16.56, y=3.28–8.69, z=−31.52–−27.28. Browser verification confirms this is the large hanging MD artwork. The camera gives it an upward reveal with a wider lens; it does not enable hidden geometry. The atrium MD shot also uses a wider lens to preserve the complete silhouette in a narrower viewport. Screen-side and installation screenshots are retained in the outer QA output directory.

Final candidate browser checks: confirmed screen fronts at 26.5 s and the actual hanging MD installation at 32 s. Saved `showcase-pc-screens.png` and `showcase-hanging-md.png`. No browser console errors on the final load. Active-view samples reached 83–165 FPS, but the app intermittently returned to 1 FPS between interactions; these samples are not a full-tour performance certification. The deterministic motion, continuity and moving-lift clearance tests pass independently of that browser throttling. Preview remains available at localhost:3001 with the revised 90-second duration.

## Scope and evidence

- Request: repair remaining collision problems; provide a full architectural showcase; use the lift animation to reach the founder room.
- Baseline: local main at `1e56384beea987473c12998bdeea31cafd99e5ae`. Existing 39 tests passed, but that did not prove complete collision coverage.
- The old cinematic selected only source frames up to 469. It deliberately omitted the studio, stair, upper gallery and founder-room tour anchors.
- Source-object / collider inventory and full-capsule probes confirmed missing bridge glass, gallery glass, founder cabinet and founder club-seat colliders. A narrow-walkway browser test also showed the follow camera filling the frame with the avatar's back.
- No visual meshes, source textures, lighting, baked GI or original object placements were changed in this revision.

## Initial implementation history (timing superseded above)

1. Exported 51 additional individual convex solids from the preserved v10 Blender scene: glass guards/panes, source piers, cabinet carcass/top and cushions. These are exact-object envelopes, not whole-room bounding boxes. Additional download: 816,568 bytes. Editable collision-only derivative: `outputs/experience-v11/Additional_Colliders.blend` in the outer workspace.
2. Kept the existing fixed-step full-body capsule and collision solver. Walking animation now follows achieved movement; sub-6 cm/s contact corrections are treated as idle, and riding the lift resets locomotion speed.
3. Added hysteresis to camera clearance: below 1.4 m of follow space, blend to eye level; return to the requested third-person view above 1.7 m. Applies to exploration, not seated framing. V continues to control the explicit camera preference.
4. Authored a 152-second continuous, live-3D route: desert/exterior → entrance/atrium → studio → original stairs → upper gallery/bridge → aerial descent through the open atrium → presentation room/screen → glass lift → founder room.
5. Curvature-weighted timing slows tight corners; filtered unwrapped yaw/pitch keeps a level horizon and avoids quaternion-turn discontinuities. The route does not replay the long return walk.
6. Board at 111 s; turn in the cabin until 121 s; close doors by 122.5 s; rise over 8.5 s; open by 132.5 s; then reveal the founder room. Cabin, doors, ram, cables, light and physics all use the same deterministic pose. Pause, replay and debug scrubbing use that same clock. Moving lift geometry refreshes shadows.
7. End-of-tour exploration starts upstairs where the camera stops, with the lift parked upstairs. Choosing Explore early uses the existing fade to the lounge instead of flying the follow camera through the building.
8. Added a debug timeline slider and movement inspection points for the bridge, gallery and founder room.

## Research applied

- [ArchDaily: architectural drone photography/cinematography](https://www.archdaily.com/899124/a-guide-to-drone-photography-cinematography-for-architecture): compose architecture at different scales—context, detail, and movement between spaces. Applied as deliberate room reveals and a spatially coherent full route.
- [Rapier 0.21 character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/): character offset, gravity, stepping and ground snapping must work together with actual collider coverage. Preserved the tested solver settings and corrected missing physical geometry rather than changing the controller indiscriminately.
- Local skills used: Blender-to-web realism, Blender production, Awwwards animations. Applied staged asset verification, original preservation, still/motion QA and frame-rate-independent movement; no new animation dependency was needed.

## Verification

- Original Blender SHA-256 remains `a39d1652ddc41c241fb689eefd8ba7facedec388cb6c57e597494a065e138895`.
- Previous code and manifest preserved in the outer workspace at `outputs/experience-v11/backup/`.
- 42 automated tests pass: actual source collision meshes, walking/sprinting, original stairs/gallery connections, entrance steps, desks/screens, four-chair approach/seated behavior, body/third-person camera, 60/90/144/165 Hz interpolation, lift interlocks/call/ride/exit/replay.
- Added movement tests check full-capsule overlap at every step against the repaired glass guards, cabinet and club chair. Rounded chair surfaces may correctly slide the character around the obstacle.
- 9,121 samples along the complete tour are checked against static architecture AND the lift's synchronized moving collision volumes; no intersections with a 17 cm camera sphere.
- Current motion sampling: peak camera speed 2.31 m/s, acceleration 3.38 m/s² and turning 36.24 degrees/s; level horizon throughout. See `camera-clearance.json` and the cinematic tests for current numbers.
- Collision microbenchmark: 722 source meshes / 317,216 collision triangles, approximately 0.062 ms per controller move on this machine. This is a local CPU measurement, not a promised end-to-end FPS increase.
- Production build and asset-closure check pass. The asset-check total includes retained local historical assets; it is not the browser's transfer size.

## Initial browser observations and limits (current candidate checks above)

- Checked studio and presentation-room compositions, bridge movement and automatic close-camera recovery, closed cabin doors at 123 s, rising cabin at 128 s, open upper landing at 134 s, founder desk reveal at 146 s and the end-of-tour Explore prompt/handoff.
- Browser screenshots are in the outer workspace at `outputs/experience-v11/`, including `lift-founder-arrival.png`. Existing model/material appearance is preserved.
- The initial in-app browser pass ran at approximately 1 FPS / 1001 ms per frame even when the browser visibility was enabled. The cause was not established. It allowed state/framing checks but **does not verify real-time playback smoothness**; foreground playback on the user's machine remains a required acceptance check. Earlier higher FPS observations from different views are not a controlled performance comparison.
- No new runtime errors were reported after the final reload. Console history retains a resolved intermediate duplicate-variable compile error; current build passes. Existing Three.js Clock/RGBELoader deprecation warnings remain.
- No cross-device/mobile performance certification or full offline-render parity is claimed. Source foliage and baked-material appearance are unchanged. Publication to GitHub was explicitly authorized by the user on 10 October 2026.
