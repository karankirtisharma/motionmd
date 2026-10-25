# Scene repair v6 — 9 October 2026

## Preservation and scope

Baseline local and remote `main`: `08106c431fdef14548a3cb0976174a51b672ba26`.
No commit, push, reset or restore was performed. The initial uncommitted TypeScript
development-directory includes were retained.

The original Downloads Blender file is unchanged, verified after the repair by SHA-256:
`a39d1652ddc41c241fb689eefd8ba7facedec388cb6c57e597494a065e138895`.

The parent workspace contains `outputs/scene-repair-v6/`:

- `backup/MD_Presentation_Lounge.blend`: preserved original source.
- `backup/MD_Lounge_Sunset_Bake.blend`: preserved prepared lighting source.
- `backup/website-before-repair.zip`: full working website and assets, including
  pre-existing uncommitted changes; excludes dependencies, Git metadata and build caches.
- `MD_Presentation_Lounge_Repaired.blend`: editable architectural repair.
- `MD_Lounge_Sunset_Repaired.blend`: matching prepared lighting copy.
- `backup/superseded-web-assets/`: old GLB/lightmaps/probe, removed from public delivery.
- `backup-manifest.json`, source bounds, ownership and layout verification records.

These large offline originals/backups are intentionally outside this web repository.
The public `repair-v6` directory contains only the active browser assets and coverage metadata.

## Confirmed defects and targeted changes

| Defect | Evidence | Correction |
| --- | --- | --- |
| Avatar penetrated workstation desks and monitors | Old supplemental collider GLB contained only the presentation table and four presentation chairs | Exported 241 source-derived convex component envelopes, including all six workstations, 18 monitor housings, chair bodies, architectural piers and missing support surfaces |
| Feet sank at entrance | Rendered terrace top was −0.01 m; missing support let the player stand on context ground at −0.355 m. Vestibule foundation top was −0.09 m while finish was 0 m | Added actual source terrace, vestibule finish and threshold; two entrance tread colliders use their exact source box bounds |
| Workstation 04 intersected pier | Desktop overlapped `R9 limestone gallery pier.001` by 0.46 × 0.38 × 0.05 m | Moved whole workstation assembly by Blender `[0,-2.35,0]`, equivalent to web `[0,0,2.35]`. Structural pier retained. Source and prepared Blender copies agree with browser positions |
| Mottled lighting and obsolete workstation contact shadow | Clean source-color diagnostic isolated baked illumination. Pier belongs to the **gallery** atlas, not the adjacent studio atlas | Rebaked studio GI at 512 samples and gallery GI at 1024; OIDN filtered illumination only, retaining atlas padding/borders. Recaptured studio reflection probe at 128 samples |
| Camera could miss geometry between obstruction rays | Previous camera tested five discrete rays | Sweep a 0.19 m camera sphere against the same solid collision world |
| Material debugging was misleading | Plain BasicMaterial dropped reconstructed triplanar color nodes and displayed atlas fragments | Diagnostic node materials preserve source color nodes and texture UV channels |

The full-body capsule remains the calibrated radius 0.25 m and total height 1.70 m.
Collision repair improves scene coverage rather than inflating the character until stair
contacts become unstable. The camera and player share the audited collision world.

### Asset fidelity checks

- All **8,782 visible source objects** retain their names, vertex counts and material assignments.
- Only the intended **757 visible workstation components** changed transforms; zero unexpected movement.
- Broad-phase structural audit: 10 large tables/desktops × 190 tall walls/piers/columns:
  one candidate intersection before, zero after. This is not a triangle-level proof for every decorative part.
- Delivery GLB: only owned workstation positions translated (608,051 split vertices).
  UV, normal, index and material payload bytes retained; no visible geometry decimation.
- All original color, roughness, normal, source-stone and foliage texture assets retained.
- Baked atlas borders and padding preserved. Raw denoising reports describe limitations;
  the final browser comparison is the acceptance check, not a claim of zero noise everywhere.
- Existing warm sun, exposure, AgX, material identities, temporal antialiasing and reflection system retained.

## Rejected experiments

- Increasing capsule radius/height introduced fixed-step floor jitter: reverted.
- Reducing autostep minimum width did not fix the entrance snag: reverted; exact tread collision boxes did.
- Re-exporting the prepared merged studio changed UV/order correspondence: rejected, staged output never activated.
  Exact source-owned position patching preserved the working delivery payloads instead.
- Asking Rapier to recompute convex hulls failed on a thin cable tray: use the validated, precomputed convex mesh topology.
- Initial shell-atlas bake was stopped after provenance identified the pillar as gallery geometry;
  no shell replacement was activated.

## Verification

Run from the web app with installed locked dependencies and Node 24:

```sh
npm test
npm run test:scene-repair
npm run benchmark:collision
npm run verify:assets
npm run typecheck
npm run build
```

