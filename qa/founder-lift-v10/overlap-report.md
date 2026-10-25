# Lift / terrace overlap correction

The user marked the front-left lift base intersecting the existing terrace. Source measurements established that `FR80 | right paved foundation apron` extends to Blender Y = -0.68 m, while the lift foundation ends at Y = -0.035 m. The terrace therefore occupied approximately 0.645 m of the lift's depth, including the moving cabin undertray.

## Correction

- Cut a fitted recess in that terrace object, X = 12.07–14.62 m, ending at Y = -0.025 m. This provides 10 mm clearance around the foundation, including the junction shown in the screenshot.
- Added a fixed doorway sill ending at Y = -0.145 m. The cabin floor ends at -0.17 m, leaving a 25 mm separation. Both walking surfaces remain at the existing 0.035 m lower stop.
- Replaced the original solid terrace collider with three disjoint convex blocks plus the fitted sill. The cabin's shape, position, travel, door motion and controller remain unchanged.
- Surgically clipped 20 affected source triangles in the browser founder chunk, interpolating all existing vertex attributes, including its texture and baked-lighting UVs. Other material assignments and original binary data remain preserved. Cut-face returns use the existing stone material.

## Verification

- Inspected `blender-junction.png` from a close exterior view of the reported corner.
- Inspected the matching live WebGPU view and saved `browser-junction.png`; no browser console errors were observed. The production build passes.
- All 39 automated checks pass. The new regression raises the cabin, confirms the former overlap area reaches the recessed foundation instead of the old terrace, checks sill height, and verifies the adjacent terrace is unchanged. Existing walk/sprint round trips and lift interlock checks pass.
- `source-preservation.json` confirms that the terrace is the only changed original object compared with the repaired source (in addition to the two existing lift glazing openings). Original geometry, UVs, materials and transforms elsewhere are retained.
- Asset validation succeeds. Its 935.8 MB total includes all retained versions in public/assets; it is not a per-visit download measurement. The replacement founder chunk adds approximately 0.49 MB versus the previous active chunk. Previous v9 assets remain available for rollback.

## Preservation and delivery

Original and previous Blender files remain in their existing directories. This correction is saved separately as `MD_Presentation_Lounge_Glass_Lift.blend`, `Glass_Lift_Asset.blend`, and `MD_Lounge_Sunset_Glass_Lift.blend` in this v10 folder. The previous active manifest and affected test are backed up in `backup/`.

The web manifest uses `public/assets/founder-lift-v10/`. Existing v9 room reflection captures and the building's lighting are retained; this local recess does not introduce a lighting or rendering rewrite. No commit or push was made.
