# Material repair verification — 15 October 2026

Baseline: `main` at `6e38945`. The v19 Blender source, shipped geometry, collision meshes, cameras (apart from one added QA reference), lighting strengths and scene design are preserved.

## Confirmed causes and corrections

1. **Blotchy stone, trim and bronze:** the irradiance-only Cycles bakes retained Monte Carlo noise. The old denoiser protected two raw border pixels and faded over six more; narrow UV islands therefore retained most of their noise. Its albedo guide was inappropriate for an illumination-only signal. All 18 active lighting atlases now use OIDN 2.5.1 `RTLightmap`, isolated chart context, denoised borders and freshly extruded four-pixel padding. Entrance and shell architecture were additionally rebaked at 2,048 samples, versus the original 256. Raw bakes and previous published assets remain available.
2. **Adjacent sharp/coarse marble:** the website reconstructed only the EH54 source material from the original photographic map. PL86, FR82 and FR84 still sampled their low-density packed color atlases. All four verified Blender graphs now use their original BOX projection, 2.8 m scale and individual color ramps. Roughness, bump, indirect lighting and material identities remain intact. See `marble-source-profiles.json`.
3. **Black upholstery scratches:** tiny separate BakeUV islands cover no texel centres. Their visible triangles sampled empty black lightmap space, even though the leather color map was clean. A ray through the headrest scratch at screen pixel (677,315) hit a zero-valued island eight texels from valid coverage. Uncovered islands were reconstructed from compatible nearby faces on the same material primitive, then padded. This repairs 28,700 faces across executive, studio and presentation seating. Every originally covered texel is preserved exactly. This is local irradiance interpolation, not a new ray-traced sample. 3,697 candidate faces without a suitable donor remain untouched; the audit includes hidden and underside faces and is not itself a count of visible defects. See `missing-coverage-repair.json`.
4. **Speckled bronze beside the stair:** `v13__Satin bronze` has collapsed UV0 and no tangent attribute (240 vertices). Enabling anisotropy with that degenerate derivative frame caused unstable reflections. Restored world-projected bronze now receives finite, surface-orthogonal brush tangents. Its metalness, roughness, anisotropy and color are retained. `final-bronze.png` verifies the same angle is clean.

## Diagnostic reliability

- Diagnostic texture sampling now honors the actual UV channel and EXR vertical transform.
- Normals-disabled mode removes normal-dependent specular filtering too.
- Independent GI, reflection and AO isolation controls were added.
- Sun-shadow isolation changes shadow intensity without destroying/recreating the shadow resource.
- The early chair shadow-bias/backface trial was rejected: close-up marks persisted without shadows and were reproduced by baked-only rendering. Those shadow changes were reverted.
- The generic `RT` denoiser and explicit shader-binding trials were rejected. Production uses the dedicated `RTLightmap` filter.

## Verification

- 54 automated tests pass, including a new degenerate-UV brush-frame regression test and diagnostic restoration checks.
- Production build and TypeScript compilation pass. Asset preflight resolves 441 files and all ten geometry chunks.
- WebGPU still checks: founder upholstery, founder connection/lintels, reverse upper landing, studio desks/chairs/chandelier, presentation seating, and detailed glass stair. Full, albedo, baked-only, normals-off and shadows-off comparisons distinguish authored texture from illumination defects.
- Cinematic playback was exercised and frames sampled; this is not an exhaustive frame-by-frame or all-device certification.
- All 18 output EXRs have recorded SHA-256 hashes in `lightmap-processing.json`. Their combined size fell from 101,184,150 to 87,045,561 bytes (about 14 MB, 14%). Atlas dimensions remain unchanged. No controlled FPS uplift is claimed; visible WebGPU reference views reported roughly 84–165 FPS on the current machine after settling.
- Original Blender source and asset paths remain preserved. Runtime geometry/collision references are unchanged.

The sampled problem views are substantially cleaner. Real marble veins, leather stitching, contact shading, woven fibers, gold surfaces and glass reflections remain. Narrow-chart interpolation is deliberately local and bounded; future Blender exports should allocate a minimum UV island footprint before baking. Ordinary whole-atlas mip generation was not enabled because it would mix unrelated charts.

## Changed implementation

- `src/runtime/rendering/sourceStoneFloors.ts`: four source graph profiles.
- `src/runtime/rendering/sourceBronze.ts` and `brushTangents.ts`: valid world-brush tangent basis.
- `src/runtime/rendering/diagnostics.ts`, `specularFiltering.ts`, `src/runtime/SceneRuntime.ts`, `app/page.tsx`: trustworthy independent render diagnostics.
- `public/assets/scene-manifest.json` and `public/assets/material-v20/lighting/`: versioned repaired lighting and upholstery QA camera.
- `scripts/lightmaps/`: reproducible EXR conversion, chart-aware denoising, mesh/UV extraction and missing-island repair.

## Evidence

- `final-wall.png`, `final-walkway.png`, `final-chair.png`, `final-bronze.png`, `final-studio.png`, `final-lounge.png`.
- `before-full.png`, `chair-backface-shadow.png`, `stairs-no-shadows.png`: useful pre-repair comparisons.
- `before-baked.png` used an invalid old diagnostic UV transform; `before-no-gi.png` was captured after an unintended mode change. Neither supports a conclusion.

References: [OIDN lightmap documentation](https://www.openimagedenoise.org/documentation.html), [Three texture semantics](https://threejs.org/docs/pages/Texture.html), and installed Three 0.186.1 tangent/material shader sources.

WebGL 2 fallback was also checked at the presentation seating, glass stair/bronze post and founder connection. It loads the final assets and renders the source material shaders correctly (`webgl-lounge.png`, `webgl-bronze.png`, `webgl-wall.png`). The browser error log was empty after these checks. The original v19 `.blend` SHA-256 remains `df27b1dd8b8b382027a334613b238ba3a733b3f72a7088a502c9f208f4e4bbce`. A structured manifest comparison confirms all baseline non-material fields and existing cameras are identical. `repair-invariants.json` confirms no originally covered lighting pixels changed during the missing-island reconstruction.
