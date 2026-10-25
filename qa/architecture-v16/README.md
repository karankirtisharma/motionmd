# Seam, material, camera and glass-stair repair â€” 11 October 2026

## Source and rollback

Active work derives from the preserved v15 model, itself derived from the approved D: v13 source. Editable candidate: `outputs/architecture-v16/MD_Presentation_Lounge_v16.blend` (workspace-relative). The byte-identical rollback is `outputs/architecture-v16/BACKUP_before_glass_stair_v15.blend`; hashes are in `source-hashes.json`. The previous website manifest is `outputs/architecture-v16/rollback-v15-manifest.json`, and its v15 assets remain intact. Do not commit or push without new authorization.

## Evidence and diagnosis

- The delivered v15 new-architecture GLB contained 44 Meshopt EXPONENTIAL-filter buffer views. Decoded heights were 4.203125 m instead of 4.200 m and 3.671875 m instead of 3.675 m. The newer export had lost the earlier precision workaround. Millimetre errors affect step joins, thin trim and glass; the same exporter also filtered normals. Restore lossless attribute bytes while retaining Meshopt compression. This is an established export defect, not a claim that every dark pixel has the same cause.
- The before ray grid found five samples with marble and limestone top surfaces at exactly the same decoded height. Before browser screenshots isolate full lighting, sun shadows disabled and unlit albedo. A dark seam was still visible with direct sun shadows disabled. Unlit albedo exposes a separate material discontinuity.
- Original short tread tops used limestone in the website while their source assigned marble. Appended source objects were resolved by ambiguous names; same-name older material graphs could also take precedence. Use the actual appended object mapping and current source material graph. Unified step tops explicitly use the original marble; vertical faces use original limestone.
- The former landing consisted of separate body/cap solids and three independently exported original treads. It is now one closed exterior shell with the same walking outline and elevations. Internal touching interfaces and thin material-strip joins are removed. Geometry checks show zero nonmanifold edges and zero degenerate faces. An early boolean result failed topology validation and was rejected before release.
- The controller explicitly switched into an eye-position/FOV branch when the camera boom was obstructed. Remove this automatic perspective change; keep swept camera collision, smoothing and close-range head visibility. V remains the only exploration view toggle.

## Glass spiral

The original 23 tread top levels and upper landing elevation are unchanged. New treads are 55 mm laminated low-iron glass with small bevels; the 60 mm glass landing keeps its original top. Original balustrades and handrails remain. The central support keeps its original geometry and uses the existing bronze material. The former concrete geometry remains in the source archive and the independent backup. A dedicated collision ramp retains the original climb route, independent of transparent render geometry.

## Reproduction

Workspace scripts: `work/architecture-v16/`. Geometry sequence: `edit.py` â†’ `rebuild_shell.py` â†’ `conform.py` â†’ `close_returns.py`; do not release the initial boolean intermediate. `web/` prepares source-derived meshes, bakes PBR and lighting, exports collisions, preserves source float precision, performs chart-protected denoising and packages KTX2. Finalization writes a candidate manifest for audit before publication.

GI is recomputed for entrance, gallery, shell and revised architecture. Other rooms retain their previous lighting, and sunset-v4 reflection captures remain an approximation. Glass uses native transmission, not a baked opaque substitute. Global lighting/exposure and existing material identities are retained.

## Checks

Run from the web app:

```sh
npm test
node qa/architecture-v16/audit-assets.mjs
node qa/architecture-v16/probe-surfaces.mjs
node qa/architecture-v16/audit-precision.mjs
node qa/architecture-v16/audit-slab.mjs
node qa/architecture-v16/audit-camera.mjs
npm run build
```

The precision regression rejects lossy attribute filters, wrong tread materials, changed tread elevations, competing junction surfaces and missing stair transmission. The movement audit tests walking and sprinting in both directions, multiple step lanes, grounding and guards. Camera regression specifically checks stable third-person FOV in the retained narrow gallery, explicit bodycam and recovery into open space.

Final results: 49/49 tests pass against active v16; all 34 traversal/ground/guard checks pass; 9,000 cinematic clearance samples have no hits; production build and TypeScript pass. All 106 referenced dependencies exist (843 MB, eight chunks, 10,488,183 triangles). Seven rebaked atlases preserve border/padding pixels exactly; maximum interior mean-color shift is 1.42%. KTX2 quality gates pass for all three maps.

Decoded v16: 115 lossless Meshopt buffer views, zero conflicting top samples in the junction grid, correct marble at all 20 tread samples, maximum tread height error 0.000000191 m, glass transmission retained.

Browser WebGPU comparison shows the repaired junction without the former black stripe and white top patches (`outputs/architecture-v16/web-after-junction.png`). Source Blender renders and matched browser full/no-sun/albedo screenshots are stored alongside it. The original 5.0-strength nosing looked too prominent through the glass; only those 23 faces now have a dedicated 0.2-strength warm material. Geometry and other lighting strips are unchanged. This final emitter refinement retains the prior diffuse bake; its residual baked contribution and old reflection captures remain approximations. Build success alone does not establish visual parity. This pass does not establish performance or visual quality across all hardware; no FPS improvement is claimed.


Final browser interaction check: walked the retained gallery after v16 loaded, confirmed third-person body presence, toggled V into bodycam and back, and returned to the junction inspection camera. Browser error log was empty. Screenshots: `web-gallery-movement.png`, `web-after-junction.png`, `web-after-glass-stair.png` in the workspace v16 output folder. This is sampled motion/scene coverage, not a claim that every surface on every device is artifact-free.

Rollback: to restore the old concrete stair and complete prior scene, use the preserved v15 source (or byte-identical named backup) and copy `rollback-v15-manifest.json` over the app's `public/assets/scene-manifest.json`, then reload. To revert only camera behavior, the pre-change controller is saved as `outputs/architecture-v16/InteractionController.ts.backup`; doing so restores the automatic first-person behavior intentionally removed here. Keep current files when comparing. No Git reset is needed.

After all checks, disposable `patched-baseline.blend` and the intermediate `.blend1` were removed from v16. Source, prepared source, original-stair backup, QA and active web assets remain.
