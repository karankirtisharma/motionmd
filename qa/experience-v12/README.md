# Collision coverage and grounded locomotion v12

## Contract and checkpoint
- Base: published `2befb4728946bd5d76d343cc51dd201a07c986d1`.
- Preserve source geometry, material appearance, lighting, the 90-second tour, lift and seated interactions.
- Inspect the preserved v10 architectural Blender derivative; do not save over it or the original.
- Runtime and manifest backups: outer workspace `outputs/experience-v12/backup/`.
- Target: stop the complete capsule at remaining walls, objects and balcony glazing. Keep existing doorways, stairs and lift traversable.
- Animation direction: weighted starts/stops and restrained turn response inspired by grounded third-person games, using the existing licensed rig/clips. No game assets or new animation downloads.
- Budget: no additional visible meshes, texture downloads or draw calls for the animation. Measure collider download/CPU changes against the current scene.
- Exact remaining locations requested from user; audit proceeds independently.
- Verification: source coverage and full-body probes, existing traversal/lift/tour suite, numerical animation/transition tests, production build and browser motion review. Device-wide performance remains unmeasured.

## Findings and validation
- Confirmed omitted panes: `MF left gallery forward return glass`, both `MF36 gallery guard pier return glass` objects, `FR40 parked gallery glass leaf`, and `FR40 gallery glass guard.001/.002`. Both-direction capsule probes crossed these before the repair; current walk/run probes stop outside them.
- Also confirmed previously enterable source geometry at two EH47 entrance display backings, FR40 rear stone return, PL87 far-side stone return, the MD lower spine/pedestal and several arrival rocks. `coverage-comparison.json` records center probes before/after; some other reviewed components already had partial neighboring coverage.
- Added 46 source-derived static shapes in `public/assets/experience-v12/static-solids.glb` (195,412 bytes). Solid convex components use individual hulls; wall returns/backings retain their mesh topology so openings are not filled by broad boxes. Original visual meshes/materials/lighting are unchanged. Archived furniture templates were explicitly excluded after checking evaluated transforms and collection visibility.
- Panel survey: 163 original candidates, six missing panes fixed. A sloping rail was a false-positive when its entire bounding box was treated as a panel; it was not turned into an invisible wall. Existing pane/guard geometry remains authoritative.
- Animation: shared distance-driven phase, source-measured .05-cycle run offset, normalized idle/walk/run/sit weights, restrained upper-spine lean (at most about four degrees), bounded body turn rate and deceleration for sharp reversals. No downloaded animation, new rig, GPU effect or visible geometry. Existing seated foot IK and body-camera calibration are retained.
- Rejected trial: feeding very small body/contact corrections into turn-based speed caused a flat-floor snag. A 20-degree full-speed dead zone removed that feedback; uniform-motion tests pass at 60/90/144/165 Hz. One initial debug spawn was inside a pier and was moved to a numerically verified clear walkway.
- **47 tests pass**, including 52 walk/run approaches to the six new panes, 28 source-solid occupancy probes, original entrance/stairs/gallery routes, chairs, synchronized moving lift/cinematic clearance, high-refresh movement, animation loops/sit transitions and new balcony inspection points.
- Collision benchmark: 722 → 768 meshes; 317,216 → 331,340 triangles; 0.0611 → 0.0627 ms per controller move on this machine. This is a local CPU microbenchmark, not a demonstrated GPU/FPS improvement. No new visible draw calls or textures were added by these repairs.
- Original Blender hash remains `a39d1652ddc41c241fb689eefd8ba7facedec388cb6c57e597494a065e138895`.
- Browser: WebGPU scene loaded; founder balcony approach, entrance walking/turning/sprinting and doorway traversal were inspected. Active samples reached roughly 46–108 FPS depending on view, but the in-app browser also intermittently ran at 1 FPS. These are observations, not a controlled before/after performance claim. Long uninterrupted animation acceptance and WebGL/mobile rechecks remain pending.
- A debug-button click after hot reload used an old runtime instance and raised an undefined-spawn error; a full reload loaded the revised runtime. Do not mistake this development-session error for a verified production failure.
- Final production build passed after both debug inspection points were added; all 47 tests pass. The handoff includes the final build/test logs.
- No commit, push or deployment of v12 is authorized or performed. The previous explicit GitHub update covered v11 only. On the user's later request, work switched to a lean D: handoff; full interactive visual acceptance remains open.
