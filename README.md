# MD Lounge â€” clean current website

This folder is a standalone copy of the current website, including the local v21 gallery opening/mirror changes and the v20 material fixes. It is newer than GitHub commit 8957f67949efd91766756fb11f851d28ad3b0c18; no push was performed while making this copy.

## Run

Use Node.js 24. From this directory:

```powershell
npm ci
npm run dev -- --port 3001
```

For production: `npm test`, `npm run build`, then `npm start -- --port 3001`. Stop any other server on the selected port first. Deploy with Next.js and this directory as the project root. Keep the included Git LFS rules if uploading to GitHub.

## What is included

Application code, package lock, deployment configuration, current regression tests, asset licenses, and every manifest/runtime/GLB dependency of the current scene. Versioned asset folder names are intentional: the scene still uses specific files from several releases. Do not remove an entire old-looking folder without tracing its references. COPY-INVENTORY.json records each copied file and its verified SHA-256. Two small older collision fixtures are retained because tests use them.

## What is excluded

Git history and LFS cache, node_modules, Next build caches, logs, temporary exports, unused scene assets, historical screenshots/reports, backup versions, and Blender working files. The original project is untouched. This is the website delivery copy, not a Blender-authoring archive.

## Interactive founder desk (v22)

Approach the executive chair and click it or press E to work at the desk; trigger it again to stand. The empty chair starts turned 45 degrees toward the entry. The visitor takes two deliberate positioning steps, sits directly without grabbing the chair, and turns toward the screen with alternating foot placements. Unusually large arrival turns use an additional pair to avoid excessive leg twisting. Standing reverses the seated turn, stops beside the chair as soon as the visitor is upright, and returns movement control without automatic walk-away steps. The empty chair stays open for the next entry. The pedestal stays fixed; the original chair triangles, UVs, materials and full-size proportions are retained. Armrest/desk hand IK and planted-foot IK use the existing 1.86 m rig. Calibrated knee hinges track the toes through the slower alternating entry steps. Sitting and standing prepare the torso before moving the pelvis. The rug bake excludes the moving upper chair, whose sun shadow updates live; the fixed pedestal keeps its baked contact lighting. See `qa/chair-sitting-ledger.md` for measurements, source backup, validation and bake reproduction details. The supplied local `MD_Presentation_Lounge_v21.blend` is unchanged.

## Gallery / founder-room mirror

Both accessible sides now have live mirror faces. The founder-room side previously exposed the dark bronze backing; the runtime now reuses the exported silver face and thin bronze surround on that side. The structural wall and collision remain solid. Both sides were visually checked in the local WebGPU scene at High quality; debug cameras `V21 mirror detail` and `V22 mirror founder side` reproduce those views. The current 63-test suite and production build (including TypeScript) pass. See `qa/architecture-v21/README.md` for current and historical verification.

The original founder floor now uses a targeted v23 indirect-light rebake against the current v21 mirror opening, removing the stale L-shaped floor patch. Other v20 atlas regions and local reflection probes are retained. The original Blender source is at C:/Users/karan_z7alww2/Documents/Codex/2026-10-04/i-have-a-detailed-blender-blend/outputs/architecture-v21/MD_Presentation_Lounge_v21.blend. Historical diagnostic artifacts remain in the original workspace.

## Architectural surface repairs (2026-10-18)

The runtime closes measured gaps around the founder-room floor, forms a shallow transition at the studio threshold, and separates the overlapping canopy/fascia undersides. Collision geometry receives the same floor changes. Degenerate UVs on anisotropic bronze now receive stable brush tangents while retaining their original textures and material values. These are initialization-only repairs; the accepted character and chair animation code is unchanged by this work.

`scripts/repair-architectural-joins.py` reproduces the geometry changes in a separate Blender file; it refuses to overwrite the open source file. The original local v21 source and shipped GLBs remain intact. See `qa/surface-repair-ledger.md` for the per-image diagnosis, external Blender backup/derived source, visual evidence and validation. The `QA surface` debug cameras reproduce the inspection views.


## Performance audit â€” 26 October 2026

This backup is the active performance working copy; `D:\Motion Design MD FINAL` remains the safety snapshot. The rendering changes preserve all shipped scene/Blender/character assets. Frozen views settle temporal antialiasing before stopping GPU submissions; live animation continues normally. Mirrors render a cropped reflected view at the original texel density. Lighting maps decode in two bounded background jobs. The initial live mirror frame finishes behind the loading screen; broad offscreen shader warmup was rejected after it increased startup time.

For reproducible measurements, use `npm run build` then `npm start -- --port 3001`, open `/?debug=1&profile=1`, expand Performance capture and select Lock full quality. Capture a 15-second fixed view or the opening tour. `&renderer=webgl` checks the fallback. Diagnostics report CPU submission time and renderer-tracked allocations, not total GPU execution time or total VRAM. See `qa/performance-ledger.md` for measured results and limitations.

## Lossless delivery and progressive preparation â€” 27 October 2026

