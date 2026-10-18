# Annotated surface repair — 2026-10-18

Scope: eight supplied screenshots. Images 1–2 are upstairs beside the founder room (user confirmed). Preserve accepted movement/chair work and materials. No GitHub push requested or performed.

## Source and recovery

Original local MD_Presentation_Lounge_v21.blend is unchanged: SHA-256 A9D47877C8379035DCE248A3CC5885FE808E8E06AB6AB754D67EF2B132BFF8DA. Blender 5.2.0 LTS inspection and actual shipped GLB positions/UVs were used. Workstation.ts SHA-256 remains 6CC439A93E08B2CCC46646D46E1B44FE2E38E123C399FBE023BADF5CBC995713.

External evidence directory (outside website delivery folder):
C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/surface-repair/

It contains source-v21-checkpoint.blend (hash-verified source backup), MD_Presentation_Lounge_surface-repair.blend (derived geometry source), source inspection reports, screenshots and test/build logs. scripts/repair-architectural-joins.py reproduces the geometry repairs from the original source. The website applies corresponding repairs once at initialization, before scene partitioning/material preparation; collision meshes receive the same floor changes. Original deployed GLBs remain intact.

| Image | Location | Diagnosis and action | Verification |
| --- | --- | --- | --- |
| 1 | Upstairs founder entrance, x=3.6/z=-9.6 | Original finish starts x=3.64375; gallery finish ends x=3.615. Closed 28.75 mm gap. Also closed 3.75 mm join at x=13.01. Kept floor elevation and UVs. | 01-before/after.png: exposed dark strip closed. Thin material/stone joints remain. |
| 2 | Upstairs founder floor beside mirror opening | **Corrected diagnosis after the user's follow-up:** the earlier comparison inspected the wrong location. At the reported L-shaped mark, disabling live sun shadows leaves the patch; disabling baked lighting removes it. Rebaked the original floor against current v21 geometry, preserving all unrelated atlas pixels. | 02-exact-before/no-shadow/no-gi.png establish baked-light contribution; 02-rebaked-full.png shows the repaired area. Earlier 02-full/no-sun-shadow.png do not validate this location. |
| 3 | Founder lamp / round seating, z=-2.4 | Original finish ends -2.44375; extension begins -2.397: 46.75 mm gap. Extended boundary to meet extension, keeping y=4.23. | 03-before/after.png: open line under lamp closed. Rug contact shadow retained. |
| 4 | Ground spiral-stair doorway | Studio finish top .015 versus adjoining floor 0 created a raised exposed edge. Formed a 120 mm transition to .0025, keeping remaining room/furniture level. | 04-before/after.png; actual-GLB ray-height test and collision integration. |
| 5 | Studio entrance edge | Same raised studio finish as image 4. Shared transition repair. | 05-after.png: reduced to a narrow finished joint instead of an open black edge. |
| 6 | Lounge ceiling strip | Front wing horizontal band.001 and canopy slab share y=3.88 undersides over a 386 mm overlap. Recessed fascia underside to 3.90; structural top remains 4.20. | 06-before/after.png: broad dark strip/jagged edge removed with sun shadows enabled. Actual-GLB regression test. |
| 7 | Other lounge ceiling corner | Same coplanar fascia/slab overlap; same geometry correction. | 07-after.png: second corner checked in full lighting. |
| 8 | V13 library bronze | Anisotropy .23/.28 with constant UV0 and no tangent frame produced unstable shading. Added a stable brush frame only where missing/degenerate; valid UV frames/maps/material factors retained. | 08-before/albedo/after.png, 08-motion-a/b.png: black speckling gone from panels/undersides and bronze sphere. |

## Validation

- Final complete suite: 74/74 tests passed (tests-final.log). Includes actual GLB founder floor, studio threshold, ceiling fascia, tangent frame, existing collision, chair and movement tests.
- TypeScript and production build passed; asset verification found 144 files / 884.0 MB / 11 geometry chunks (build.log). Separate temporary build directory removed after verification.
- Actual localhost WebGPU inspected at 100% resolution in Full lighting, with isolated material/shadow comparisons and multiple fixed camera views. Normal first/third-person studio movement and moving shelf-view samples checked; observed frame p95 around 8–12 ms on this machine for those sampled views. This is not a cross-device performance guarantee.
- Source/accepted workstation hashes checked after edits. No animation edits made in this surface-repair pass. Prior uncommitted stair/camera work and pre-existing clean-copy deletions preserved.
- No scene-wide lighting changes, UV rebake or material flattening. Small boundary edits keep existing light UVs. The follow-up below replaces only the original founder floor's lighting; a full scene GI bake was not performed. Other browsers/backends/devices remain unverified.

## Founder-floor shadow follow-up

The stale v20 illumination atlas retained the outline of removed architecture around the mirror opening. The current v21 source was opened in background Blender without saving or modifying the original. `qa/export-founder-floor-bake.mjs` exports the original 12-triangle floor with the exact shipped light UVs and repaired boundary. Other founder floor meshes are excluded.

`scripts/lightmaps/bake-founder-floor.py` bakes at 2048 × 2048, 256 Cycles samples: indirect diffuse plus direct practical lights, excluding albedo and direct sun. The existing OIDN 2.5.1 RTLightmap pipeline filters the six receiver UV islands. `scripts/lightmaps/merge-founder-floor.py` merges only their coverage and four-pixel padding into the previous atlas, protecting all other charts and their borders. Original base-color, normal and roughness textures, sun settings and reflection probes are untouched.

- Replaced 207,960 pixels including padding; preserved 3,986,344 pixels exactly before encoding. Protected-chart difference is zero.
- New asset: `public/assets/surface-v23/lighting/founder-floor-indirect.exr`, 6,907,959 bytes; SHA-256 `8934c02a10543e8567d5d01906f15f03786c2b8f418e8ccf8a4f3bda4280c880`.
- Only `founder__FR82 | polished ivory large format stone` uses the new atlas. The old shared atlas remains unchanged for all other materials.
- `qa/founder-floor-lightmap.test.mjs` decodes both delivered EXRs and checks that every changed pixel lies inside the original receiver's UV charts/filter border; other materials retain the original map. This also verifies encoding has not altered unrelated atlas values.
- All 74 existing tests and the new atlas regression passed (75 total). Production build, TypeScript and asset verification passed: 146 files / 890.9 MB / 11 geometry chunks.
- Localhost WebGPU verified at 100% / High in Full lighting and with live sun shadows disabled. `02-rebaked-full.png`, `02-rebaked-no-sun.png`, `02-rebaked-entry-angle.png` and `02-rebaked-founder-angle.png` cover the repaired area and both neighboring floor joins. These are area/angle checks, not pixel-aligned before/after comparisons. Background-tab throttling during loading is excluded from performance claims.
- Bake inputs, raw/denoised arrays and logs remain outside the website in the sibling `founder-floor-rebake` evidence directory. Original Blender source and character animation code are unchanged.
