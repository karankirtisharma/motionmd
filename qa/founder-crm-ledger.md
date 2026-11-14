# Founder CRM integration — 9 November 2026

## Scope and geometry

Active backup: `D:\Motion Design MD BACKUP 26-10-2026`. Original FINAL and Blender sources untouched.
Source: `D:\Claude\Ideation and Prototype\MD CRM\app\dist`; 70 files / 1,927,318 bytes, SHA-256 matched individually after copying. No rebuild, restyle, dependency installation or distribution modifications.

Measured mesh: `Box_Founder_polished_floor002_16`, material `FR79 | founder panoramic dashboard`. World face: 7.060002 × 3.258693 m, front normal approximately (-1, 0, 0). Native canvas: 1600 × 739, 0.01% aspect rounding error. Flat-panel repair replaces the original curved display face, closes its housing returns and adds the same 694-triangle surface to collision. Main-view native DOM and aperture share all four corners, without independently moving CSS slices. Reflections/loading use a black, non-emissive face.

## Lifecycle and input

One persistent same-origin iframe, lazy-created once. Camera updates only recompute projection when camera/viewport changes; no remount or content snapshots. Off-camera visibility hides the DOM and pauses attract. Seated focus releases pointer lock and reserves app keys/wheel. Stand up restores movement and starts attract via the documented API. The original chair choreography and scene DPR/quality policies are unchanged.

Browser testing found that inspection entry bypassed the normal setEnabled lifecycle. `enterExplore` and `exitExplore` now synchronize native display state explicitly. Regression coverage checks direct entry after disable. The supplied app idle timer can restart attract after md:tour false; a host-side attribute observer stops that restart and restores the user's route via md:navigate, without patching dist.

## Verification

- Production build and TypeScript passed.
- 21 targeted geometry/projection/aperture/controller tests passed after correcting an empty test collider fixture; all 18 studio computer routes remain covered.
- Browser: seated edge-to-edge fit, Clients dock, search with Aurelia, Escape without exiting chair, and Client pipeline title navigation verified using native clicks.
- Screen stayed registered through window resizing (1280×720 and 1655×1244), with no bars or old dashboard bleed observed.

## Final browser and performance results

Two sit cycles and a stand cycle completed. Standing has pointer-events:none; dragging across the CRM moves the room camera. Looking away makes the host visibility:hidden while retaining exactly one iframe. The standing attract tour visibly advanced through Review Theatre, AI Workflow and Workflow Run; sitting disables it. The ready CRM rendered on direct founder-desk inspection entry without the previous menu-toggle workaround.

Production build, WebGPU, 1655 x 1244, DPR 1, locked high quality, same seated camera, 15-second sequential captures:

| Capture | Rendered FPS | Frame ms p50 / p95 / p99 | Frames >50ms | Mean GPU draw ms |
| --- | ---: | --- | ---: | ---: |
| crm-visible | 95.7 | 10 / 13.7 / 18.6 | 0 | 3.73 |
| crm-hidden | 108.7 | 8.8 / 12 / 15.7 | 0 | 2.95 |
| crm-visible-repeat | 87.5 | 10.2 / 15.6 / 35.8 | 10 | 2.59 |
| crm-hidden-repeat | 111.4 | 8.7 / 11.1 / 14.5 | 1 | 3.00 |

All captures reported visible-tab cadence suitable for comparison, zero long tasks and zero new shader builds. Renderer allocation remained 2153.01 MiB in both states (does not include DOM/browser allocations). Native DOM visibility added approximately 1.2-1.5 ms to median frame interval; the requested within-a-few-FPS target was NOT established. Repeat captures included occasional >50ms intervals, with no coincident measured JS long tasks or shader builds; their cause is not established. Do not claim zero overhead or universally stutter-free behavior. No CRM internals or scene quality were altered to improve these numbers. Evidence JSON and screenshots are outside the repository in the Codex visualizations directory.

Limitations: supplied CRM is a local-data/demo application; integration does not add a server backend. Only the current Windows browser/GPU was measured, not other hardware. Loading/reflection fallback is intentionally black; native browser content is not rendered into reflection probes.


## 9 November 2026 � production access and lifecycle repair

