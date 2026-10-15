# UV-aware irradiance cleanup

These scripts process **lighting only**. They do not change the Blender scene, base-color images, UVs, normals, exposure or material identity.

Requirements: Blender for EXR conversion; Python 3.11+ with NumPy and SciPy; the official Windows x64 Open Image Denoise distribution with `RTLightmap` weights. Tested with OIDN 2.5.1. Blender's bundled OIDN build in this project omits those weights. Do not silently substitute the beauty-image `RT` filter.

Create an arrays directory containing `sources.json`: an array of records with `zone`, `raw` (linear EXR path), `uv` (little-endian float32 triangle UV pairs, 3 vertices x 2 coordinates), and optionally `previous` (published EXR). Paths should be absolute. An optional `inputVariant` identifies a controlled rebake; default `raw`.

```powershell
blender --background --factory-startup --python scripts/lightmaps/convert.py -- export --arrays PATH
python scripts/lightmaps/denoise.py --arrays PATH --oidn-bin OIDN_BIN
blender --background --factory-startup --python scripts/lightmaps/convert.py -- encode --arrays PATH --output NEW_RELEASE_DIRECTORY
```

The filter rasterizes coverage, isolates connected chart components, denoises their edges as well as their interiors, and rebuilds four pixels of clean padding. The synthetic exterior context is smoothed before filtering so noisy boundary replication cannot create false stripes. Covered input pixels remain raw until OIDN runs. Adjacent atlas charts never become context for one another. No albedo or normal guide is supplied: this signal is irradiance, not a beauty render.

Preserve the raw bakes. Publish new paths only after checking the full scene, baked-only and albedo-only views. Inspect thin architectural trim, upholstery seams, contact shadows, different rooms and motion. Components with fewer than four covered texels cannot be reliably denoised and are reported. Raster-connected charts can share a component. Very narrow charts may require more bake samples or improved UV allocation. A lower Laplacian metric alone does not prove fidelity.

Use `processing.json` to verify outputs and hashes. Never generate ordinary full-atlas mipmaps without checking chart padding and cross-chart bleeding. If a new scene needs more texel density, rebake and export its matching UVs together.

References: [OIDN documentation](https://www.openimagedenoise.org/documentation.html), [official downloads](https://www.openimagedenoise.org/downloads.html).

## Missing subpixel islands (v20 upholstery repair)

A triangle can be visible on screen while its separate BakeUV island covers no texel centre. Four-pixel padding cannot rescue an island with no valid sample. The executive chair exhibited this exact failure: ray-cast screen pixel (677,315) maps to an island eight texels from covered data and reads black, while its adjacent cushion faces have valid irradiance.

`export-meshes.mjs` reads the shipped GLBs with Meshopt, without downloading their images, and exports world positions, normals, indices and the lighting UV channel. Run it from the app directory:

```powershell
node scripts/lightmaps/export-meshes.mjs MESH_DIRECTORY
python scripts/lightmaps/repair_missing.py --meshes MESH_DIRECTORY --arrays ARRAY_DIRECTORY --material "founder__FC91 | fine ivory leather.003"
```

The repair produces a separate `founder-hero-repaired.npy`; inspect it before copying it over `founder-hero-clean.npy` and encoding. It reconstructs uncovered sliver islands from nearby faces of the **same material primitive**, within 4 cm and with compatible normals. It leaves every originally covered texel unchanged. Synthetic padding cannot overwrite another original chart. This is local irradiance interpolation, not another Cycles bake; it cannot recover an isolated chart with no nearby valid surface. Unsupported faces are reported and must not be filled from unrelated atlas neighbours. Preserve the pre-repair array. For future scene authoring, allocate a minimum chart footprint before baking to avoid this failure entirely.
