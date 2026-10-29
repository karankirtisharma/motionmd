# Performance and stair-contact audit — 30 October 2026

Working copy: `D:\Motion Design MD BACKUP 26-10-2026`. The FINAL safety snapshot, Blender source and original GLBs are unchanged by this audit. The user authorized publishing the verified runtime and delivery changes after the final stair simplification.

## Implemented

- Embedded large 8-bit PNG images become **lossless WebP only when every decoded RGBA byte matches**. Twenty images passed; images with changed transparent RGB, shared buffer views or unsupported metadata remain original. `EXT_texture_webp` is declared required. Three's shipped loader supports it. No mesh decimation, texture resizing, changed lighting or reduced shader quality.
- Existing byte-exact GLB storage compaction is retained. Every referenced geometry/animation buffer is checked against the source. The character now uses the same negotiated identity/Brotli/gzip delivery as the eleven architectural chunks.
- Brotli preparation uses quality 9. This increases offline build preparation cost; no request-time compression is introduced. Cached variants are decompressed and hash-verified before reuse.
- Delivery pruning is explicit (`MD_PRUNE_DELIVERY=1`) and must run with the preview/deployment stopped. Preparing a new build no longer deletes files referenced by the old running build.
- Five temporary HDR source textures are disposed immediately after PMREM filtering when they are not used as a background. Filtered reflections remain owned and unchanged; failure paths also dispose the source. Background textures remain alive until their owner is disposed.
- Upward render-root smoothing no longer sinks the visual body below physical stair support. Camera height remains separately damped; downward settling remains bounded.
- The original Rocketbox Idle/Walk/Run/Sit clips and rig remain intact. At authored stairs only, measured shoe vertices receive a bounded **vertical** clearance correction in a stable anatomical forward knee plane. Horizontal stride positions, foot world orientation, bone translations/lengths and the entire upper-body pose are preserved. No gait replacement, new root motion, lateral foot planning or chair changes. The source pose is restored before each solve so corrections cannot accumulate.

## Measurements

Decimal MB below; MiB is used only where explicitly labeled. Model delivery totals include eleven scene GLBs plus the character, **not** external textures, lighting maps, JavaScript or the whole website.

| Metric | Before | After |
|---|---:|---:|
| Decoded model payload | 475,134,908 bytes | 460,404,032 bytes |
| Model wire payload, Brotli plus formerly uncompressed character | 288,622,392 bytes | 264,289,037 bytes |
| Character decoded payload | 21,088,756 bytes | 14,500,268 bytes |
| Character Brotli payload | — | 13,930,807 bytes |
| Renderer-tracked resources at Ready | 2,524.76 MiB | 2,444.76 MiB |
| Observed all-asset encoded bytes in browser | 653.21 MiB | 627.17 MiB |
| Observed Ready time, same desktop/browser | 173.27 s | 121.90 s (final reload) |
| 15-second spiral route frame p50 / p95 | 27.1 / 35.0 ms | 8.6 / 15.3 ms (final batched clearance build) |
| Route frames over 25 ms | 311 / 571 | 0 / 1,586 (final batched clearance build) |

The model wire reduction is **24,333,355 bytes (8.43%)**. The 80 MiB tracked allocation reduction matches the five 2048×1024 RGBA-half source textures exactly. Pixel and geometry preservation are deterministic checks, not inferred from these timing numbers.

Timing caveat: these are observed local runs, **not a controlled hardware benchmark**. Driver/browser caches and other local work differed; do not attribute the entire Ready-time or FPS difference to these edits. CPU submission timings are not GPU timings. Tracked resources are not total VRAM. The browser was WebGPU, high quality at 100%, 1627×1244, DPR 1, on the user's existing desktop. No second physical GPU or phone was available.

## Stair evidence and limits

Before the clearance correction, the same source shoe skin penetrated visible treads by up to 20.94 cm on sampled spiral routes, 19.71 cm on rounded stairs and 16.50 cm on entrance steps. The collision capsule followed a continuous ramp while visible geometry had discrete treads. Height smoothing added another possible 7.5 cm of upward visual lag.

`node qa/stair-contact-audit.mjs` samples 181 positions × three stair types × two directions × two speeds against the actual shipped visible surfaces. It evaluates all 361 shoe-weighted vertices after skinning and requires penetration below 3 mm. The final sampled result is zero penetration. `qa/stair-controller.test.mjs` separately drives the actual controller through the same stair types and checks collision-driven progress plus visible shoes.

The correction is not full motion-captured stair locomotion or permanent planted-foot locking. It retains the simpler source gait the user requested. Very unusual sideways paths, running reversals at a riser, unsupported ledges and every possible camera angle are not exhaustively certified. Do not describe this as a completely rebuilt rig or universal zero-clipping guarantee.

## Remaining bottlenecks / rejected approaches

- Whole-scene startup is still large: the latest measured load spent 57.86 s compiling shaders, 6.43 s preparing the first reflection and 34.44 s waiting for initial GPU completion. All rooms are prepared before Ready because the continuous tour, reflections and collision system depend on them. This pass does not introduce room-on-demand streaming.
- Dense views submit roughly 12–19 million triangles. Dynamic shadows and scene submission dominate live motion. No geometry or shadow fidelity was lowered to inflate FPS.
- Most large texture/lightmap assets already use KTX2 and geometry already uses Meshopt. Re-encoding the five largest Meshopt streams saved zero bytes; additional Brotli on tested KTX2/EXR files was larger, so neither experiment shipped.
- One cream-stone image still has two observed loads owned by separate material/GLTF paths. Blindly sharing mutable texture instances could change transforms and disposal ownership; this was not altered without a safe ownership redesign.
- Generated identity/Brotli/gzip variants increase build/deployment disk usage. Original source masters remain retained. They do not all download to a visitor.
- Small responsive viewports and fallback rendering must be assessed separately from physical mobile hardware. No unverified claims of phone performance or slow-network full-page readiness are made.

