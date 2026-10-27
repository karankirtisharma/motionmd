# Exterior finish audit — 27 October 2026

Active backup: `D:/Motion Design MD BACKUP 26-10-2026`. Protected FINAL and original Blender source remain unchanged. Evidence and source checkpoints are outside the website in `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/exterior-finish-2026-10-27`.

## Per-image causes and repairs

- Images 1–2: the founder exterior slab was omitted by the earlier shell-only winding repair. Its 344 triangles formed an inward-facing solid, with 55.63 m² of top facing downward. All sampled top/side centroids in its old baked-light atlas were zero. Corrected that component and rebaked exterior illumination against the corrected geometry. Source photographic limestone, normal detail, roughness and live sun remain intact.
- Images 3/6: the south return was 3 mm higher than the terraces, overlapping them by 350 mm west and 500 mm east. Aligned the south return with the -10 mm exterior finish. Subtracted the exact convex return volume from buried terrace surfaces, including the fascia. The exterior outline and interpolated source texture coordinates are retained.
- Image 5: coincident west/north top faces used different lighting coordinates and competed in depth. The same geometric subtraction removes duplicate surfaces at all four corners; 317 source triangles are affected. This replaces the earlier four-face east/north-only repair.
- Image 4: the vestibule's indoor marble extended 1.3475 m beyond its front facade. Split the exterior portion at the measured facade front (z=-10.6745) and glazing center (x=1.2), preserving indoor marble and its UVs. The exterior now uses the existing limestone at the adjacent -10 mm finish. Its end meets the neighbouring slab's flat face, covering only the internal 12 mm bevel.
- The visible apron and collision root receive the same repair. The retained L-shaped indoor floor uses a triangle mesh rather than an invalid convex collider. South-return collision vertices receive the same 3 mm height correction.

## Lighting release and reproduction

`qa/export-exterior-lighting.mjs <external-work-directory>` exports the final corrected receivers; `scripts/lightmaps/bake-exterior-finish.py` runs in background Blender against the documented source. It first verifies a byte-identical source checkpoint, then saves a separate derived scene outside the website. Original GLBs are unchanged; all eleven scene chunks still hash-identically to protected FINAL.

Six receivers / 2,711 triangles use a dedicated 2048² UV channel (`uv2`), without changing source texture/lightmap UVs on other objects. Cycles OPTIX baked 256 samples in 54.40 seconds: indirect diffuse plus direct practical illumination, excluding albedo and direct sun. OIDN RTLightmap filtering runs per coverage component (3.46 seconds). The new atlas's raw-to-clean mean RGB is effectively preserved; noise metric reduction alone is not treated as proof of fidelity. Two sub-four-pixel covered regions retain raw data.

Release: `public/assets/exterior-finish-v24/`. EXR 4,611,962 bytes, UV data 65,064 bytes, metadata 15,779 bytes: ~4.48 MiB additional download, 32 MiB GPU texture (half-float RGBA, no mipmaps). This is a deliberate fidelity cost. Geometry hashes reject a stale atlas before any receiver mutation. The three runtime assets are declared in the scene manifest and their served HTTP bodies match local SHA-256 values.

Founder top illumination changed from zero to area-weighted 0.456; apron 0.751. Remaining zero shell samples are tiny wall-edge bevels or north-return surfaces physically covered by the founder slab. Source texture albedo is not brightened to hide missing light.

## Validation

- Geometry tests cover all four top/fascia joins, flush heights, unchanged outline and untouched attributes, idempotence, indoor marble/UV preservation, and actual Rapier apron support for 120 gravity steps.
- Lighting tests cover upward winding, position/UV preservation, triangle conservation, stale metadata rejection, custom stone shader retention, noncollapsed atlas UVs, EXR decoding and measured top illumination.
- Production build, TypeScript and asset verification pass. Full regression and browser results are recorded below after final review.
- The initial full regression run began while the atlas was being generated: 110 tests passed and one reported the not-yet-published lighting.json. A final full run uses the completed release.

## Visual evidence and limitations

Before: `before-full.png`, `before-albedo.png`, `before-no-gi.png` isolate the finish mismatch from base color; `before-lift-walkway.png` uses the fixed founder-lift-exterior reference. Added QA exterior cameras reproduce all corner joins and the entrance apron. Final views/results follow below.

