# Delivery optimization — 27 October 2026

## Scope and source safety

Active working copy: D:/Motion Design MD BACKUP 26-10-2026. Original: D:/Motion Design MD FINAL. No Blender edit, re-export, decimation, quantization, texture change or animation/controller/physics edit was performed for this delivery change. GitHub publication of the tested delivery and loading-counter changes was subsequently authorized; generated variants and local caches remain excluded.

Integrity check: all 243 original files match the saved backup inventory; all 147 source asset/Blender files in the working backup are unchanged. Generated delivery variants are ignored, reproducible build outputs, not replacement masters.

Device: RTX 4070 12 GB, Windows, Chromium 156, Next 16.3.8 / Three 0.186.1. Main visual/measurement viewport 1627 × 1244, DPR 1, WebGPU, High 100%. Browser foreground; no builds/tests during the baseline/final WebGPU load or tour captures. WebGL compatibility checks are separate from timing comparisons.

Evidence directory: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/performance-2026-10-26

## Changes and verification

1. **Precompressed static delivery.** Build-time Brotli quality 5 and gzip level 6, SHA-256 decompression checks, content-addressed generated files. A GLB-only Next proxy negotiates Accept-Encoding and rewrites to static files. Original URLs and relative dependencies stay intact. Identity and gzip fallbacks remain available. Cache-Control on the actual destination is explicitly revalidating: an initial immutable-header experiment was rejected by the HTTP test and corrected before final validation.
2. **Progressive preparation.** One source room parses at a time; one small successor may download while it parses, within a 128 MiB source staging budget. A larger room runs alone. Two per-load workers perform Meshopt decompression. Only active worker inputs are copied/transferred; queued views retain their existing source references. Cancellation/failure rejects pending work and terminates workers; successful loading terminates them too.
3. **Decoded-download allocation.** The loader uses the response's verified decoded length or the manifest's decoded size to preallocate one GLB buffer, even when Content-Length describes compressed bytes. Missing/inaccurate lengths remain safe, with byte-accurate fallbacks.
4. **Exact geometry storage deduplication.** Each standard GLB JSON/BIN pair is inspected. Byte-identical binary ranges can share storage; every referenced range and the entire non-offset metadata graph are verified after rewriting. Only lounge, v13 and mirror derivatives meet the worthwhile-saving threshold. Vertices, indices, normals, tangents, UVs, embedded images, materials, nodes, joints and animation values are unchanged. The other eight chunks keep their exact original decoded GLB bytes. No geometry precision reduction.

The complete scene still loads before Ready. This is bounded staged preparation, **not room-on-demand streaming or eviction**. That boundary preserves the current guided tour, reflections into adjacent rooms, collision coverage, moving lift and immediate exploration. A scene-streaming redesign would need separate visibility/interaction gates and first-view shader handling.

## Measured delivery and loading

| Measurement | Before | Final |
| --- | ---: | ---: |
| Scene source GLBs, decimal MB | 458.500 | 458.500 (masters unchanged) |
| Identity delivery after exact compaction, MB | 458.500 | 454.046 |
| Brotli scene delivery, MB | — | 267.534 |
| Gzip scene delivery, MB | about 292.3 | 290.239 |
| All asset encoded bodies, MiB | 669.07 | 645.45 |
| Requests at Ready | 119 | 119 |
| Geometry + embedded texture preparation | 11.34 s | 8.00 s |
| Total runtime Ready, local observed reload | 75.71 s | 70.19 s |
| Startup long tasks | 17 / 11.43 s total | 12 / 10.30 s total |
| Largest startup long task | 8.70 s | 8.73 s |
| Renderer-tracked resources at Ready | 2492.34 MiB | 2492.34 MiB |

Brotli alone was checked first at 269,531,689 bytes. Exact storage compaction then brought Brotli to 267,533,636 bytes. Source identity bytes drop by 4,454,168. All 1,654 referenced binary ranges were verified by the compaction test.

**Important baseline distinction:** the earlier Next server already used gzip. The 41.6% reduction compares final Brotli against the uncompressed 458.5 MB sources. The actual additional reduction over the earlier gzip-delivered scene is about 24.8 MB (8.5% of scene GLB transfer); total measured page asset body bytes fall about 3.5%. Browser cache reuse differs between captures, so encoded-body totals are compared rather than claiming the transferSize delta as a cold-network result. WAN/mobile cold-load testing remains pending.

