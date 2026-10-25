# Presentation-to-founder courtyard stair

Implemented in the editable Blender scene and the live website. The route exits the presentation room through a framed double doorway, climbs two flights around a landing, and enters the founder floor through a new single doorway.

## Architectural changes

- Two 1.60 m wide flights, 26 risers, approximately 161 mm rise and 320 mm going; finished levels 0.035 m and 4.23 m.
- A 1.60 m deep turning landing, upper arrival landing, limestone forecourt and two desert approach treads.
- Original limestone and satin-bronze material identities, clear glass guards, bronze cap rails, restrained emissive reveals and grounded structural supports.
- A guard across the central stairwell, connected handrail transitions and physical underside collision.
- Fixed sidelights/transoms and permanently parked open door leaves. These doors are architectural openings; opening/closing animation is not part of this addition.

The addition occupies the exterior front bay between existing columns. The presentation screen, four chairs, table, structural columns, beams and original interior layout were preserved.

## Preservation and files

`MD_Presentation_Lounge_Founder_Stair.blend` is the editable source. `MD_Lounge_Sunset_Founder_Stair.blend` is the prepared scene for future baking. `Founder_Stair_Asset.blend` contains the owned addition and its collision collection. The generator and export/bake scripts are in `../../work/founder-stair-v7/` relative to this report.

The downloaded original and both v6 working sources have verified unchanged hashes. The pre-change website ZIP and source copies are in `backup/`. Source comparison verified 17,600 retained objects' transforms, mesh positions, topology indices, UV channels and material-slot identities. Only three specified glazing panes and one mullion were removed. See `source-preservation.json` for their identities.

The web shell received a surgical 224-triangle aperture edit. The complete original binary attribute payload remains byte-identical; remaining geometry, normals, UVs and textures were not re-exported. Other existing render chunks remain intact.

## Lighting and performance

The new limestone uses a separate 2048², 256-sample Cycles bake containing indirect diffuse and direct practical lighting, excluding base color and direct sunlight. Chart-border-preserving OIDN denoising retains the raw bake and source surface textures. The existing live sun supplies direct light. Adjacent lounge/founder reflection captures were regenerated at 2048×1024 and 128 samples.

The addition has 14,996 render triangles grouped into five material meshes, 81 simple physical parts and no new realtime lights. The net change in manifest-referenced asset bytes is 8,604,758 bytes (about 8.6 MB), including replacement captures. Public storage is larger because superseded assets are retained; that does not make the browser load them.

The complete collider set has 729 meshes and 252,152 triangles. Six local movement trials, with the first discarded, averaged 0.0818 ms per physics step. This is CPU collision timing, not a claim of improved whole-scene FPS.

During final WebGPU traversal the diagnostic display showed roughly 95–118 FPS at 100% resolution, with sampled p95 frame times around 10–14 ms. These are local observations, not a controlled before/after benchmark or a mobile guarantee. WebGL 2 loaded and rendered the new assets without console errors; its adaptive resolution was reduced while other GPU jobs/tabs were active, so those timings are not comparable. Existing memory use remains around 2.1 GiB.

## Verification

- **36 automated tests passed**, including existing furniture, entrance, character, camera, interaction, lighting and runtime regressions.
- New actual-asset tests cover all 26 tread support heights, vertical headroom, both portals, walking and sprinting up/down, the turning landing, outer and central-well guards, and 2,001 cinematic-camera clearance samples against the new geometry.
- Actual keyboard traversal completed from presentation room to founder interior in the browser. Both WebGPU and WebGL 2 rendered the addition. No new browser console errors were observed; existing Three.js loader/clock deprecation warnings remain.
- TypeScript passed; an isolated Next webpack production build passed; final asset verification resolved 239 public files and seven geometry chunks.
- Real Blender renders reviewed: exterior, presentation doorway, upstairs view; final exterior re-rendered from the saved source. Live browser screenshots are alongside this report.

Existing room GI atlases remain intact; only the new stair diffuse bake and adjacent reflection captures changed. Reflections retain the existing static-probe approximation rather than dynamic ray tracing. Mobile devices and a hosted Vercel deployment were not tested in this local change.

Open `http://127.0.0.1:3000/?debug=1` and choose `founder-stair-exterior` under Reference camera, or **Test founder-stair movement** to start beside the new presentation doorway. Normal exploration reaches the same route physically.

No commit or push was made. The existing dev server remains running.
