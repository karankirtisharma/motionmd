# Simple character motion — 30 October 2026

## Earlier simplification checkpoint
The user rejected the experimental replacement rig and complex stair correction. Restore the original character and ordinary motion on stairs. Preserve the room, physical movement/collision, camera and established chair interaction. This supersedes previous fresh-rig and per-tread locomotion plans.

## Change
- Original RocketboxVisitor.glb, skeleton, skin and Idle/Walk/Run/Sit clips remain unchanged. Runtime restored from checkpoint d2b1be296e142fbebc2ddc6cc6f47edf469939dc, with locomotion foot/terrain deformation removed.
- Removed candidate selection, replacement assets, foot trajectory planner and terrain IK. Even an old motion=candidate URL now loads the original character.
- Walk/run share their existing distance-based phase. The controller retains stair step assistance and supported root motion; stairs cannot overwrite any authored leg, neck or pelvis joints.
- A bounded whole-model vertical correction clears the physical support plane using actual shoe skin. No foot rotations, separate foot targets or knee bending are introduced. Measured flat-floor correction peaks at 23.60 mm. The 10 mm support tolerance covers the controller's existing 9 mm contact offset; the hard correction cap is 40 mm.
- Desk/chair hand, finger and foot IK is retained separately. Its test calibration now excludes the locomotion-only model offset when measuring the source ankle height.

## Recovery / provenance
The FINAL folder and architectural Blender source are unchanged. Rejected character assets, source modules and superseded experimental tests are recoverable outside the website at C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/locomotion-rebuild-2026-10-29/rejected-pipeline. Fresh Blender character work remains alongside that archive. No GitHub push was made for this simplification.

## Verification
- 123/123 current regression tests passed. Production Next build passed.
- New invariant checks 360 frames of walking, running, stopping and turning: identical authored bone poses with and without stair input, and zero terrain samples by the animation layer.
- Full scene route tests cover walking/running, ascent/descent for spiral, rounded and entrance stairs. Chair entry/work/exit and wall/camera collision regressions pass.
- The six experimental IK/planner/retarget tests were archived with the removed implementations. They are not counted as passing; their per-tread target contract is deliberately no longer part of this version.
- Browser WebGPU preview reloaded from the rebuilt production server. Frame-stepped the original walk up/down the spiral stair and the original run on rounded steps; inspected side and third-person views and stopped into idle. Sampled poses retain the original anatomy, without terrain-generated joint twists. Saved simple-spiral-walk.png, simple-spiral-third-person.png, simple-spiral-descent.png and simple-rounded-run.png in the external evidence directory above.
- The background tab was throttled to roughly one presented frame per second. Debug stepping advanced simulation in 1/60-second increments, allowing pose inspection; this does NOT establish foreground realtime smoothness or an FPS improvement. Physical route and transition tests provide additional coverage, not a substitute for user visual approval.

## Deliberate limitation
This is ordinary authored walking/running carried over collision-supported stairs, not a bespoke mocap stair gait. Feet are not locked individually to every tread. Exact tread contact is not promised; restoring consistent anatomy and predictable motion takes priority over procedural foot placement, as requested.


This checkpoint is superseded by the bounded tread-clearance repair and final forward-knee / brisk-walk refinement in `qa/performance-2026-10-30.md`. The original rig and clips remain in use.


This checkpoint is superseded by the bounded tread-clearance repair and final forward-knee / brisk-walk refinement in `qa/performance-2026-10-30.md`. The original rig and clips remain in use.