The backup builds Brotli and gzip static variants for all eleven scene GLBs. Next's narrow GLB proxy negotiates br/gzip/identity, preserves the original asset URLs and image-relative paths, and revalidates caches. It rewrites to static files; model bodies do not pass through a serverless response function. No production source asset is overwritten.

`npm run build` (and `npm run dev`) first generates ignored `public/asset-delivery/` variants and `src/generated/asset-delivery.json`. Every compressed file is decompressed and SHA-256 checked. A storage-only GLB pass reuses byte-identical blocks in lounge, v13 and mirror exports; all referenced bytes and non-offset metadata are asserted unchanged. No decimation, quantization or animation edits. Set `MD_GEOMETRY_STORAGE=0` before rebuilding to disable this compaction. Original GLBs remain the safety masters.

Scene source payload: 458.50 MB â†’ 454.05 MB after exact storage deduplication â†’ 267.53 MB over Brotli (290.24 MB gzip). The earlier Next server already delivered gzip, so 41.6% is the reduction against **uncompressed GLBs**, not an additional saving over the previous HTTP transfer. Textures and other assets are additional; repository disk size is not reduced. Generated static variants trade extra build/deployment storage for less network and request-time compression work; they are not committed to Git.

Loading prepares one room at a time, can prefetch one small successor within a 128 MiB source-buffer budget, and keeps oversized rooms exclusive. Two owned workers decode Meshopt buffers; only their active jobs copy transferable inputs. Workers are terminated on success, failure and cancellation. Decoded GLB downloads use one preallocated buffer when the decoded size is known. This is staged preparation, **not room-on-demand streaming**: the complete scene still finishes before Ready so the guided tour, mirrors and all interactions remain intact.

After starting the production server, run `npm run verify:delivery` to check all eleven chunks in br/gzip/identity, byte hashes, MIME, content negotiation, HEAD, ETag revalidation and byte ranges. Use `MD_VERIFY_ORIGIN` to target another authorized preview. `NEXT_PUBLIC_ASSET_BASE_URL` bypasses local delivery rewrites; an external CDN must supply its own Brotli/gzip negotiation, correct Content-Encoding/MIME/Vary and CORS headers. That hosting configuration is not automatically changed by this code.

See `qa/delivery-ledger.md` for measurements, checks, remaining shader costs and visual evidence.


## Character collision audit — 27 October 2026

The active backup now uses measured head/shoulder clearance, swept obstacle slowdown, stable flat-floor support, ordinary-floor sole contact and source-derived founder-chair back/head colliders. The accepted rig, animation clips, chair sequence, visible assets and material quality remain intact. The seated camera anchor clears the actual headrest. See `qa/character-collision-ledger.md` for before/after measurements, regression coverage, CPU costs, limitations and rollback snapshots.


## Exterior support and curved-chair repairs — 27 October 2026

The backup adds the five missing exterior stone supports, 38 omitted facade panes and four curved founder club-chair shells from measured source geometry. The foot solver rejects unreachable ledges; exterior limestone winding and one coplanar slab overlap are corrected during initialization. Original assets and accepted animation clips are unchanged. See `qa/reported-defects-ledger.md` for per-image causes, reproduction, tests, visual evidence and limits. Debug-only character inspection controls allow background site movement without desktop input.


## Exterior stone finish repair — 27 October 2026

The backup corrects the remaining inward-facing founder walkway, overlapping corner slabs, an internal terrace groove and the marble apron outside the entrance facade. Repairs operate on the measured source geometry and matching collision surfaces during initialization. Interior marble, photographic limestone, roughness/normal detail and the accepted character/chair animations remain intact.

A targeted v24 illumination atlas uses a separate UV channel, with horizontal paving charts isolated from shaded bevels. Geometry signatures prevent applying stale lighting after mesh edits. This adds about 4.48 MiB of delivery data and 32 MiB of GPU texture memory. Original Blender/GLB assets and the protected FINAL folder remain unchanged; Blender checkpoints and raw bake outputs stay outside the website. See `qa/exterior-finish-ledger.md` for per-image causes, reproduction, measurements and visual verification.

## Contact, stair and guard-glass refinements — 28 October 2026

The active backup removes the permanent stride-length stopping reserve while retaining the established physical body collider. Close approach now brakes progressively to actual body contact; a flat-support crossing guard prevents slow diagonal movement from snapping through the floor. Locomotion foot clearance preserves the source knee plane, and authored stair targets enter smoothly across the render-support lag band. The seated IK/chair sequence is unchanged.

Malformed guard-glass normals are repaired before material setup, and room-reflection candidate bounds match the shader influence border. Glass color, IOR, transmission and geometry positions stay intact. See `qa/contact-clearance-ledger.md`, `qa/stair-walking-ledger.md`, and `qa/glass-reflection-ledger.md` for measurements and verification. All 121 integrated regression tests passed. Debug controls include spiral/rounded stair inspection points and one-second sprint input for browser-only checks.


## Simplified original character - 30 October 2026