The completed verification ran **32 tests, all passing**, TypeScript and an isolated webpack
production build. Asset verification resolved **232 files, 767.2 MB, six geometry chunks**.
The two new actual-asset tests traverse the entire entrance in both directions at walk
and sprint speeds, check support heights to 6 mm, prevent desktop autostep, check all six
desk locations, 18 monitor envelopes and the newly cleared aisle. Existing checks cover
four distinct presentation chairs, sit/stand, avatar grounding, camera obstruction,
controller interpolation at 60/90/144/165 Hz, cinematics and rendering partition integrity.

Browser review exercised entrance traversal both directions, sprinting into a workstation,
V view switching, L interaction/fallback and Esc/menu. In-app pointer lock was not granted;
the existing drag-to-look fallback remained usable. Browser screenshots are retained in
the parent repair folder. Both WebGPU and forced WebGL 2 completed loading and rendered
the corrected workstation with no captured console errors. The repaired editable Blender
file was reopened and rendered in Cycles; `blender-layout-preview.png` independently
confirms the source layout. Desktop interaction was checked; mobile performance is not certified.

## Measurements and practical limits

Same Node process benchmark design: one initialization, one warmup and five timed trials
of 1,200 physics steps. Machine: NVIDIA RTX 4070 desktop; physics timings are CPU timings.

| Metric | Before | After |
| --- | ---: | ---: |
| Triangles in collision input | 372,604 | 251,216 (−32.6%) |
| Collision GLB bytes | 3,711,368 | 2,564,116 (−30.9%) |
| Collider components | 493 | 651; greater coverage with simpler parts |
| Physics initialization, one measured run | 339.2 ms | 214.1 ms (−36.9%) |
| Mean movement query | 0.0463 ms | 0.0604 ms; +0.0141 ms for fuller coverage |

Timing is not a cross-machine guarantee. The legacy `deskBlocks` benchmark point also
intersects a pier; the dedicated regression test, not that field, proves desk coverage.
The render scene still contains high-detail source geometry. Renderer-tracked buffers and
textures were approximately **2.1 GiB**; this excludes driver/browser allocations and is
not a complete VRAM measurement. Loading is still substantial.

Do not claim a measured GPU FPS improvement from this repair: the in-app host began
delivering roughly one frame per second during the later fixed-viewport check, even with
the DOM visible. Earlier live samples and this throttled session are not a controlled
before/after GPU benchmark. The debug panel now exposes frame-interval p50/p95 and tracked
resource bytes for repeatable foreground profiling. Adaptive quality remains available.

Final unthrottled static workstation snapshot: WebGPU, High, 100% resolution, 160 FPS,
6.1/6.9 ms p50/p95, 128 draw calls, 5,523,987 submitted triangles and 2,198 MiB tracked
resources. Treat this as a single-view observation, not a walkthrough average or GPU improvement.

## Repeatable offline recipe

`workspace-scripts/` preserves the exact repair scripts. They are **project-specific
offline tools**, not scripts to run blindly on another scene or against a modified baseline.
Restore the original directory layout in an isolated workspace before rerunning:

1. Copy all scripts except `rebake_oriented_gi.py` and `denoise_entrance_test.py` to
   `<workspace>/work/scene-repair-v6/`. Put those two under `<workspace>/work/`.
2. Supply the two backed-up Blender files at the documented backup paths, the baseline
   web app at `outputs/md-lounge-web`, the original atlas plan at
   `work/atlas-repair/atlas-plan.json`, and `work/dense-assets/{uv,textures}`.
   These required source-side artifacts already exist in the original workspace.
3. Use Blender 5.2 Python, NumPy and its built-in glTF exporter. Baking uses an OptiX GPU;
   denoising is CPU OIDN. The position patch used Node 24, Three 0.186.1 and meshoptimizer 1.1.1.
4. Run `audit.py` against the source backup, outputting `source-bounds.json`. Run
   `repair_source.py` against that backup. Run `repair_prepared.py` and `write_ownership.py`
   against the prepared backup. Each saves only derived files/staging output.
5. Run `patch_positions.mjs` against the **baseline** studio GLB. If using the current
   app, retrieve the original from `backup/superseded-web-assets/precision-v3/geometry/studio.glb`
   into an isolated baseline app first. Never patch an already moved studio a second time.
6. Run `export_colliders.py` against the repaired source, and repeat source bounds audit
   into `repaired-source-bounds.json`; run `verify_architecture.py`.
7. Rebake studio and gallery using the repaired prepared file. Example from workspace:

   ```sh
   blender --background --factory-startup --python-exit-code 1 --python work/rebake_oriented_gi.py -- --prepared outputs/scene-repair-v6/MD_Lounge_Sunset_Repaired.blend --zone studio --samples 512 --out work/scene-repair-v6/gi
   ```

   Repeat with `--zone gallery --samples 1024`. Run `denoise_entrance_test.py` for each
   atlas with `--dense --no-albedo`; retain raw bakes for comparison. Run `capture_probe.py`.
8. Stage, hash and compare outputs before copying to public `repair-v6`; update manifest
   URLs/geometry sizes/hashes. Preserve superseded assets outside public. Re-run tests,
   isolated production build and still/motion browser review before considering publication.

No source backups, temporary merged exports, raw denoising buffers or staging caches
belong in the deployed public directory. Publication remains subject to explicit user confirmation.
