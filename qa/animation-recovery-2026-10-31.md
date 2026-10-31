# Original locomotion recovery — 31 October 2026

The latest user request explicitly restores the previous, simpler character animation. The runtime is restored byte-for-byte from the saved simple-locomotion checkpoint at `performance-2026-10-30/before/src/runtime/interaction/RocketboxAvatar.ts`, in the external Codex evidence folder. SHA-256: `69599ced323bb79e984e9807919e7c2c47824d7ea874a3217cdb286fc8dfe999`.

## Scope

- Original RocketboxVisitor GLB, skeleton and Idle/Walk/Run/Sit clips are unchanged. No new rig, export or animation download.
- Remove the later per-tread vertical foot IK, knee solving and terrain-contact queries. The authored bone poses now stay identical whether stair data is supplied or absent.
- Retain the existing bounded 0–4 cm whole-model sole placement, phase-synchronized walk/run blending and restrained torso lean.
- Retain the existing chair/desk palm, finger and seated foot IK without edits.
- Retain physical body/camera collisions, stair body support and the controller's stair speed cap without edits.

## Verification

`node --test qa/simple-locomotion.test.mjs qa/avatar.test.mjs qa/reported-defects.test.mjs qa/stair-controller.test.mjs`: **22 passed, 0 failed**. This includes unchanged hand/finger contact checks and 12 real-scene ascending/descending walking/Shift routes. The new regression test compares every bone's position/quaternion on flat and stair inputs across walking, running, brisk walking, stopping and sitting; the terrain callbacks are never invoked. Source quaternion components are compared directly because imported keys are not guaranteed to have exact unit length.

Measured animation CPU with actual loaded spiral stair surfaces, the same 1,200-frame walk trajectory, 180-frame warmup, six runs alternating before/restored order:

| Animation CPU metric | Before | Restored |
| --- | ---: | ---: |
| Median per-run p50 (upper median) | 1.2365 ms | 0.1026 ms |
| Median per-run p95 (upper median) | 2.0467 ms | 0.1222 ms |
| Median timed total for 1,200 frames (upper median) | 1455.0124 ms | 128.3594 ms |
| Terrain queries per measured run | 3619 | 0 |

The timed animation total is about **91.2% lower in this fixture**. This is a CPU microbenchmark, not a whole-site FPS or loading-time claim. Raw runs: external `performance-2026-10-31/animation-cpu-benchmark.json`. Tests: `animation-regression-tests.txt`. Pre-change rollback source/tests: `animation-before/` in the same external evidence folder.

## Explicit remaining limitation

This restores the older animation's behavior and therefore does **not** provide exact individual shoe/tread contact. The unchanged strict `node qa/stair-contact-audit.mjs` intentionally still fails (first measured spiral case: 20.81 cm worst intersection). Real controller-route measurements reach 7.5–18.8 cm depending on route/direction/speed. The controller's physical body remains supported and makes continuous progress; the visible source foot trajectory can intersect a riser.

The controller regression now checks source-pose preservation rather than asserting the removed IK's 5 mm contact contract; it still emits the penetration measurements. The independent strict audit is retained unchanged so this limitation cannot be mistaken for a resolved collision defect. Visual verification belongs to the production scene review; the numerical results above do not claim visual approval.

This recovery supersedes the terrain-IK additions described at the end of `simple-locomotion-ledger.md`. It deliberately does not introduce another procedural gait system.
