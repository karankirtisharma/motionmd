# Production performance audit — 31 October 2026

Follow-up: this microstutter checkpoint was published as `bb23118`. The later stair-contact and studio-shadow repair supersedes its tread-contact limitation; see `stair-and-shadow-2026-10-31.md`. Measurements below describe this checkpoint and remain unchanged.

Status: the follow-up microstutter pass is implemented; **182 regression tests and the production build pass**. Exact static-shadow reuse reduces CPU render submission by 46.45% and 70.00% in two same-session fixed-pose WebGPU comparisons, with zero changed HDR pixels. These are rendering-cost measurements, not whole-site FPS gains. Earlier slower browser captures remain recorded below; foreground FPS and loading-time improvements are not claimed.

## Scope and preserved work

Active implementation: `D:\Motion Design MD BACKUP 26-10-2026`. The protected original `D:\Motion Design MD FINAL`, Blender sources, source GLBs, source textures and authored animation files were not rewritten. Changes are limited to runtime ownership, redundant loading/rendering, and restoration of the previous animation controller. No GitHub push was performed for this audit.

No mesh decimation, reduced texture resolution, reduced shadow resolution, lighting removal, feature removal or replacement rig was introduced. Existing Brotli delivery, image delivery, Meshopt assets, spatial partitioning and temporal antialiasing remain in use. Their pre-existing savings must not be presented as newly achieved in this audit.

Evidence and rollback files are outside the project:

`C:\Users\karan_z7alww2\.codex\visualizations\2026\10\17\01a14a42-20bc-7ca3-a5e8-1779e078f8e0\performance-2026-10-31`

The evidence folder contains `animation-before`, `loading-before`, `runtime-before`, `galleryMirror.before.ts`, the baseline captures, test/build logs, screenshots and benchmark outputs.

## Measured baseline

Evidence: `baseline-load.json`, `baseline-tour.json`, `baseline-stairs.json`. These are browser measurements, not estimates. Browser context: Chrome 156, Windows, WebGPU, visible tab, 1280×720 CSS viewport and drawing buffer, DPR 1. The two frame captures used High quality and resolution scale 1. GPU timestamp measurement was unavailable.

### Initial load

| Measurement | Baseline |
| --- | ---: |
| Runtime initialization to Ready | 71,917.4 ms |
| Navigation to Ready | 72,156.8 ms |
| Geometry and embedded textures | 9,537.6 ms |
| Material maps and lightmaps | 3,460.1 ms |
| Lighting and reflection probes | 1,014.4 ms |
| Spatial preparation and desert | 426.9 ms |
| Movement, collision and avatar setup | 606.0 ms |
| Texture upload | 738.4 ms |
| Shader compilation phase | 27,275.0 ms |
| First reflection frame | 3,266.6 ms |
| First GPU completion fence | 24,794.6 ms |
| Asset requests | 122 |
| Resource Timing encoded asset bodies | 627.17 MiB |
| Resource Timing transferred asset bytes | 615.07 MiB |
| Long tasks during load | 13; 10,957 ms total; 9,302 ms maximum |
| Renderer-tracked buffers/textures at Ready | 2,418.11 MiB |

The duplicate request list contains `/assets/source-walls/cream-stone-original.png` twice. Resource Timing bytes describe this observed session; they are not the repository size or a universal cold-download size. The GPU completion fence is a load-phase wait, not a per-frame GPU-time measurement.

### Active runtime captures

| Measurement | Tour, first 15 seconds | Exploration at spiral-stair end |
| --- | ---: | ---: |
| Capture duration | 15,002.8 ms | 15,010.1 ms |
| Rendered frames | 1,082 | 1,709 |
| Frame interval p50 / p95 / p99 | 12.9 / 15.0 / 21.4 ms | 8.6 / 10.6 / 11.5 ms |
| Simulation CPU p50 / p95 | 0.0 / 0.1 ms | 0.8 / 2.3 ms |
| Mirror CPU p50 / p95 | 3.8 / 4.3 ms | 0.0 / 0.1 ms |
| Main render submission CPU p50 / p95 | 8.6 / 10.0 ms | 7.5 / 8.5 ms |
| Frames over 25 / 50 ms | 9 / 7 | 0 / 0 |
| Long tasks | 2; 332 ms total | 0 |
| Draw calls at capture end | 226 | 440 |
| Triangles at capture end | 7,109,352 | 12,621,274 |
| Renderer-tracked buffers/textures | 2,435.81 MiB | 2,436.17 MiB |

