# v18 curved landing and rounded short steps

Delivery checkpoint: 13 October 2026. Based on preserved v17; prepared for the user-authorized GitHub update. Native Blender sources and backups remain local.

## What changed

- Expanded the upper landing free edge into one smooth curve connecting the two circulation ends. Reused the original simple clear guard glass and bronze rail.
- Rounded the short marble step fronts using a broad circular profile. Kept levels 4.233, 4.200, 4.025, 3.850 and 3.675 m; the separate detailed v17 glass spiral is retained.
- Combined the two adjoining gallery/passage floor pieces with the new slab. This removes coplanar floor overlap and gives the curved last tread its full going at the return route.
- Removed the marked tall display-pier/bronze projections above the landing. Retained a capped backing and proportionally scaled ground artwork below the slab. Added a restrained bronze underside edge member; other building supports remain.
- Rebuilt matching collision meshes. A new regression exposed an exact-triangle-edge Rapier ground ray returning the slab underside. `groundAt` now uses millimetre neighbour samples only for placement/recovery; the per-frame movement solver is unchanged.

## Source and reproducibility

Workspace-relative paths:

- Editable: `outputs/architecture-v18/MD_Presentation_Lounge_v18.blend`
- Bake preparation: `outputs/architecture-v18/MD_Lounge_Sunset_v18_prepared.blend`
- Preserved rollback: `outputs/architecture-v17/MD_Presentation_Lounge_v17.blend` (hash verified unchanged)
- Website rollback: `outputs/architecture-v18/rollback-v17-manifest.json`
- Source construction and render scripts: `work/architecture-v18/`
- Incremental geometry/material/collision pipeline: `work/architecture-v18/web/`
- Native scene archives also retain the replaced pieces, hidden from rendering/export.

The website manifest loads an additional v18 chunk and patched entrance/v13 chunks. Unrelated geometry remains in its existing packages. Original source material graphs were baked to a 4096px PBR atlas with UASTC KTX2 mipmaps. Eight affected GI atlases (entrance, gallery, shell, existing v13 architecture and new v18 architecture) were rebaked at 256 Cycles samples, with chart-border-protected OIDN. Existing sunset reflection captures are retained.

## Verification

| Check | Result |
|---|---|
| Source slab topology | 0 non-manifold edges; 0 degenerate faces |
| Source patch coverage | All 21 targeted objects matched; none partially matched |
| Automated suite | 50 passed, 0 failed |
| Targeted landing support/walk/sprint/guard checks | 44 passed |
| Existing entrance-to-gallery-to-spiral route | Both directions at walk and sprint speeds passed |
| Cinematic volume sweep | 9,000 samples; 0 intersections |
| Marble height samples | 40 samples; maximum error 0.0000002 m |
| Junction surface audit | 0 overlapping surface-area samples |
| Precision | 159 compressed buffer views retain lossless attribute filters |
| Production build and TypeScript | Passed |
| Browser | WebGPU views inspected from both sides; no console errors |

The surface audit distinguishes 10 exact shared-edge hits at the retained 5 mm floor interface from area overlap by probing to both sides. It does not hide overlapping surfaces with depth offsets. Original straight-guard/step test coordinates were updated to the new geometry; the full gallery route test remains at its original coordinates.

The scene has 10,743,345 source triangles, an increase of 14,330 (0.134%). The new compressed geometry is 502,284 bytes. A settled local RTX 4070 view at 1509×1244 and 100% resolution showed 164 FPS, 6.1/6.4 ms p50/p95 and 133 draw calls. This is one view, not an improvement claim or a mobile benchmark. WebGL/mobile visual QA remains unverified in this task.

Run from the web app:

```powershell
npm test
npm run build
node qa/architecture-v18/audit-slab.mjs
node qa/architecture-v18/audit-camera.mjs
node qa/architecture-v18/probe-surfaces.mjs
node qa/architecture-v18/audit-precision.mjs
node qa/architecture-v18/audit-assets.mjs
```

Preview: `http://127.0.0.1:3001/?debug=1`, reference cameras **V18 curved landing** and **V18 rounded steps reverse**. Choose **Tour** to return to the normal camera.

![Final web view](browser-curved-landing.jpg)
