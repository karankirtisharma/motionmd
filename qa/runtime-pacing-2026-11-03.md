# Runtime pacing and retry lifetime — 3 November 2026

Active workspace: `D:\Motion Design MD BACKUP 26-10-2026`. Protected `D:\Motion Design MD FINAL` and original Blender/GLB/character assets are unchanged. Temporary source checkpoints: `%TEMP%\md-runtime-pacing-2026-11-03`.

## Evidence and changes

- The production baseline recorded by the parent audit (`baseline-performance.json`, hardware WebGPU, Chrome 156 headless, 1280×720, DPR 1) reported 152 parent-page UI commits during its 15-second tour. `onTourProgress` updated `LoungeHome` state every 0.001 progression, reconciling the entire interface/debug panel. The new external store updates only the small timeline and diagnostic progress subscribers at the **same** cadence. Parent state changes only at entry/exit from end-of-tour handoff. The progress bar, label, slider semantics and native controls are unchanged.
- Terminal errors previously stopped rendering but retained the partially loaded scene until retry/unmount. `fail()` now starts teardown immediately. Fetch cancellation/input/frame stopping happen immediately; GPU/resource release waits for pending init/parse/compile to unwind. `dispose()` is idempotent and returns a completion promise.
- The page owns each exact runtime instance and awaits the previous teardown before initializing a retry. A cancelled intermediate effect never creates a renderer. This prevents stale cleanup from touching a replacement runtime and prevents old/new GPU allocation overlap during rapid retries or React StrictMode cleanup.
- Hidden documents previously kept receiving animation callbacks which returned early. Visibility changes now unregister the callback and restore it with a fresh clock when visible, while respecting expanded studio coverage and the existing pause state. Covered 3D remains stopped.
- Mirror-camera calculations now retain scratch vectors/planes; mirror visibility preservation also reuses its small array. This removes per-update temporary allocations, with bit-identical reflected world/projection matrices over 512 poses, both rendering coordinate systems and both depth conventions. Reflection cadence, full-resolution shadows, materials and all character animations remain unchanged.
- Scene manifest loading now shares the retrying/stall-aware `fetchBuffer` path owned by the loading-reliability work.

## Validation

- `node --test qa/runtime.test.mjs qa/runtime-retry.test.mjs qa/tour-progress.test.mjs qa/mirror-camera-parity.test.mjs`: 18 passed.
- `node --test --test-name-pattern='mirror clips|exported mirror|founder side' qa/gallery-mirror.test.mjs`: 3 passed.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed after integrated changes.
- Actual delivered page effect test: 99 intermediate progression samples cause zero parent state updates; end-of-tour and seeking away from the end still update immediately.
- Fault-injected lifecycle tests: delayed initialization, delayed GPU release, duplicate disposal, terminal error, cleanup throwing, rapid retry/cancel, hidden tab and overlay visibility transitions all pass.

## Remaining measured bottlenecks and limits

The baseline showed 16 first-use shader builds during the opening tour and ten net new programs. Pinned Three r186 `compileAsync` uses frustum culling, so materials first exposed later are not necessarily compiled from the opening camera. Broad offscreen warmup previously increased loading time; it has **not** been reinstated. No FPS/latency percentage improvement is claimed by these isolated tests. Matched browser profiling, full visual verification and whole-suite/build results belong to the parent audit report.


### Bounded warmup experiments - measured

- Rejected main HDR/MRT attempt: compiling the 16 non-shadow objects from the baseline first-tour event list took only 2.1 ms, confirming those main-pass variants were already cached. Startup node builds stayed 1,068 and the 15-second tour still had 7 intervals above 50 ms (20 new node builds). Evidence: `warmup-performance.json` in the session evidence directory. No improvement is claimed.
- Follow-up experiment compiles the same exact 16 object/material pairs into the mirror's actual RGBA half-float 4x MSAA context, with its persistent camera, shared lights and no velocity MRT. The same main-pass attempt was removed. Nothing is drawn, geometry/materials are untouched, culling and renderer state restore even on failure/abort. The debug-only `tourWarmup=0` switch allows same-build comparison. Keep only if the matched browser capture improves the hitches sufficiently to justify startup cost.
- Shader events now optionally report render pass and MSAA sample count from the real render record, so future captures can distinguish mirror builds from main HDR/velocity builds instead of treating both as generic non-shadow events.


### Accepted mirror warmup: immediate same-build comparison

Parent's hardware-WebGPU 1280x720 headless comparison (same build, same 15-second tour, `tourWarmup=0` control):

| Metric | Warmup off | Warmup on (16 measured pairs) |
| --- | ---: | ---: |
| Runtime ready | 86.56 s | 84.03 s |
| Frame interval p50 | 19.5 ms | 18.7 ms |
| Frame interval p95 | 22.7 ms | 22.1 ms |
| Frame interval p99 | 63.3 ms | 25.4 ms |
| Intervals above 50 ms | 9 | 1 |
| Tour node builds | 15 | 3 |

Evidence: `mirror-off-performance.json` and `mirror-on-performance.json` in the session evidence directory. The mirror warmup phase itself was 12.15 seconds, but total runtime readiness did not increase in this matched pair because phase timings and completion waits overlap CPU/GPU work. Do not equate that phase with a 12-second net loading penalty or claim universal startup/FPS gains. The host's normal frame intervals changed versus the earlier baseline, so use this immediate same-build comparison for the warmup decision.

The final bounded list adds exactly the three remaining measured mirror pairs: miniature walnut timber (`..._60`), bone linen binding (`..._56`) and charcoal basalt (`..._63`). Their builds clustered at 11.69-11.76 seconds in the on capture, with one 131 ms long task; program count stayed 388, so these were additional node-graph builds with reused programs. Final list: 19 exact object/material pairs. Final browser confirmation of the expanded list belongs to the parent audit; no zero-hitch claim is made before it runs.


Final 19-pair capture reported by the parent: frame p50/p95/p99 10.3/11.8/12.8 ms, one 51 ms interval. Two newly exposed mirror variants appeared at the denser frame sampling: honed ivory limestone (`Box_Founder_polished_floor002_62`) and petrol cloth binding (`..._59`). The final list adds exactly those two observed object/material pairs (21 total), with no broader offscreen warmup. Final 21-pair and WebGL validation remain with the parent. No Blender source, geometry, textures, materials, character rig, clips or animation behavior were changed by this work.

Final21 browser capture: zero tour shader builds, zero intervals over50ms, zero long tasks; four intervals over25ms. Parent UI commits8. Full-precision quality retained. Evidence `final-21-performance.json`; sustained FPS and loading percentages are not claimed because background workload varies.