No animation clips, chair sequence, texture quality or interactive features were reduced. Original Blender SHA-256: `a9d47877c8379035dce248a3cc5885fe808e8e06ab6ab754d67ef2b132bff8da`. No GitHub publication requested.


## Final close-up corrections

The first integrated visual review caught two smaller remaining source defects: a 24 mm-wide / 12 mm-deep V-groove at z=-8.8 and a 3 mm southwest boundary offset. The internal bevel faces were split and raised to the common top, with closed ends and matching collision; the south cap edge now meets the measured studio slab edge. Corrected bounds also remove the duplicate outer fascia. No overlay hides either defect. Dense top/side rays confirm one visible surface.

The apron diagonal was geometrically flush within 0.25 microns but still dark in baked-only mode. A shared top/bevel UV chart allowed shaded buried-bevel texels to bleed onto the top. A 10-degree chart split isolates those surfaces. Bilinear sampling 1 mm from the join now retains 1.000–1.002 times the illumination 30 mm inboard (previously 0.16–0.18), without changing stone color or global lighting gains.

Blender preflight and the geometry emitter now reject triangles that collapse during Float32 encoding. Two valid subpixel slivers remain UV-degenerate: each 3.831864e-9 m² in area and 0.834465 microns wide. The test exception is restricted to those measured facets, width <=1 micron and UV span <1 atlas texel; zero-area geometry is never accepted.

Final release files use content hashes; metadata is replaced last, and superseded assets are archived outside the website. `lighting.json` points to `exterior-finish-92cd40f3673c.exr` and `lighting-uv-47d6a44a5f91.bin`.

## Final automated results

- Full regression at the first integrated release: 112/112 passed (`tests-final.log`).
- After the final groove, fascia and lighting-chart changes: 28/28 geometry, collision, architectural, renderer and runtime tests passed (`geometry-final-tests.log`), plus 6/6 lighting/material tests (`lighting-final-tests.log`).
- Final production build, TypeScript, asset verification and delivery preparation passed (`build-final.log`).
- Final localhost metadata, UV and EXR requests returned HTTP 200 with matching SHA-256 bodies (`http-final.json`).
- Collision microbenchmark: 724 pieces / 353,518 triangles; initialization 252 ms; mean movement query 0.067 ms across five trials. This is an absolute CPU microbenchmark, not a controlled FPS comparison.

## Bake post-processing

After the source export and Blender bake, run the existing `scripts/lightmaps/denoise.py` with the external bake directory, OIDN 2.5.1 bin directory and `--zones exterior-finish`. Then run Blender factory-startup with `scripts/lightmaps/convert.py -- encode --arrays <external-bake-directory> --output <external-stage-directory>`. Finish with `python scripts/lightmaps/package-exterior-finish.py --arrays <external-bake-directory> --stage <external-stage-directory> --archive <external-first-pass-archive>`.

The package step checks the staged atlas and geometry signatures, uses content-hashed filenames, publishes metadata last, and moves superseded files out of the website. Raw arrays, source backups, crash diagnostics from rejected malformed input and derived Blender sources remain in the external evidence folder.

## Final browser review

The final production release was inspected in Full material mode at High / 100% in the in-app browser. `final-entrance-apron.png` confirms the dark diagonal bake seam and internal groove are gone; `final-southwest.png` confirms the mismatched corner sliver is gone and the outside bevel is continuous; `final-lift-walkway.png` confirms the formerly black founder slab and fascia now have a coherent stone finish. Browser console returned no errors. Earlier integrated checks covered the northwest and southeast joins and the WebGL fallback. Final captures use a 1012 x 935 viewport after a user layout resize, so they are not pixel-identical comparisons with the earlier 1627 x 1244 captures.

Automatic rendering quality was restored and localhost remains available. All browser interaction stayed within the site; no desktop input or foreground-window control was used. The background browser was throttled to approximately 1 FPS, so these checks establish still-image appearance and topology/lighting correctness, not a reliable real-time smoothness or temporal-flicker benchmark. The structural duplicate faces responsible for depth competition are covered by automated geometry tests. Thin intentional outside bevels remain.
