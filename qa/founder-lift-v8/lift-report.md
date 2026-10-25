# Compact glass lift — v8

Replaced the v7 exterior staircase and its broad added terrace with a 2.53 × 2.295 m glass lift beside the façade. The presentation-room furniture, screen, columns, mullions and original apron remain in place. A narrow limestone approach uses the existing apron; a small flush upper sill connects to the founder floor.

## Delivered

- Editable source: `MD_Presentation_Lounge_Glass_Lift.blend`.
- Prepared lighting source: `MD_Lounge_Sunset_Glass_Lift.blend`.
- Standalone editable addition: `Glass_Lift_Asset.blend`.
- Browser assets: `../md-lounge-web/public/assets/founder-lift-v8/`.
- Parametric construction, export and source-audit scripts: `../../work/founder-lift-v8/`.
- Original source, v6 repairs and the separate v7 stair version are preserved. Current-turn web backups are in `backup/`; the prior full web backup remains under `../founder-stair-v7/backup/`. No commit or push was made.

The design uses clear glass, fine bronze framing, the existing limestone material, a restrained luminous cabin ceiling, sliding doors and a visible side-mounted hydraulic drive. Floor levels are 0.035 m and 4.23 m. The ram and sheave move half the cabin distance; paired rope lengths maintain a constant total length. The source contains editable mechanism geometry; operational motion is implemented in the web runtime.

## Operation

Walk through the new presentation-room opening and into the cabin. **E** travels to the other floor. At an empty landing, **E** calls the cabin. **V** retains first/third-person switching; normal mouse and movement controls remain available outside travel. Travel takes 8.5 seconds, plus one second for each door operation, using a smooth quintic curve. Movement is held inside the cabin during travel; looking around remains available.

Landing doors block access when the cabin is absent. Departure waits for a clear threshold, and an obstruction reopens the doors. Repeated E input does not enqueue overlapping trips. Menu pause freezes the experience; returning to the cinematic resets the cabin to the lower stop.

## Verification

- Source audit: all **17,602 retained original objects** preserve transforms, mesh coordinates, topology, UV channels and material-slot identities. Exactly two original glass panes, `.030` and `.042`, are replaced by entrances.
- GLB edit removes exactly 24 triangles from the original shell. Its original binary attribute prefix is byte-identical. Other source chunks retain the v6 assets; the v7 stair chunk and stair lightmap are no longer referenced.
- Original Download `.blend`, v6 repaired source and both v7 source files pass SHA-256 preservation checks; see `delivery-audit.json`.
- **38 automated checks pass**, including actual source collision geometry, walk/sprint round trips, remote calls, shaft barriers, doorway obstruction, constant hydraulic cable length and cinematic clearance at both stops.
- The actual interaction controller is exercised at 60, 90, 144 and 165 Hz. Cabin and passenger rendering stay within 2 mm of their initial relative offset, held movement cannot escape during travel, pause/resume preserves height, and walking onto the founder floor works.
- Existing camera, avatar, four-chair, screen, entrance-step, workstation collision, rendering and environment regressions remain covered by the suite.
- TypeScript and Next production build pass. Asset verifier passes: 245 referenced files, approximately 808.7 MB, seven geometry chunks.
- Browser keyboard verification: approach, board, E ascent, upper exit, reboard, E descent and return through the presentation doorway. V switching and menu resume checked. Screenshots are saved alongside this report. Browser logs show existing Three Clock/RGBELoader deprecation warnings, with no new rendering errors observed.
- Cycles exterior render inspected for façade alignment, compact footprint, glass/bronze proportions and the visible hydraulic assembly. Two 2048 × 1024, 128-sample room reflection captures were regenerated from the new prepared scene.

## Targeted fixes discovered during implementation

The initial foundation overlapped the cabin floor, so its top was lowered beneath the cabin undertray before final export. The first kinematic cabin collider produced repeated zero-time floor contacts in Rapier when boarding. The cabin now parks as fixed geometry and switches to a kinematic body only for travel; the global character collision settings are unchanged. A live threshold snag was investigated with temporary contact logging; subsequent full-reload browser round trips succeeded, and temporary logging was removed. A fresh load is required after development edits to an already-created runtime.

## Cost and limitations

The lift adds **6,096 render triangles**, versus 14,996 for the removed stair addition: **59.3% fewer**. Its render GLB is 353,060 bytes, with 19 static collision meshes plus eight runtime box shapes. Manifest-referenced asset size decreases by **8,186,211 bytes** versus v7; retained old assets are not loaded merely because they remain in `public/`.

Local WebGPU observations at the current desktop viewport included roughly 136–165 FPS during the successful traversal, with a short 96 FPS reboarding sample. These are local development observations, not a controlled cross-device speed comparison. The full scene still uses about 2.2 GiB of tracked resources and retains its substantial existing download cost.

The cabin uses live direct lighting and the existing room environment/probe system, rather than a static cabin lightmap. Room probes are precomputed and do not dynamically recapture the moving cabin; glass remains subject to the renderer's transmission limitations. No hardware ray tracing or perfect offline-render equivalence is claimed. This is an architectural interactive visualization, not a construction-certified lift design.

## Recheck

From `outputs/md-lounge-web`: run `npm test`, `npm run verify:assets`, and `npm run build`. Open `http://127.0.0.1:3000/?debug=1`, choose **Test founder-lift movement**, walk forward into the cabin and press E. Check both trips and step off at both floors. Use the `founder-lift-exterior` reference camera to inspect the overall design.