The exploration capture is a fixed end-position runtime comparison, not a measurement of the entire stair route. CPU submission time is not GPU execution time. Renderer-tracked memory is not total VRAM.

## Implemented changes

### 1. Skip a gallery atlas that is always replaced before rendering

`replacedGalleryAlbedo.ts` registers a per-parse GLTFLoader plugin for the exact gallery chunk. It removes only the two base-color bindings subsequently replaced by the source wall/floor material reconstruction. No image, GLB or geometry is deleted or rewritten.

The omitted `/assets/v2/textures/gallery-architecture-base.ktx2` is exactly **13,660,809 bytes (13.03 MiB)**, 4096×4096, with 13 mip levels. This avoids one image request and one KTX2 decode. It is a targeted source-payload omission, not a claim that the entire site is now 13.03 MiB smaller on every CDN/cache configuration.

The guard declines the omission if chunk URL, image layout, material names, expected consumers or texture extensions differ. Normal, roughness/metallic, UV, geometry and other material properties are unchanged. `qa/replaced-gallery-albedo.test.mjs` parses the real gallery asset through both paths, executes the real material reconstruction, compares final material state, and verifies the request disappears. The static inventory, duplicate-image audit and conservative orphan-candidate analysis are saved as `asset-audit-static.json`, `asset-image-duplicates.json` and `asset-orphan-candidates.json`. Other retained assets were not deleted on speculative reference matching.

### 2. Correct cancelled KTX2 loader ownership

`SceneKTX2Loader.ts` wraps the pinned r186 loader without modifying the dependency. In the original lifecycle, disposal during asynchronous transcoder initialization could still create a live blob URL and dispatch workers afterward; active parse callbacks could also remain unsettled.

Scene abort now rejects pending parses once, prevents late initialization from dispatching work, disposes late textures, releases worker/blob/binary resources, and removes its abort listener. Successful textures remain owned by the scene. Disposal is idempotent and accounts for the base loader's initialization counter.

`qa/ktx2-lifecycle.test.mjs` reproduces the original late-init leak, verifies cleanup and no dispatch after abort, verifies pending parses settle once, checks late textures are disposed, and preserves successful/error behavior. This fixes a demonstrated cancellation/retry lifecycle leak; it does not claim that all possible browser or driver memory leaks have been eliminated.

### 3. Cache immutable architecture transforms

`staticTransforms.ts`, integrated after repairs and interactive extraction in `SceneRuntime.ts`, disables repeated local/world matrix computation for the fixed architecture only. Lift-role subtrees, skeletal nodes and authored-animation roots remain live. The interactive founder chair has already been reparented outside the immutable content tree. Restoration is provided for cleanup or future transform edits.

The actual-asset `qa/benchmark-static-transforms.mjs` decodes all production GLBs, applies the seven repair functions, creates the mirror, performs the existing spatial partition, and runs the real founder chair extraction. Of 403 architecture nodes, 358 are cached and 45 lift nodes remain live. Twenty actual chair-swivel/cabin/door/hydraulic poses have identical before/after world matrices.

Over 1,000 scene updates, local compositions fell from 402,000 to 45,000 and world matrix multiplications from 403,000 to 45,000. The recorded transform-only CPU time was 19.52 ms before and 5.43 ms after, approximately 0.014 ms saved per update. This is a small CPU-stage saving, **not an overall FPS result**. Evidence: `rendering-transform-benchmark.json`.

### 4. Reuse unchanged mirror frames during temporal settling

`reflectionFrameCache.ts` and `galleryMirror.ts` cache a reflection only when the scene revision, reflected camera matrices, crop and target dimensions match. The existing reflection quality, texel density, clipping and render target format remain intact. Callers without an explicit revision still render normally. Animated characters, lift movement, camera changes, diagnostics and scene transitions invalidate the cache through the runtime.

Cache tests simulate 128 stationary temporal-settle frames: one reflection render instead of 128. Animated or camera-moving sequences still require all 128 reflection renders. The integration test in `qa/runtime.test.mjs` executes the delivered runtime methods and verifies stable revisions during settling plus invalidation for character/cinematic animation, reference cameras, diagnostics, explicit shadow changes and scene transitions. This optimization mainly benefits unchanged reference/paused views; active breathing/movement still needs live reflections.

### 5. Restore the previous simple character animation

`RocketboxAvatar.ts` is restored byte-for-byte from the saved simple-locomotion checkpoint. The original character, skeleton and Idle/Walk/Run/Sit clips remain. The later per-tread foot IK, knee solving and terrain-contact queries are removed. Existing chair/desk palm, finger and seated foot IK, physical body/camera collisions, stair body support and stair speed cap remain unchanged.