Vercel MCP access verified. Production motionmd-6ipx was READY at GitHub main
329d9a7296f25971f582b2ab07052ebcb2c59978, and the CRM was visually present on that
deployment. The reported missing app was not reproduced in a fresh production tab.
The old dashboard/Earth image was absent. Added a regression check proving the
CRM aperture never samples that image during boot, hidden states or reflections.

Root cause repaired: the copied app's `tour=idle` timer ignores a host tour-stop
message and wakes after 40 seconds even while seated/off-camera. The old host
observer then navigated back, creating avoidable React updates and view transitions.
The embed now uses `tour=0` with a single host-owned, visibility-aware idle timer.
Initial visible standing waits 40 seconds; standing up resumes the tour immediately.
Sitting, hiding and disposal cancel it. Hidden CSS animations are paused by a
host lifecycle attribute; no user preference, route or CRM file is rewritten.
Projection CSS is updated only when changed and visible; input/state synchronization
runs on state edges instead of every camera update. One persistent iframe remains.

Production build/TypeScript passed. 17 focused tests passed, including all 18 computer
chair routes, display registration, no-old-texture fallback and lifecycle transitions.
All 70 copied CRM files (1,927,318 bytes) match source dist SHA-256 values exactly.

Single sequential 15-second captures, WebGPU, 1280x720, DPR 1, locked high quality,
same seated Command view, 130 draws / 2,921,796 triangles:
- Existing Vercel build: 140.2 FPS; p50/p95/p99 7.0/8.8/10.3 ms; zero >50 ms.
- Fixed local production build, CRM visible: 164.4 FPS; 6.1/6.4/9.7 ms; zero >50 ms.
- Fixed local production build, CRM hidden: 164.7 FPS; 6.1/6.2/6.4 ms; zero >50 ms.
All samples had suitable visible-tab cadence. These are short sequential captures,
not a universal improvement claim or a controlled cross-device benchmark. The visible
versus hidden difference was 0.3 FPS in this run. Earlier high-resolution captures
remain above for context. Browser/native app timers are not fully suspended by CSS;
this patch specifically eliminates tour wakeups and invisible CSS animation work.

Native screen-coordinate clicks opened Clients and search; typing Aurelia returned
results, and Escape closed search without standing up. Semantic automation inside
perspective-transformed iframes did not correctly target pointer coordinates, so
visible screen-coordinate clicks were used to verify actual native hit alignment.

## 2026-11-14 — recover a failed CRM boot

Reproduced a blank Founder display by aborting its entry JavaScript request. The
iframe completed loading but never sent md:ready, so the previous code remained
black indefinitely. The host now retries an unready document up to three times,
cancels recovery when ready/disposed, and warms the same single iframe when the
camera approaches upstairs. Working documents are never remounted on camera moves.
The supplied CRM build, panel geometry, aperture and projection remain unchanged.

Validation: seven focused readiness/lifecycle/panel tests passed; Next production
build and TypeScript passed. In the production browser, aborting the first module
request recovered on attempt 2 with the actual Command Centre visible in the room.
This establishes recovery for a transient boot failure; it does not prove which
network or browser condition produced the user's original screenshot.

## 2026-11-14 - presentation boot recovery

The presentation page now retries unsuccessful boots (maximum three loads),
retains the existing one-iframe warmup and off-screen suspension, and waits for
opening-view image decoding before reporting ready (bounded at four seconds).
Unchanged visibility, pointer ownership and tab-index values are no longer
rewritten on every sync. No screen geometry or projection changes.

Validation: 16 focused native screen/readiness/lifecycle tests and the production
build passed. In the actual production scene, aborting the initial Studio document
request recovered automatically on attempt 2, with one iframe and all six opening
images loaded. No matched FPS benchmark was performed for this patch; no numerical
performance improvement is claimed.


## 2026-11-14 - snapshot-first Founder and presentation displays

Both physical displays now load small captures of their actual applications before
world entry (Founder 1600x739, 127136 bytes; presentation 1600x558, 122956 bytes).
The opaque mesh retains that capture during exploration, initial iframe loading,
failed boots, and reflections. Only a ready, visible, engaged document opens the
main camera's depth aperture. The original GLB wallpaper is never used. Textures
use the fitted screen's existing top-origin UVs, with flipY disabled.