The original character and Idle/Walk/Run/Sit clips are restored. Experimental replacement rigs, stair foot planners and locomotion leg IK are removed, including the `motion=candidate` selector. Normal walk/run cycles now follow collision-supported stair movement without changing individual knees or feet. A small, bounded whole-model sole correction handles ordinary floor clearance; the existing chair interaction remains separate. This supersedes the earlier locomotion foot-correction descriptions above. All 123 current tests and the production build pass. See `qa/simple-locomotion-ledger.md` for recovery files, validation and the deliberate per-tread contact limitation.

## Performance and stair contact — 30 October 2026

The active backup now delivers 20 embedded images as pixel-exact lossless WebP, includes the character in Brotli/gzip negotiation, and uses verified quality-9 Brotli variants. Scene-plus-character transfer is 264.29 MB versus 288.62 MB before this pass (24.33 MB / 8.43% saved); external maps and other resources are additional. Original source assets remain intact. Unused HDR input textures are released after reflection filtering, reducing measured renderer-tracked resources by 80 MiB without changing the filtered lighting.

The original character rig/clips are retained. Stair support no longer renders below physical support; a vertical-only shoe clearance solve handles discrete visible treads without changing horizontal strides or source foot direction. Queries are batched per shoe. Regression tests cover unchanged flat-floor and seated poses plus actual controller ascent/descent at walking and running speeds. See `qa/performance-2026-10-30.md` for measurements, trade-offs and remaining startup/geometry bottlenecks. Timing observations are not a controlled cross-device benchmark.

Delivery preparation retains earlier generated variants by default so a running old build keeps working. Prune only with the server stopped using `MD_PRUNE_DELIVERY=1`; unset it afterwards. `MD_GEOMETRY_STORAGE=0` disables both lossless image conversion and GLB storage compaction for comparison builds.


### Final stair and landing-glass refinement

Stairs now use the source walk cycle, with Shift giving a modest brisk walk instead of the airborne flat-ground sprint. The foot-clearance solve uses a stable forward knee plane: the old animated-knee pole could flip backwards after an ankle was raised. Flat-ground sprinting and the chair sequence are unchanged. The omitted 2.4 m upper stair landing guard pane is restored from its existing collision coordinates with matching low-iron glass. The final regression suite has 132 passing tests; see `qa/performance-2026-10-30.md` for reproduction and limits.


## Production microstutter follow-up — 31 October 2026

The active BACKUP restores the older simple character controller, preserves the existing chair IK, skips one always-replaced 13.03 MiB gallery atlas, and fixes cancelled texture-loader cleanup. Immutable architecture transforms and unchanged mirror frames are reused. WebGPU now reuses exact static sun-shadow color/depth while continuing to render live character, chair and lift shadows; unsupported paths keep stock rendering. Canvas resize calls no longer reset an unchanged buffer, and sparse background callbacks cannot trigger quality reductions.

Two same-session full-quality comparisons had zero changed HDR pixels and 46.45% / 70.00% lower CPU render-submission cost. These are fixed-view rendering measurements, not overall FPS gains. The High-quality shadow cache adds approximately 128 MiB of tracked texture storage. All 182 regression tests and the production build pass; startup compilation and exact shoe/tread contact remain limitations. This supersedes the October 30 terrain-foot-IK descriptions above. See `qa/performance-2026-10-31.md` and `qa/animation-recovery-2026-10-31.md` for evidence, fallback behavior and remaining issues. The protected FINAL copy and source Blender/assets remain untouched.

## Studio shadow and simple stair contact - 31 October 2026

The bronze desktop bands are fixed at the sun-shadow filter using per-sample receiver-plane depth. Original bronze patina, reflections, lighting, shadow quality and the verified static-shadow cache are retained. The original character gait now receives bounded vertical tread clearance, preserving the source foot direction and knee bend plane; sprint blends into controlled stair walking without phase restarts. Flat-floor animation and chair IK remain intact.

All 183 tests, the strict 12-route shoe-contact audit and the production build pass. The post-fix cached/full shadow comparison has zero changed HDR pixels. This supersedes the exact tread-contact limitation in the preceding checkpoint; it does not remove the documented startup and cross-device performance limitations. See `qa/stair-and-shadow-2026-10-31.md` for measurements, screenshots, trade-offs and remaining edge cases.


## Studio and original motion review - 31 October 2026

`/studio` is the lightweight Screen1 experience, isolated from the lounge runtime. First visits to `/` choose between the studio and the existing 3D scene; `/?mode=3d` opens the lounge directly. The presentation TV opens the retained studio overlay when seated (click or Enter), and Escape at studio top level returns to the same chair. The covered lounge stops rendering and simulation. The presentation TV permanently displays centered studio branding; the founder-room dashboard remains unchanged.

Original character locomotion is restored while accepted chair/palm contacts are retained. Spawn/re-entry resets inherited movement before revealing the character. Strict per-tread shoe contact remains a known limitation of the original gait; do not treat the general test pass as a stair-contact pass.

The source Screen1 folder and protected FINAL remain unchanged. See `qa/studio-integration-verification.md`, `qa/studio-deployment-ledger.md`, and `qa/original-animation-restore-2026-10-31.md` for measured payloads, tests, content limitations and review evidence. Vercel requires Git LFS enabled in Settings > Git followed by a new deployment. The review branch is not merged/deployed automatically.
