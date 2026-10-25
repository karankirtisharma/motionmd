# Full-width entrance landing — 11 October 2026

## Scope and provenance

The user's final top-view annotation supersedes v14's corner-only widening. Fill the complete outlined entrance-side wedge to permit the diagonal green-arrow route. Keep the remainder of the approved D: model, including its spiral stair, lift, desks and rooms. The main central atrium remains open; the rejected cross-atrium bridge stays removed.

Source chain: unchanged `D:/MD Architecture Cloud/outputs/architecture-v13/MD_Presentation_Lounge_v13.blend` → workspace v14 derivative → `outputs/architecture-v15/MD_Presentation_Lounge_v15.blend`. The D: source and v14 checkpoint are untouched. The prepared web bake file is a separate derivative. No commit or push is authorized.

## Geometry

- Added floor footprint: 76.034 m², with original limestone structure and warm-grey marble finish.
- Main finish elevation 4.233 m; adjacent tread levels 4.200, 4.025, 3.850 and 3.675 m preserve the existing gallery connection. The steps extend across the added width.
- Continuous curved low-iron glass and bronze handrail follow the new outer edge. Ten superseded slab/guard components are archived; thirteen pieces replace them.
- `source-fidelity.json`: 8,869 retained visible v14 objects have unchanged geometry/material digests and world matrices. No unrelated source changes.

## Verification

`node qa/architecture-v15/audit-slab.mjs` checks the actual candidate collision meshes: 20 walk/sprint traversals (diagonal plus four step lanes, both directions), ten floor samples, three curved guard samples, and the remaining open atrium. All 34 checks pass. Raw capsule placement inside a narrow tread is not used as a standability assertion: the capsule can touch the adjacent riser; traversal tests exercise the controller's actual step resolver.

`npm test` includes a permanent diagonal/extended-step regression plus the earlier stairs, desks, lift, doors, guards, avatar and cinematic checks. Run `node qa/architecture-v15/audit-assets.mjs` for manifest hashes, GLB lengths and dependency closure. Live visual inspection and build results are recorded below when complete.

## Reproduction and limits

The follow-up glass correction uses the exact existing `Low iron glass | 12 mm` material and flat face shading, matching the old guard panels. The first curved guard was smooth-shaded, creating swollen refraction around thin edges; the joined web mesh also did not retain source sharp-edge flags. Flat face normals now survive the existing export pipeline. Positions, thickness and UVs are unchanged. `glass-correction.json` records the source/prepared edits. New-architecture GI is recomputed after this correction; the six zone bakes from the full slab revision are retained. This is a targeted native-glass shading correction, not a replacement scene-wide material adjustment.

Workspace `work/architecture-v15/edit_slab.py` edits only the derivative. `render_route.py` creates plan/perspective inspection images without saving its temporary visibility changes. `web/` contains source ownership, geometry preparation, collision export, GI/PBR bake, chart-protected denoising, KTX2 validation and finalization scripts. Internal `v13` chunk/material identifiers are retained for compatibility; the release URLs use `/assets/architecture-v15/`.

Indirect diffuse and direct practical illumination are rebaked for all six zones plus the new architecture. Direct sun remains real time. Reflection probes retain the existing sunset-v4 captures and remain an approximation after geometry changes. This work does not establish offline-render parity or performance across all devices.

## Final automated verification

- `tests.log`: all 49 tests pass. One inherited controller fixture expected the intentionally retired entrance guard; it now tests automatic close-camera recovery against the retained narrow gallery, without dropping its collision or view assertions.
- `build.log` and `typecheck.log`: isolated production build and normal development type checks pass.
- `asset-audit.json`: 106 dependencies, 755,821,247 bytes, eight GLBs and 10,485,081 triangles. No rejected client-v13 references.
- `denoise-audit.json`: all 16 maps retain UV border/padding values exactly; maximum interior mean-color shift is 1.407%. This does not prove every pixel visually.
- `solid-geometry.json`: all 12 new mesh solids are closed, positive-volume and have no degenerate faces.
- Cinematic clearance: no 17 cm camera-sphere overlaps in 9,000 samples against the revised static collision geometry. Dynamic lift behavior is covered separately by the suite.

## Browser verification

Verified on localhost:3001 with WebGPU after publishing v15. The full-width slab and diagonal-landing views show the clear railing and connected floor. Manually walked across the added floor and toward its guard; browser console error inspection returned no errors. Evidence: `outputs/architecture-v15/browser-slab.png`, `browser-landing.png`, `browser-walk.png`, and `browser-guard.png` (paths relative to the workspace).

Observed motion approximately 61–68 FPS with frame p95 15.9–17.7 ms in this local session; these are individual observations, not a controlled before/after performance benchmark. Other hardware/browser combinations were not verified in this pass.
