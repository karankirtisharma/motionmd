# Performance audit â€” 26 October 2026

## Contract and rollback
Working copy: D:\Motion Design MD BACKUP 26-10-2026. The original D:\Motion Design MD FINAL is the untouched safety copy. Baseline is the verified e5338c17d5c53dab745e09d7c45035c8273b27ae snapshot recorded in BACKUP-VERIFICATION.json. No publication is authorized for this audit.

Preserve geometry, materials, lighting, antialiasing, full-resolution quality, character/chair/stair animation, collision and camera behavior. No Blender edits or asset recompression. Pinned Next 16.3.8, React 19.3.0 and Three r186. Evidence is outside the working copy at:
C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/performance-2026-10-26

## Measurement
Production builds; localhost; Windows Chromium 156; RTX 4070 12 GB (driver 621.01). Viewport 1627Ã—1244, DPR 1. Frame captures lock High quality at 100%. Opt-in diagnostics at ?debug=1&profile=1 measure 15-second foreground windows, frame intervals, CPU update/mirror/submission time, >50ms long tasks, UI commits and renderer-tracked memory. CPU submission is not GPU execution. GPU timestamps/total VRAM and real WAN/mobile loading have not been measured.

Baseline debug backend labeling used a minified constructor name and was unreliable; corrected to Three's backend capability flag.
Asset inventory: 890.9 MB on disk, 458.5 MB scene chunks, already Meshopt/KTX2 compressed. Observed initial request bodies total 669.07 MiB, 667.39 MiB transferred across 119 asset requests. Do not equate disk size with transferred bytes.

| Baseline | p50 / p95 / p99 frame ms | Detail |
| --- | --- | --- |
| Frozen QA surface Post shadow | 9.2 / 16.8 / 19.0 | 1,514 redundant rendered frames / 15s; mirror CPU p50 3.8ms |
| Opening tour, 0â€“15s | 27.7 / 33.9 / 74.1 | Mirror CPU p50 10ms; 8 frames >50ms; 148 UI commits |
| Founder desk, animated idle | 19.5 / 24.6 / 29.9 | Simulation p50 .8ms; main render submission p50 18ms |

Initial runtime ready 58.09s: geometry 11.58s, materials 8.35s, lighting 1.62s, texture upload 1.18s, main shader compile 32.41s. A later reload took 88.85s, so load results are variable, not a reliable cold-vs-warm win. The first mirror still compiled after Ready, causing a visible multi-second stall.

## Focused experiments
1. Mirror crop: project the visible pane, crop the reflected camera's X/Y frustum, and compensate texture UVs. Preserve existing texel density, MSAA and physical near-plane clipping; retain full image when crossing the near plane. Target-size hysteresis avoids per-pixel reallocations. No quality reduction.
2. Frozen rendering: allow 128 settling frames for temporal AA, then submit no scene/mirror frames until invalidated. Animated exploration, breathing, seated motion, cinematic playback and fades continue each frame. Camera/material/quality/visibility changes invalidate.
3. Lighting decode: two fetch/decode jobs maximum, unchanged Three EXR parser in module workers, transferred buffers, cancellation/termination on all outcomes. Material application order and sampler settings are unchanged.
4. Startup readiness: finish the initial mirror/main frame, then use one public asynchronous 1-pixel readback to wait for submitted GPU work before Ready. No per-frame readback. Broad offscreen and extra mirror shader compilation was tested and rejected: it extended one load to 141.36s without removing later new-view hitches. Original main shader preparation is retained.
5. Small allocation/UI fixes: native arrayBuffer for loads without progress callbacks; avoid React stats subscriptions outside debug; remove redundant full-scene matrix traversal from mirror visibility tests.
6. Diagnostics: opt-in bounded capture; no profiling observer or sample arrays outside profile mode. Production backend labels use capability flags.

## Accepted measurements

Same full-quality settings and viewport as baseline; no concurrent builds/tests during captures. These are local samples, not statistical guarantees. Intermediate tour p95 results were 27.5–28.7ms; final 25.3ms. Hardware/cache timing varies, and the existing 50ms simulation-delta cap means a heavily stalled 15s tour capture can cover slightly less tour distance.

