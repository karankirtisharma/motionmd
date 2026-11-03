# Integrated performance, loading and live TV verification — 3 November 2026

Working copy: `D:\Motion Design MD BACKUP 26-10-2026`. The original FINAL workspace, Blender sources, character rig/clips, source geometry and source image files were not edited. The initial checkpoint was pushed to GitHub as e646989. The curved-TV follow-up is recorded separately in qa/curved-tv-2026-11-03.md; the current publication commit is reported in chat. Local production preview: http://127.0.0.1:3001/.

## Implemented causes and fixes

1. First-use reflection shaders caused long frames during the opening tour. Prepare exactly 21 observed object/material pairs in the real mirror camera/half-float 4x MSAA/no-MRT context before entry. Preparing them in the main pass did not help and was rejected. This shifts measured work into loading; it does not reduce resolution, reflection updates, lights, shadows, triangles or material quality.
2. Tour progress reconciled the full React page about ten times per second. Isolated timeline/diagnostic subscribers preserve the same update cadence while removing parent-page renders. Mirror camera scratch storage now avoids per-frame allocations, with bit-identical matrix tests.
3. Terminal load errors retained partially initialized resources; rapid retries could overlap GPU runtimes. Teardown is now idempotent, waits for in-flight initialization and serializes replacement. Hidden/covered 3D unregisters its animation loop and resumes with a fresh clock.
4. Transient or stalled downloads previously failed immediately. Model, explicit image, EXR, metadata and KTX2 transfers now retry recoverable transport failures up to three times, with cancellation, bounded backoff and a 45-second *idle* watchdog. Progressing slow transfers have no total deadline. Decode errors/permanent HTTP errors are not repeatedly retried. KTX2 shares identical in-flight requests and decode work; canceled scenes dispose late results.
5. Older Meshopt attribute encoding inflated delivery. Lossless v1 encoding preserves every decoded attribute byte, existing filters, all indices and RGBA image pixels. Runtime local URLs carry a revision hash. Mutable/stale URLs revalidate; current content-addressed URLs are immutable, including Next rewrite re-entry.
6. TV visibility rejected the entire screen when a corner crossed a camera depth plane. Homogeneous projection now clips the visible polygon correctly, including WebGPU/WebGL and reversed depth. Occlusion probes use actual screen geometry. One retained live iframe remains interactive; retry timers/listeners reset, pointer checks are bounded, and controls stay within the TV with larger targets.
7. Requested appearance update: standalone Studio, expanded Studio and live TV now show wood to the bottom. A top-aligned crop of the existing plate removes the bottom marble and horizontal gold strip. Card/button gold borders, layout anchors, original media and the physical lounge materials are retained. No extra image download was added.

## Measurements

Hardware-accelerated headless Chrome 156 on the available Windows machine, WebGPU, 1280×720, DPR1, full quality, 15-second opening tour. No desktop keyboard/mouse automation. Background user workloads and driver caches were not controlled; these measurements do not establish a universal FPS or loading-time percentage.

| Capture | Parent UI commits | New shader nodes during tour | Frames >50 ms | p50 / p95 / p99 ms |
| --- | ---: | ---: | ---: | --- |
| Original baseline | 152 | 16 | 7 | 11.2 / 13.3 / 20.3 |
| Same-build reflection warmup OFF | 9 | 15 | 9 | 19.5 / 22.7 / 63.3 |
| Same-build measured warmup ON (16 pairs) | 8 | 3 | 1 | 18.7 / 22.1 / 25.4 |
| Final 21-pair build | 8 | 0 | 0 | 11.8 / 20.8 / 23.9 |

The final capture had zero long tasks and four intervals >25 ms. Initial and final average FPS were roughly 83 and 82 respectively; **no sustained-FPS increase is claimed**. The verified improvement is removal of observed first-use compilation hitches and redundant parent rendering. Ready time observed 92.6 s initially and 59.0 s finally, but intermediate runs ranged 55–87 s, so no causal loading percentage is claimed. The final reflection preparation is intentionally included before Ready.

| Model/character transport only | Before | After |
| --- | ---: | ---: |
| Decoded GLB payload | 460.40 MB | 399.58 MB (-13.21%) |
| Brotli bytes | 264.29 MB | 257.96 MB (-2.39%) |
| gzip bytes | 296.11 MB | 286.06 MB (-3.39%) |

Actual fresh full-3D scene asset transfer (models **plus** textures/probes) was 614.18 → 608.15 MiB. The previously quoted ~250 MB describes the model delivery, not the entire 3D session. Renderer-tracked memory remains approximately 2,556 MiB; compressed download savings do not reduce decoded GPU residency.

## Validation

- Full regression suite: 260 passed. Final bounded warmup follow-ups: four tests plus TypeScript passed. Production build passed after the final pair additions.
- 1,075 Meshopt streams / 740,823,880 decoded attribute bytes verified exactly. All 12 source/delivery pairs preserve original source hashes, glTF structures and decoded image pixels.
- Actual production HTTP checks passed for all 12 assets: br/gzip/identity hashes, MIME/encoding/Vary/lengths, HEAD, ETag304, ranges, revision caching, mutable rewrite revalidation and encoding negotiation.
- In the actual browser, a simulated manifest503 and a KTX2 texture503 each recovered on attempt2 and reached Ready. No application JavaScript errors. The deliberate503 console entries are expected test faults.
- Native pointer click selected Vanta in the projected TV. Search dialog, fullscreen expansion and return worked. One iframe and selected film survived the transition. All measured TV controls stayed inside the iframe.
- Screenshots inspected at 1440×900, 1280×900, 1024×768, TV1600×558 and Android390×844. Wood-only backdrop confirmed in both Studio and the 3D TV. Android redirected to direct Studio with zero 3D asset requests.
- Forced WebGL fallback rendered the live TV, expanded and returned successfully with zero application JavaScript errors. Screenshot inspected: `final-webgl-tv.png`; report: `final-webgl.json`. This is fallback compatibility, not a low-end GPU benchmark.
- Near/eye/far clipping, behind-camera rejection, partial screen visibility, depth-tested occlusion, same-origin messaging, disposal and 512 mirror-camera parity poses covered by automated tests.

Evidence is in `C:\Users\karan_z7alww2\.codex\visualizations\2026\10\17\01a14a42-20bc-7ca3-a5e8-1779e078f8e0`: baseline-performance.json, mirror-off-performance.json, mirror-on-performance.json, final-21-performance.json, final-verification.json, final-tv.png, final-expanded.png and final-android.png. See the delivery, loading-reliability and runtime-pacing QA ledgers for detailed ownership and rollback checkpoints.

## Limits and remaining bottlenecks

The full lounge is still a large ~608 MiB initial transfer and ~2.5 GiB tracked GPU allocation. GPU preparation and high-detail reflection/render submissions remain significant. This pass does not claim every navigation path is hitch-free or that low-memory hardware can run full quality. Physical low-end Android/iOS hardware and real mobile networks were not available; viewport/Android-routing checks are emulation. Future room streaming/texture residency changes require a separate visual/collision/reflection parity pass rather than silently removing required assets. Basis decoder initialization keeps the pinned Three loader; retries restart failed files rather than range-resuming. The initial checkpoint used a planar DOM projection. That limitation is superseded by the measured curved-TV follow-up in qa/curved-tv-2026-11-03.md.
