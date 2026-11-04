# Production release checks · November 2026

The comparison revision is `19c7a70`. The same live lounge, native Studio, materials, pose, camera paths and original source masters were retained.

| Check | Result |
|---|---|
| All 22 model transfers, Brotli | 257,680,748 → 204,260,942 bytes. Four room GLBs had orphan accessor/view streams. Every retained attribute and index was compared against the source. |
| Verified fresh public artifact | 267 files, 1,188,512,083 bytes. Includes all required static fallbacks and negotiated representations. Build output, JS/functions and repository size are different budgets. |
| Founder chair lightmap storage | 128 MiB → 16.01 MiB including lookup. All original texels and filter gutters reconstruct exactly. On the actual material, WebGPU differed by one display code on four pixels across two 960×576 views. WebGL2 matched in both views. |
| Opening pipeline | In normal/skip and skip/normal RTX 4070 comparisons, preliminary standalone scene compilation took 33.3/19.2 s and produced 447 instead of 326 tracked programs at Ready. The actual nested HDR, velocity, shadow and reflection renders execute before entry. |
| Cinematic path | The hashes of all sampled positions, orientations and FOVs matched across 5,401 time points. The timing/look convolutions reuse exact weights. |
| Local cold ascent | Previous worst interval 623.9 ms; new 50.1 ms. No new shader builds on the final cold walk from the spiral into the founder room. One repeat recorded four intervals over 50 ms, maximum 73.3 ms. This is not a guarantee for every frame. |

The chooser loads lounge code only after 3D selection. Interrupted avatar and collision downloads retry through the shared loader; collisions have two concurrent imports. Local content-hash URLs improve repeat EXR/KTX2 reads. Required source EXRs start transferring while geometry loads, capped at 32 MiB of speculative bytes and two early transfers. Raw and fallback chair representations are never speculatively loaded together.

Removing whole Studio or Founder room meshes from the first view changed over 116,000 or 19,000 pixels, respectively, above a two-code RGB difference at 960×540. An isolated split of the invisible founder keyboard would defer only 3.69 MB of Brotli and require an additional readiness gate plus about 183 MB of release variants if full fallback is retained. Neither alternative shipped. All tour sightlines keep their authored geometry. A physical integrated-GPU machine and real-user telemetry are still needed to establish field performance.

Reproduce with `npm test`, `npm run build`, `npm run verify:images`, and `npm run verify:delivery` against a production server. Hosted builds use `npm run build:release`. Keep original GLBs and old immutable assets until their rollback policy expires.