The 22 targeted animation/controller tests preserve authored bone poses across flat/stair inputs and retain hand/finger contact checks. An actual-asset animation CPU microbenchmark uses the same 1,200-frame spiral trajectory, 180-frame warmup and six alternating before/restored runs. Median timed total fell from 1,455.01 ms to 128.36 ms, with terrain queries falling from 3,619 to zero. The approximately 91.2% reduction applies to that animation CPU fixture only.

**Remaining failure:** restoring the older motion does not give exact individual shoe/tread contact. The independent strict `node qa/stair-contact-audit.mjs` remains unchanged and still fails: the first measured spiral case has 20.81 cm worst intersection; real controller routes report 7.5–18.8 cm depending on direction and speed. Physical body support and continuous progress pass, but visible source foot trajectories can intersect a riser. The removed IK's 5 mm contact contract is not claimed. See `qa/animation-recovery-2026-10-31.md`, `animation-exact-tread-audit.txt` and `animation-cpu-benchmark.json`.

### 6. Bound loading-progress React publication

`loadingProgressPublisher.ts` coalesces repeated same-phase progress into at most one publication per 100 ms while retaining the latest exact detail/fraction. Phase changes and Ready remain immediate. Completion flushes the final value; error, retry and unmount cancel pending callbacks. Download, decode and compilation work is not delayed by the publisher.

`qa/loading-progress.test.mjs` feeds 1,000 progress callbacks over one second and observes 11 UI publications. It also checks synchronous shader bursts, phase switches, terminal delivery, disposal and independent retries. This removes demonstrated unnecessary loading UI updates; the fixture's 98.9% publication reduction is not a whole-site speed claim.

## Evaluated and not retained

A shared room-environment TSL graph cache reduced duplicate program identities in an isolated test, but matched stair samples during that experiment were slower. The cache was conservatively reverted: `lighting.ts` and `probes.ts` use their prior implementations, and its test/source evidence is archived outside the project in `environment-cache-rejected`. The slower observations persisted after the revert, so this does **not** establish graph sharing as the cause. It is not part of the retained release.

## Verification recorded so far

- `tests-release.txt`: 149 tests passed, zero failed in the normal suite. This does not include or override the separate failing strict stair-contact audit described above.
- `build-release.txt`: Next.js production build and TypeScript stage passed.
- Production prebuild verified 150 retained asset files and 11 source geometry chunks. Existing delivery preparation reports 479.6 MB source to 460.4 MB exact payload to 264.3 MB Brotli / 296.1 MB gzip for its covered delivery set. These decimal-MB pipeline figures are not the complete browser-session download and are not new savings from this audit.
- Renderer tests preserve geometry attributes, exact transforms, live dynamic objects, reflection projection and invalidation behavior.
- No dependency additions and no source Blender edits were needed.

## Earlier release browser comparison (before the shadow-cache follow-up)

Evidence: `release-load.json`, `release-tour.json`, `release-stairs.json`. Actual drawing buffer and CSS viewport are 1280×720, DPR 1, visible WebGPU tab; active captures use High quality and scale 1. These are observed results, including regressions, not an overall improvement claim.

| Measurement | Baseline | Conservative release |
| --- | ---: | ---: |
| Runtime to Ready | 71,917.4 ms | 125,757.9 ms |
| Asset requests | 122 | 121 |
| Encoded asset bodies | 627.17 MiB | 614.15 MiB |
| Transferred asset bytes | 615.07 MiB | 612.47 MiB |
| Tour frame interval p50 / p95 | 12.9 / 15.0 ms | 23.7 / 26.4 ms |
| Tour render submission CPU p50 / p95 | 8.6 / 10.0 ms | 16.0 / 18.0 ms |
| Stair-end frame interval p50 / p95 | 8.6 / 10.6 ms | 15.8 / 17.6 ms |
| Stair-end render submission CPU p50 / p95 | 7.5 / 8.5 ms | 14.5 / 15.9 ms |
| Stair-end simulation CPU p50 / p95 | 0.8 / 2.3 ms | 1.0 / 1.6 ms |

The targeted omitted request and encoded-body reduction are confirmed in the release browser sample. Transfer totals also depend on cache/delivery conditions and must not be confused with encoded bodies or repository bytes. Renderer-tracked memory at Ready is unchanged at 2,418.11 MiB. The release retains original environment graphs.