The final 15-second guided tour capture at High quality recorded p50 12.0 ms / p95 14.1 ms / p99 20.3 ms, four frames over 50 ms and one 80 ms long task, with the tab visible. This is a functionality/performance smoke result after warmup, **not an isolated frame-rate improvement claim for compression**.

## Visual and interaction checks

- Matched settled WebGPU lounge, founder and studio reference views at identical resolution and camera settings. No visible material, silhouette or architectural changes found.
- Screenshots are not pixel-identical: excluding the diagnostic overlay, mean absolute RGB differences were 0.65 / 0.71 / 0.99 on a 0–255 scale. Temporal sampling/specular differences remain; binary-data equivalence is verified separately and is not inferred from this metric.
- Founder-side live mirror checked after exact mirror storage compaction.
- Chair approach, seated desk pose, side view, stand/exit and return to exploration checked. Existing hand/foot IK and entry/exit code unchanged.
- Entrance movement across the steps and the guided tour exercised.
- WebGL 2 fallback reached Ready, loaded all 119 dependencies, and passed full-quality lounge/mirror visual checks without console errors at 1280 × 720. The additional tab was closed after validation. Its startup timing is not compared: it overlapped CPU regression tests and had another frozen scene resident.
- Original/source integrity: delivery-integrity.json.
- Visual proof: delivery-before/after-lounge.png, delivery-before/after-founder.png, delivery-before/after-studio.png, delivery-chair-side.png, delivery-entrance-movement.png, delivery-mirror-founder.png.
- Timing proof: delivery-baseline-load.json, delivery-stage12-load.json, delivery-final-load.json, delivery-final-tour.json.

## Automated checks

- Production build with TypeScript and asset validation: passed.
- Final publication regression suite, including the loading counter correction: **91 passed, 0 failed**, 113.10 seconds (github-delivery-tests.log).
- HTTP: all eleven GLBs tested in br/gzip/identity with decoded hashes, MIME and Vary. Weighted/disabled encodings, HEAD, 304/ETag revalidation and identity byte ranges passed. Reproduce with npm run verify:delivery while the production server runs.
- Build-time compression roundtrip verification passed for all 22 compressed variants.
- Storage compaction test verifies all scene metadata and referenced bytes, not just bounds or triangle counts.

## Trade-offs and remaining bottlenecks

- GPU residency, render triangle counts and source repository size do not shrink. Build-time variants require roughly 588 MB extra generated disk/deployment storage, excluded from Git, to reduce request CPU/network work. Original assets remain available for safe rollback.
- Shader compilation (29.72 s), initial reflection submission (3.08 s) and initial GPU completion (22.86 s) still dominate final startup. This work does not eliminate driver stalls or guarantee zero stutter.
- Textures/other scene assets remain large; no lower-resolution substitutes were introduced. The duplicate cream-stone image request remains from the existing independent loading paths.
- Static/live-character shadow geometry remains expensive. No claim of reduced total VRAM or leak-free long-session behavior.
- External CDN configuration and public deployment are untested here. NEXT_PUBLIC_ASSET_BASE_URL skips the local proxy; that CDN must negotiate compression correctly and preserve MIME/Content-Encoding/Vary/CORS.
- Mobile/low-end devices, WAN cold-cache loading, long-session heap snapshots and GPU timestamp profiling remain pending.

## Reproduce and rollback

npm run build generates and validates variants; npm start -- --port 3001 runs the production preview. Open /?debug=1&profile=1 and Lock full quality. Reference cameras PL78 | Screen and seating, FR80 | Expanded founder hero, MF01_Studio and V22 mirror founder side reproduce inspections. Test founder-desk movement exposes the chair check. &renderer=webgl selects fallback.

Set MD_GEOMETRY_STORAGE=0 before rebuilding to serve original geometry bytes through compression only. Removing the proxy/delivery build hooks restores standard Next delivery, without restoring or modifying any original model files. The generator prunes only its own obsolete hash-named files inside public/asset-delivery.


## Loading counter correction

The architecture loader now displays negotiated delivery MB separately from unpacked MB, using generated server metadata for Brotli, gzip or identity. Decimal MB is used consistently. Progress follows the final unpacked size (454.046 MB), rather than the original manifest total. External origins without those headers explicitly label their count as unpacking, never downloaded bytes. Focused progress tests and the production build pass; HTTP verification also checks the aggregate size headers.