No CRM/Studio iframe starts during Details. Chair approach prepares the app;
seating/explicit screen use enables it. Each display retains its one iframe when
hidden, with input and animation suspension controlled by the existing lifecycle.
Founder waits for fonts and image decoding before revealing its document. The CRM
dist and Studio application files are unchanged.

Loading work yields between elapsed-time texture upload batches and two-object
measured reflection compile batches. Opening/reflection draw preparation submits
at most four new object/material combinations per turn through the real renderer
dispatch. It preserves scene visibility, the static shadow cache, resolution,
materials, geometry, and the final GPU completion fence. There is no per-batch GPU
pixel-read fence. An earlier experiment that changed scene visibility and rebuilt
shadows in every batch was rejected and is not included.

Validation: production build/TypeScript passed; 23 focused readiness, native input,
aperture, compile/cancellation and render-dispatch tests passed. Release-public
staging dry run passed. Browser: Chrome 157/WebGPU on an NVIDIA Lovelace adapter,
1440x900, DPR 1. Zero iframes before Enter. Both snapshots visually checked upright.
Founder seating opened Command Centre; real screen-coordinate clicks navigated to
Clients and opened search, and typing Aurelia produced results. Standing restored
the preview and left one hidden iframe. Presentation: deliberately aborting the
first document request left the preview visible, recovered on attempt 2 with one
iframe, and real screen-coordinate search/typing worked. Standing hid the document.
No page errors in the final startup/Founder run.

Performance limit: final local run reached usable-room readiness in 127.8 s and
still recorded an 11.6 s maximum long task. Shader preparation remains expensive;
this is not a claim of stall-free startup or a controlled FPS improvement. Earlier
baseline and experiments had different transfer/cache and concurrent-render-job
conditions and cannot establish a reliable percentage improvement. The concrete
screen optimization is removing both embedded app boots from Details and keeping
the screen populated throughout readiness/recovery.

Release scope: motionmd repo, codex/living-maquette branch, motionmd-6ipx Vercel
project only. motiondesign.ad and its publication repository are outside this change.

### Follow-up: retry entry scope and double-sided shader preparation

Live verification of 19a87c2 reached the Founder room and successfully clicked
Clients/search and typed Aurelia with one iframe. A texture request failed on the
first live load; the actual image endpoint returned a valid complete WebP, and
the site's Retry loaded the room. That exposed an existing adapter mismatch:
readiness used the retry subscription's new attempt, but entry still validated
against the old preference scope. Reattaching now binds both to the current
attempt. A regression using the real kit bridge failed before the correction and
passes afterwards, rejecting old-attempt entry and accepting the fresh attempt.

Buffered long-task attribution in that live retry located the remaining 6.67 s
task in the first reflection frame. r186 draws transmissive double-sided materials
with separate `backSide` and default pass identifiers. Preparation now tracks
object/material/pass, so neither side is deferred to the final unbounded draw.
The regression verifies both actual pass identifiers under the four-variant
budget. The final full render, shadow cache, geometry and material values remain
unchanged. Production build/TypeScript and 20 focused intro/rendering tests passed;
the existing screen/readiness/input tests had already passed. No overall FPS or
cross-device startup-time improvement is claimed.

## 2026-11-14 - remove the remaining Details compilation stall

A CPU sampling trace supersedes the earlier phase-timing inference: the large
task was synchronous node-graph compilation in the temporal beauty pass. TRAA
calls resetRendererState before rendering its resolve quad, which clears the
outer preparation callback. The nested scene consequently bypassed the budget.
Binding the callback at scenePass.updateBefore fixes that reset, but an isolated
experiment showed the final frame still compiled a second unprepared context.
The main scene runs at two nesting depths (TRAA resolve and output coverage).

Preparation now accounts for the dispatched clipping-context and lighting-node
identities as well as object, material and front/back pass. In pinned r186 each
render context owns a distinct clipping context. This uses the public dispatch
arguments rather than renderer-private call-depth fields. The temporary pass
callback restores in finally, including abort/failure. No visibility, material,
geometry, lighting, resolution, temporal quality or shadow-cache changes.

The earlier entry's statement that no per-batch readbacks remained was incorrect:
both reflection and temporal batch callbacks still awaited one. Those redundant
readbacks are now actually removed. Final GPU readiness fences remain; Enter is
still gated by completed world preparation. Added cost is transient preparation
maps only, with no extra downloads, resident textures or post-entry callbacks.