## Reproduction

1. From the backup: `npm test`, `node qa/stair-contact-audit.mjs`, `node qa/verify-image-delivery.mjs`, `npm run build`.
2. Start `npm start -- --port 3001`. `node qa/verify-delivery-http.mjs` checks Brotli/gzip/identity hashes, quality negotiation, HEAD, 304 and range responses.
3. Open `/?debug=1&profile=1`, expand Performance capture, Lock full quality. Use a fixed reference camera or prepare/play a stair route, then Capture 15 seconds. Avoid builds/tests during captures.
4. WebGL fallback uses `&renderer=webgl`. Compare the same camera, viewport and quality. Preserve cached/uncached distinctions.
5. Optional pruning: stop the server, set `MD_PRUNE_DELIVERY=1`, run `npm run prepare:delivery`, unset it, rebuild and restart. Never prune a live deployment's previously referenced variants.
6. `MD_GEOMETRY_STORAGE=0` disables the lossless GLB image/storage transformations for a comparison build. Original source assets are never overwritten.

Raw screenshots, HTTP results, before/after profiles and logs are stored outside the website at `C:\Users\karan_z7alww2\.codex\visualizations\2026\10\17\01a14a42-20bc-7ca3-a5e8-1779e078f8e0\performance-2026-10-30`.

## Additional verification

- Full regression suite: **132 passed, 0 failed**. The actual-controller checks reported zero sampled shoe penetration on spiral, rounded and entrance stairs in both directions, walking and sprinting. Production build and TypeScript passed.
- A first per-vertex terrain-query implementation was rejected after its browser capture showed 7.6 ms median / 23.6 ms p95 simulation CPU time. Batching the same calculations per shoe reduced the offline spiral query work from 56,246–65,321 calls per 181-frame route to 362. Measured query time dropped from 1.33–2.55 seconds per route to 0.11–0.20 seconds. A dedicated equivalence test checks the batched result against individual surface queries; all shoe vertices are retained.
- Local HTTP character transfer under client rate caps: 13,930,807 Brotli bytes completed in **11.152 seconds at 10 Mbps**, and **2.244 seconds at 50 Mbps**, both HTTP 200. These are isolated asset-transfer checks with no real network latency, packet loss or browser decoding; they are not full-site loading estimates.
- Final pixel/geometry verifier passed all twelve delivered model entries. Twenty images decoded byte-for-byte identically. HTTP negotiation verification covers all twelve entries and all available encodings.

The final 15.024-second full-quality WebGPU capture recorded 1,586 frames, frame p50/p95/p99 8.6/15.3/16.0 ms, simulation CPU p50/p95 1.0/2.3 ms, zero frames over 25 ms, nine UI commits and no hidden interval or long tasks. The room/camera content changed during traversal; this is an observed route capture, not a guaranteed minimum FPS. Earlier intermediate captures are retained in evidence rather than discarded.

## Added landing glass and fallback checks

The upper rounded-stair landing was missing a 2.4 m visible guard pane, even though its handrail and original collision mesh existed. The runtime now restores the exact closed source pane from the shipping collision coordinates and uses the adjacent 12 mm low-iron glass material. The adjoining sloped pane, rail and collision stay unchanged. This adds one mesh and twelve triangles. Regression tests compare the geometry to the independent source collider, check two-sided ray intersections, planar normals, thickness and idempotence.

A desktop browser resized to 390 x 844 successfully loaded the normal WebGL fallback, entered exploration and opened the complete responsive menu. No console errors were captured. This verifies a small viewport and alternate renderer, not physical-phone performance. The temporary second tab was closed and the viewport override reset before the final scene review.

## Final stair simplification after visual feedback

The shoe-clearance test alone missed an anatomical failure: when the ankle target rose, using the old animated knee position as the pole could place that pole behind the new hip-to-ankle axis. A 180-frame, 16 cm target reproduction found twelve backwards-knee samples in the walking cycle; the stable forward-plane pole produces zero. The final 480-frame regression also checks separate knee lanes and bounded flexion through turning and both walking speeds. Foot world direction, horizontal stride positions and all bone lengths remain unchanged.

Stair speed now uses the original normal walk (1.38 m/s), with Shift requesting a brisk walk (1.65 m/s). A 45 cm look-ahead and 0.3-second release prevent rapid walk/run switching between neighboring treads. Flat-ground sprinting is unchanged. All twelve actual-controller stair routes still complete and report zero sampled shoe penetration. The final spiral takes 8.92/6.40 seconds walking up/down, or 7.32/5.43 seconds with Shift; the longer traversal is intentional.

The earlier frame-time capture above predates this final speed change. It documents the batched-query optimization, not a directly comparable FPS benchmark for the final slower traversal. The 24.33 MB delivery and 80 MiB allocation measurements remain applicable.

Final browser review used the rebuilt WebGPU preview: spiral ascent in third person, brisk descent from the front, rounded-step ascent from the side, and route completion back to idle. The sampled corrected poses did not show the reproduced backwards knee flip. Both sides of the restored landing glass were inspected. Browser console error capture was empty. Evidence includes simple-stair-descent-final.png, simple-rounded-side-final.png and restored-landing-glass-reverse.png in the external evidence folder. This is sampled visual verification, not certification of every possible user path.