These frame and load samples do not establish a controlled causal attribution to code: observed GPU state changed from P3/1440 MHz to P5/915 MHz, and even the frozen zero-draw animation callback rate changed from approximately 165 Hz to 66 Hz. The uncached release startup was 125.758 seconds and the earlier graph-cached startup was 114.738 seconds; the graph revert did not remove the observed slowdown. Tour endpoints also differ because elapsed deltas are capped after stalls (baseline progress 0.15046 versus release 0.13960), changing end-frame visibility. Report the raw slower observations; do not normalize them into an unsupported gain or assign all slowdown to the GPU.

The initial after-load sample used a different startup viewport and remains saved as `after-load-unmatched-viewport.json`; it is excluded from loading-gain claims. Multi-device, throttled-network and independent GPU-time checks have not established production-wide performance. The subsequent same-session shadow-cache comparison below isolates rendering cost without relying on the inactive tab callback rate. Foreground cross-device frame pacing remains unverified.

At this intermediate checkpoint the full active-character shadow refresh over the architectural scene was still a substantial cost. The follow-up below addresses that cost after an exact pixel comparison. Source texture/probe memory, complete-scene readiness and shader compilation remain major costs; no lossy geometry/texture changes were applied.


## Microstutter follow-up: measured root cause and fixes

### 7. Reuse immutable sun-shadow depth, keep moving shadows live

Every moving-avatar frame was submitting the complete architectural caster set again. In both measured views this represented **309 draw calls and 10,125,654 triangles per shadow refresh**, even though those architectural objects did not move.

`staticSunShadowCache.ts` subclasses the pinned Three.js public custom-shadow hook. It caches the original full-resolution color and depth attachments of immutable architecture, copies both matching attachments into the normal shadow map, then renders the character, swivel chair and lift with the stock shadow shaders against that depth. A fresh copy on every update prevents departing characters or chair parts leaving old silhouettes. PCF, map resolution, bias, textures, source geometry and lighting remain unchanged.

The existing frozen-transform membership supplies the immutable set. Dynamic roots are excluded. Camera matrices, layers, shadow-map formats/sizes and scene identity invalidate the cache; runtime material diagnostics and shadow quality changes explicitly invalidate it. The optimization is gated to the supported WebGPU directional PCF path. WebGL and unsupported formats/settings retain the full stock pass. A synchronous failure also falls back to the full pass. This is not a promise to recover every asynchronous GPU-driver error.

**Trade-off:** the additional 4096 x 4096 RGBA8/depth snapshot costs approximately 128 MiB of renderer-tracked texture storage at High quality. Depth storage is implementation-dependent; this is not a total-VRAM measurement. The cache can be disabled with `?shadowCache=0` or the debug full-shadow button. Lower quality uses its existing smaller shadow size; quality is not lowered to obtain the measurements.

### 8. Avoid redundant drawing-buffer resets

`resizeDrawingBuffer.ts` checks actual CSS size and pixel ratio before calling `setDrawingBufferSize` once. Previously an unchanged resize could still reset the canvas, while simultaneous size/DPR changes caused two resets. Camera projection and temporal history are invalidated only for real changes; shadow-quality changes still invalidate their independent cache.

Tests using the pinned renderer's real canvas target show **100 unchanged resize calls: 100 canvas resets / 200 dimension writes before, zero after**. A combined size/DPR change now resets once instead of twice, with identical final dimensions. This removes a concrete source of allocation/history churn; it does not imply a constant per-frame saving when no resize occurs.

### 9. Reject sparse timing windows for adaptive quality

The background browser repeatedly delivered roughly one callback per second while reporting document visibility as visible. Using those windows as normal rendering evidence would trigger needless quality changes. `adaptiveWindow.ts` rejects sparse/gap-dominated windows and resets quality hysteresis for them. Ordinary sustained lower frame rates and isolated modest hitches retain the existing adaptation policy. This neither changes the browser scheduling nor masks low FPS in the profiler.

### 10. Diagnose shader builds and callback gaps without guessing

The opt-in profiler now records shader-node build starts, current program counts, coincident spikes and sparse callback windows. It chains and restores the renderer's existing debug hook. Pipeline-creation counts/GPU timestamps remain unavailable rather than being inferred from CPU timers. These diagnostics are not a visual-quality change.

## Exact WebGPU fidelity and rendering-cost verification

`shadowCacheAudit.ts` is a debug-only, dynamically imported audit. It suspends scene/input updates, renders both shadow paths into the **existing scene-pass HDR target and MRT**, reads full RGBA16F images, decodes half floats, accounts for padded rows and compares them before temporal resolve. Every tested image contains 2,009,248 nonzero RGB pixels, ruling out a blank-target comparison. The stock public shadow-update hook is explicitly invoked each draw so Three.js same-frame update deduplication cannot skip shadow work in a synchronous test.