Chrome 157 / hardware WebGPU / NVIDIA Lovelace, 1440x900 DPR1, serial production
runs with a 1ms CPU sampling profiler: baseline maximum main-thread task 11998ms;
final context-aware candidate 843ms across startup. Candidate reflection and
visitor/opening-frame maxima were 306ms and 329ms. Baseline and candidate both
created 1157 node builds / 336 programs. Total readiness was 168.2s and 107.4s,
but the baseline had cold asset transfer, so these totals do not establish a
controlled download/startup speed improvement. CPU profiling itself adds cost.
The first, incomplete candidate (callback binding only) retained an 11663ms
final-frame stall; it was rejected before publication.

Validation: production build and TypeScript passed; 45 focused tests passed.
New regressions cover TRAA's callback reset, both context/lighting combinations,
bounded submissions, and abort/failure restoration. Existing readiness/retry,
native input/projection, snapshot ownership, front/back and shadow parity checks
also passed. Full-scene hardware validation here is WebGPU, not a new mobile or
WebGL performance qualification. Scope remains motionmd/codex/living-maquette
and the motionmd-6ipx preview domain only.


Without CPU sampling, an injected initial manifest failure recovered through
Retry and Enter without changing preferences. Runtime readiness was 105.2s;
longest startup task 814ms (lighting/probes), first-reflection maximum 276ms,
visitor/opening-frame maximum 298ms. The earlier roughly 6.4s continuous opening
stall was absent. This is still expensive startup work, not a claim that all
loading tasks fit a 16ms frame budget or that cold downloading is faster.

There were zero app iframes before Enter. Founder native pointer clicks opened
Clients and search, typing Aurelia returned results; standing retained one hidden
iframe and restored its snapshot. Presentation's snapshot was visible before
seating; seating activated one live Studio iframe. Both screens were visually
checked in the real scene; no page errors. The screen test's first lounge-chair
diagnostic waypoint was upstairs, so it was corrected to presentation-tv before
seating; no application change was needed for that test correction.

## 2026-11-14 - cooperative Details preparation (follow-up to 358aa9b)

The four-object batches removed the multi-second freeze but still synchronously
built whole TSL graphs, producing repeated 200-600ms tasks. The new r186 bridge
captures the actual direct submissions (including nested temporal, coverage,
reflection, transmission sides and shadow contexts). It runs the installed
NodeManager.getForRenderAsync/buildAsync stages serially, yielding to the browser,
and overlaps at most four driver pipeline compilations. Every pipeline joins
before a complete replay, and Enter still waits for the final real GPU fence.
There is no change to the intro assembly, scene assets, material look, DPR or
post-entry render path. No renderer source or dependency patch was made.

Important integration details: Lighting.finishRender restores a shared light
node's previous array, so each queued build retains and restores the actual pass
light list as well as target, MRT, context, effective material side and override
fields. Absent node-material fields must remain absent (undefined overrides can
change MeshBasicMaterial conversion). Viewport copies, TRAA and shadow updates
run only inside an active real draw, never during asynchronous compilation.
Incomplete discovery draws cannot validate a static shadow snapshot. A complete
static redraw follows before reuse. Temporary dispatch/material/light state
restores on cancellation, driver/build failure and success. The bridge checks
r186 and required methods; unsupported versions retain the prior bounded public
fallback. Revalidate this bridge before upgrading Three.

Production build/TypeScript and 55 focused tests passed. Tests cover actual
context/sides, serial graph building, bounded driver concurrency, GPU rejection,
transient light lists, absent material fields, partial shadow snapshots, Retry,
real readiness and native input. The publication checkout has no node_modules;
its changed source/test files are copied from the tested dependency-installed
working copy, and Vercel installs the locked dependencies for its build.

Chrome 157 / hardware WebGPU / NVIDIA Lovelace / 1440x900 DPR1, no CPU sampling:
previous release's recorded Details section had 189 long tasks, maximum 627ms,
16,483ms above the 50ms threshold; final candidate had 16, maximum 88ms, and 94ms
above that threshold. Details preparation elapsed 81.1s versus 73.8s. The final
run deliberately failed the initial manifest, recovered through Retry, and
reached real readiness with zero app iframes before Enter. Recorded total
readiness was 144.2s, including 65.1s of geometry/material loading. Another
18-worker Remotion render was running during candidate verification; transfer,
cache and contention differ, so these are observed traces, not a controlled
cross-device startup/FPS percentage claim. Earlier lighting/probe work still
has a separate 764ms maximum task outside this shader-preparation section.