| Scenario | Before | Final | Interpretation |
| --- | --- | --- | --- |
| Opening tour frame p50/p95/p99 |27.7/33.9/74.1ms|22.3/25.3/63.4ms|p95 improved 25% in final capture; repeat improvements 15–25%|
| Tour mirror CPU p50/p95 |10.0/12.8ms|6.6/7.5ms|~34% lower median mirror CPU work|
| Frozen reference rendered frames/15s |1,514|0|Lightweight animation-loop ticks remain for input/invalidation; these are not rendered FPS|
| Founder desk animated idle p50/p95/p99 |19.5/24.6/29.9ms|17.1/18.3/19.2ms|Final capture had 0 frames over 25ms; intermediate p95 was 22.9ms|
| Material/lightmap preparation |8.35s|4.56s|Earlier optimized run 2.98s; same decoded pixels and samplers|
| Tour renderer-tracked resources |2,582.35MiB|2,531.13MiB|~51MiB less in this view; not total VRAM or a whole-app leak measurement|
| Initial asset request bodies |669.07MiB/119 requests|669.07MiB/119 requests|Payload unchanged; cache-dependent transferred bytes are not a download-size optimization|

Final foreground evidence: accepted-load.json, accepted-tour.json, accepted-static.json, accepted-explore.json in the external evidence directory. Initial baseline equivalents are baseline-load.json, baseline-tour.json, baseline-static.json and baseline-explore.json. Rejected/earlier experimental results are retained there for traceability, not presented as the final implementation.

## Loading trade-off and remaining bottlenecks

- **Total loading is not solved.** Baseline Ready reported 58.09s (another reload 88.85s), then froze on initial reflection/driver work. Final Ready took 123.26s, including 53.41s of main shader preparation, 5.90s initial reflection submission and 36.69s waiting for the GPU's first submitted work. The completion check makes readiness truthful; it moves existing deferred work behind the loading screen rather than making that work cheaper. It is not valid to advertise an overall startup speedup.
- Tour first-use stutter remains: final 12 frames over 50ms, 8 long tasks totaling 504ms (max 90ms), versus baseline 8 frames over 50ms and 6 long tasks totaling 579ms (max 163ms). Typical frames improve, but the frequency of isolated hitches has not improved reliably. New reflected geometry/material variants and resizing the reflection target remain candidates for a separate targeted investigation.
- Full-detail architecture plus changing character shadows still submits about 14.08 million triangles/frame at the desk; some entrance views submit more. Shadow resolution, frame rate, scene detail, animation, and sampling quality were not reduced.
- Scene chunks are already Meshopt/KTX2 compressed. Meaningful first-download reduction needs separately reviewed spatial streaming, source geometry optimization, or deployment delivery work. No speculative quantization, LOD substitution, texture downscaling, or release caching headers were introduced.
- One cream-stone source image is requested twice by separate existing material/GLTF paths. Deduplication across those owners was deferred to avoid changing their UV/sampler/lifetime behavior for a small payload gain.
- React was not the main active-frame cost. Production no longer subscribes to debug-stat state updates. The visible tour progress UI retains its existing cadence and behavior; debug captures still count diagnostic commits.
- Workers add a small JavaScript module and at most two simultaneous decode jobs. Transferable buffers avoid copying input/output between threads. Workers, abort listeners and profiling timers/observers are explicitly released. No long-session heap leak audit, mobile/WAN test, GPU timestamp measurement, or total-VRAM claim is included.

## Fidelity and verification

- Shipped geometry, materials, lightmaps, textures and local Blender source are unchanged: 147 asset/Blender SHA-256 checks match the backup inventory. All 243 original-file hashes also still match the saved snapshot. Final evidence: integrity-final.json.
- Production build including asset verification and TypeScript passes. Targeted runtime/loading/projection tests pass. Final full regression suite: **82 passed, 0 failed** (119.63 seconds); final targeted suite: 13 passed. `tests-final.log` and `build-final.log` are in the evidence directory. The final one-pixel completion check also reached Ready in both WebGPU and WebGL with no console errors.
- Visually compared both mirror sides and the upstairs post-shadow reference in WebGPU and WebGL. Checked cinematic playback, third-person exploration, chair approach/sit/exit, side seated view, entrance step traversal, and pause/resume. No animation/controller/camera/physics edits.
- Cropped reflection preserves the original texel density and 4x MSAA; X/Y crop leaves the physical oblique depth plane intact. Tests cover forward/reversed depth on both APIs, pane coverage, near-plane fallback, byte-accurate downloads, bounded prefetch, identical EXR pixels/samplers and cancellation.
- Frozen rendering waits 128 samples (~0.95^128 <0.15% initial temporal history). Invalidations restore rendering for camera, material, quality, visibility, animation and interaction changes.

## Reproduce / rollback

Run `npm run build`, then `npm start -- --port 3001`. Open /?debug=1&profile=1, expand Performance capture, Lock full quality. Capture tour from its initial state; use QA surface | Post shadow and wait for draw calls 0 before the stationary capture. Test founder-desk movement reproduces the animated-idle view. Use &renderer=webgl for fallback QA. Do not benchmark while running tests/builds or another 3D tab.

The original D:/Motion Design MD FINAL remains untouched and is the rollback source. Only this backup contains the performance changes. No GitHub push or deployment was performed.