The first temporary-target experiment was rejected because glass used an incompatible framebuffer format. It is preserved as `shadow-audit-temporary-target-rejected.json` and is not included in the results. The corrected existing-MRT captures produced no browser GPU errors.

Both comparisons below use the same session, fixed pose, WebGPU renderer, High quality, scale 1, DPR 1 and 1697 x 1184 drawing buffer. Four batches alternate stock/cached/cached/stock, 16 renders each. CPU totals aggregate 32 renders per path. Each batch also ends with a one-pixel completion readback. These completion times include GPU waiting, readback and scheduling; they are not GPU timestamps or display FPS.

| Measurement | Lounge: stock | Lounge: cached | Walking pose: stock | Walking pose: cached |
| --- | ---: | ---: | ---: | ---: |
| Draw calls per measured render | 594 | 285 | 434 | 125 |
| Triangles per measured render | 17,641,514 | 7,515,860 | 14,314,344 | 4,188,690 |
| CPU submission total / 32 renders | 593.5 ms | 317.8 ms | 433.7 ms | 130.1 ms |
| CPU submission reduction | — | **46.45%** | — | **70.00%** |
| Triangle submission reduction | — | **57.40%** | — | **70.74%** |
| Maximum HDR component difference | — | **0** | — | **0** |
| Changed pixels | — | **0** | — | **0** |

Evidence: `shadow-audit-lounge.json`, `shadow-audit-walking.json`. The lounge camera is `PL78 | Screen and seating`; the walking pose is the restored character advanced five 0.1-second inspection steps on the prepared spiral route. The first cached batch includes its static rebuild. The main rendering pipeline, including geometry/materials, remains the same for both paths. This measures the shadow optimization in those views, not a claim that navigation, startup or every device is 46–70% faster.

Batch completion with readback, in stock/cached/cached/stock order:

- Lounge: 307.9 / 170.4 / 163.3 / 303.1 ms per 16 renders.
- Walking pose: 217.7 / 76.1 / 62.5 / 224.0 ms per 16 renders.

Visual evidence includes `stutter-final-webgpu-lounge.png` (final normal WebGPU preview), `shadow-cache-mirror-preview.png` (live mirror/lighting), `stutter-final-walking.png` (side torso/face, cropped by camera obstruction; not proof of foot contact), `release-walk-side.png`, and `release-stairs-side.png`. Original anatomy is retained, but the separate tread-contact limitation above remains.

## Compatibility and final verification

- `tests-stutter-final.txt`: **182 tests passed, 0 failed**. The separate strict stair-contact audit still fails as documented; it is not counted as a pass.
- `build-stutter-final.txt`: production compilation and TypeScript passed.
- Actual WebGL 2 fallback loaded, entered exploration and rendered the lounge without browser errors. Its cache diagnostics show `unsupported renderer or shadow target`, zero static/dynamic cache passes and stock rendering. See `stutter-webgl-load.json`, `stutter-final-webgl-lounge.png`. This verifies fallback operation on this machine, not a second physical GPU.
- No new dependencies, source geometry edits, texture-resolution cuts, animation-asset replacements or pushes were introduced.
- The final production preview serves the active BACKUP on port 3001; the protected FINAL copy is unchanged.

## Remaining costs and limits

The final WebGPU startup (`stutter-final-load.json`) was 110,911.3 ms at 1697 x 1184, including 56,034.8 ms in shader compilation, 6,142.0 ms first reflection and 32,550.4 ms first GPU fence. It requested 121 assets with 614.15 MiB encoded bodies. Viewport and device/scheduling state differ from the initial baseline, so this is **not a verified loading-time improvement**. Tracked memory at Ready was 2,572.33 MiB; it includes the new cache and the different viewport. The WebGL fallback startup was 144,130.2 ms, dominated by 108,383.7 ms compilation, also not a controlled performance comparison.

The user requested background work. Browser callback windows near 1 Hz are explicitly excluded from foreground-FPS claims; no attempt was made to take over the desktop or require the preview to stay visible. The render-cost audit isolates useful work without depending on callback cadence. Real foreground frame-time percentiles, slower networks, low-memory GPUs and independent mobile hardware still need representative device testing.

The complete scene, reflection probes and many material variants are prepared before Ready to preserve tour/mirror completeness. Startup compilation, main/mirror geometry volume and texture/probe memory remain substantial bottlenecks. This pass does not claim all stutters are eliminated or that all devices are launch-validated. Exact foot-to-tread contact remains unresolved after the user-requested older-animation restoration.