During final Details, actual rotate/studies click handling ranged 1.4-23.6ms.
The sampled rAF p95 was 6.3ms, max 133.4ms; this is browser callback cadence,
not a claim of equivalent 3D FPS. Founder snapshot, Clients and native search
(Aurelia), standing back to snapshot, and presentation snapshot-to-live were
checked. A test helper briefly used a stale viewport after a second CDP client
disconnected; retesting at a stable 1440x900 mapped search to the visible field
and passed. The complete shadow-enabled candidate's fixed-pose GPU comparison
had zero differing components between stock and cached shadow rendering.

Release scope remains motionmd/codex/living-maquette and motionmd-6ipx only.
motiondesign.ad, its repository, DNS, CRM dist and source model assets are untouched.

Final compatibility review: r186 Pipelines.isReady checks a WebGPU pipeline handle; WebGL stores programGPU. The async bridge is explicitly WebGPU-only, and WebGL retains the prior bounded public preparation path. Added regression coverage; focused suite now has 56 passing tests.


## 2026-11-14 - reduce avoidable initial-loading waits

The async shader preparation previously joined a whole four-job GPU batch.
A slow member blocked reuse of the other completed slots. A rolling set now
reuses the first completed slot, keeps the same maximum of four driver jobs,
retains serial node-graph construction, and joins every job before the complete
draw/readiness fence. Rejections remain observed and reject readiness; temporary
renderer/material/light state still restores on every exit. WebGL retains the
existing public fallback, and the r186 bridge remains version guarded.

Declared external KTX2 textures previously waited for each GLB download/parse to
discover them. A 24 MiB encoded-byte read-ahead pool now overlaps up to two
required transfers with geometry work. It uses generated real file sizes,
versioned immutable URLs, and the existing retry/cancellation path; consumption
transfers buffer ownership once. Decode concurrency remains two workers. This
pool is additional to the existing 32 MiB EXR pool and bounded GLB staging;
resident scene textures are unchanged. Data Saver and external asset origins
disable speculative KTX transfers. Custom headers/credentials bypass anonymous
read-ahead. The already-superseded gallery albedo remains excluded, with demand
loading available. Cancellation before claim, abort after claim, synchronous
failure, measured progress and shared subscribers are covered by regressions.

No GLB, texture, CRM dist, geometry, lighting, resolution, temporal filtering,
intro timing or post-entry render path was changed. Production build/TypeScript
and 78 focused tests passed. At 1440x900 DPR1 in hardware WebGPU (Chrome157,
NVIDIA Lovelace), the combined candidate had 124 asset requests, 544.69 MiB
encoded data, 1170 node builds, 345 GPU programs and 2077 MiB tracked scene
resources: all equal to baseline. There were no extra texture requests.

Serial local production runs with HTTP cache cleared: baseline 94.1s, rolling
candidate 64.5s; repeating the warmed-driver baseline yielded 59.0s and rolling
65.7s. The combined candidate yielded 65.3s. Driver/CPU cache variation is large,
so these totals do NOT establish a controlled percentage improvement. The
read-ahead waterfall confirms textures begin before their GLB parse (some
studio textures at 3.8s instead of 10.5s); local transfers are too fast to infer
a network-wide saving. In the combined shader-preparation section there were
four tasks above 50ms, maximum 56ms and 11ms total above the threshold. The
earlier setup/probe stage still had an 805ms maximum; this work does not claim
every startup stage is inside a 16ms frame budget.

Real-scene checks: zero app iframes before Enter; founder snapshot visible;
seating activated exactly one CRM iframe; native Clients/search clicks and
typing Aurelia worked; standing retained its hidden iframe and snapshot.
Presentation snapshot and seated live Studio both displayed correctly. No page
errors. Fixed-pose stock/cached shadow comparison reported zero differing
components. Assets and scene quality are unchanged. Release is restricted to
motionmd/codex/living-maquette and motionmd-6ipx.vercel.app; motiondesign.ad and
its repository/DNS are untouched.
