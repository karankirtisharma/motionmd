# Glass reflection seam repair — 28 October 2026

Working copy: D:/Motion Design MD BACKUP 26-10-2026. Protected FINAL and shipped Blender/GLB assets are unchanged. Scope: upper guard-glass reflection discontinuities shown by the user; preserve genuine scene-dependent reflections, clear glass identity and all geometry/UVs. No new planar mirrors or reflection render passes.

## Measured causes

1. `WEB_v13_architecture_14` (`v13__Low iron glass | 12 mm`) contains shared corner normal fans across the front, back and thin top/bottom of several panes. The original central flat pane at x=7.606–11.194, z=-10.985 has only eight corner vertices. Its shading normals tilt toward unrelated faces, unlike its flat neighbors and the correct curved v19 replacement. A broad-face scan found 766 triangles with more than 15 degrees of shading-normal error; normals in the stair guard also acquired large vertical components. This bends reflected room geometry and creates abrupt seams even though adjacent materials have identical tint, IOR, roughness and transmission.
2. Reflection shader influence extends 0.4 m outside each room box, but CPU candidate culling used the unexpanded box. Founder glass begins at y=4.22, just beyond the lounge box max y=4.20, so its shader omitted a capture that still affects neighboring gallery glass up to y=4.60. Candidate selection now uses the same constant as the shader.

## Changes

- `glassNormals.ts` detects malformed broad faces only on the source 12 mm low-iron material family. It separates face fans at a 15-degree crease, smoothing along the curved guard while preserving sharp thin-glass edges. Ten-micron position welding keeps front/back layers separate. The repaired geometry preserves every original triangle and all non-normal attributes in identical triangle order. One source mesh changes; eight other low-iron source meshes keep their original geometry/normals. The repair runs once during initial material preparation and is idempotent.
- `probesForBounds()` aligns CPU probe culling with the already existing 0.4 m fragment influence. It does not enlarge reflection intersection boxes, alter blend weights, change capture content, or brighten/dull materials.
- No IOR, tint, transmission, roughness, thickness, glass silhouette or collision is altered. Live mirror camera/reflection code is untouched.

## Verification and costs

- `node --test qa/glass-normals.test.mjs`: 3/3 pass on shipped assets; 16 straight guard triangles now have normals matching their actual plane (old wrong flat vertices:12); source triangle order, positions, UVs and material identity are retained. Candidate tests cover every side of all four room influence volumes and the actual previously excluded founder glass.
- `node --test qa/material-diagnostics.test.mjs qa/rendering.test.mjs qa/gallery-mirror.test.mjs`: 7/7 pass.
- `node node_modules/typescript/bin/tsc --noEmit`: pass.
- Normal repair measured 7.46 ms once and adds 44,320 bytes of expanded geometry attributes (169,280 →213,600). No added downloads, textures, triangles, draw calls or per-frame normal work. Probe border candidates may add a previously missing environment lookup only where already intended by the existing shader.
- Browser visual verification is owned by the integrating agent. Suggested views: upper founder guard z=-10.985 across x=7.606/11.194 joints; studio gallery guard z=-24.90 across x=8.60/10 joints; curved helical stair guard x≈19,z≈-21; adjacent facade panes across room boundaries. Check Full and No reflections diagnostics, then restore Full. Static probes remain approximations of room reflections; this fix does not promise dynamic avatars in every glass pane.

Rollback snapshots and test log: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/glass-normals-2026-10-28. No browser/native desktop input used by this agent.

## Integrated browser review

Final production build inspected through the site's own debug controls in the in-app browser, without native desktop input. Matched full-quality studio and founder guard views and the existing V17 spiral view were captured before/after. The founder guard no longer bends the room into the exaggerated curved streaks at the central flat pane; adjoining panes now show consistent plane orientation. Studio and spiral views retain clear transmission, thin edges and original scene lighting. Screenshots are under contact-clearance-2026-10-27: glass-studio-before/after.png, glass-founder-before/after.png, glass-v17-before/after.png. The last spiral capture used Auto95% versus100% before; compare reflection geometry, not pixel sharpness. No claim of perfect dynamic reflection equivalence across rooms: the existing static environment probes remain.

## Follow-up user report — unresolved appearance acceptance

The user still reports an apparently missing/weak central studio guard reflection compared with the strongly reflective right return. This appearance complaint is **not fully resolved or accepted**. Follow-up two-sided ray sampling across x=6.1–18.2,z≈-24.9 confirms all straight guard panels are present, closed and use the same source glass material; the 12/14 mm source thickness remains. The right return is perpendicular at x≈18.39, so its viewing-angle/Fresnel response legitimately differs, but that does not by itself establish that the reported image is satisfactory.

Preserve source hard-face normals already aligned with the real pane instead of averaging shallow adjoining cuts into those correct faces. A follow-up test samples the shared-height band y=4.4/4.6 from both sides across each studio join. The initial y=4.0 test sample was below the rising pane bottom at x=6.1 and was corrected; no geometry was added to fill that intentional below-pane area. All four glass tests pass. Further browser comparison/acceptance remains pending; no opacity/tint/roughness changes were made to fake glass visibility.
