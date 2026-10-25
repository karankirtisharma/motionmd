# Detailed glass spiral — v17, 11 October 2026

## Delivered
- Source: `outputs/architecture-v17/MD_Presentation_Lounge_v17.blend` (workspace-relative). Prepared export source beside it. Prior v16 remains unchanged; hashes in source-hashes.json. Earlier concrete v15 backup is also retained.
- 23 treads with original top elevations and annular footprint. Each curved edge has 64 segments; treads are 64 mm thick with 2.5 mm four-segment bevels and two visible edge lamination lines.
- Separate low-iron glass faces and lightly green polished edge material. Champagne radial shoes, silicone pads, four small support fasteners per tread, 256-sided center column and collars. Old luminous strips archived, not superimposed on the new glass.
- New glass collection remains editable. Previous three stair objects are archived in source. Export explicitly evaluates bevel/weld modifiers before joining, preserving detail.
- Only the revised architecture GLB changes: 7,871,776 bytes. Other geometry, textures, collision files and lighting URLs remain intact. Lossless Meshopt byte compression retains source floats.

## Evidence and verification
- The user's localhost tab initially retained the older concrete model; refreshed the actual user tab to the current manifest, then verified v17 in WebGPU.
- Evaluated geometry: 23 glass treads + landing and short-step shell; all 25 objects have positive volume, zero nonmanifold edges and zero degenerate faces. Weld removes microscopic bevel slivers.
- 49 automated tests pass, including original spiral ascent/descent at walk/run speeds. Collision route unchanged. No new full-app build claimed for this asset-only refinement.
- Decoded web floor-junction grid: zero competing top surfaces; 20 marble top samples, maximum height error 1.907e-7 m. 135 Meshopt views use no lossy filter. Glass transmission extension verified.
- Source Blender render of the marked junction shows continuous marble walking surfaces and limestone risers, without the old skinny surface overlap. The unified closed shell introduced in v16 is retained in v17. We cannot establish which older .blend was shown in the user's screenshot.
- Broader source sampling lists glass/frame contacts and two millimetre-separated gallery finishes outside the marked junction; these are recorded, not silently described as globally fixed.
- Dependency closure: 107 referenced assets including retained historical metadata URLs, 850,881,304 bytes. Eight geometry chunks total 10,729,015 triangles (+240,832 from v16; ~2.3%). This is increased detail, not a claimed performance improvement.

## Limits and rollback
Existing v16 diffuse bakes and earlier reflection captures remain. Small support/nosing changes were not rebaked into static GI; live material reflections remain active. Browser raster transmission differs from Cycles, especially with multiple glass layers. No structural safety certification is implied by this visualization. Cross-device performance is untested.

Restore `outputs/architecture-v17/rollback-v16-manifest.json` to the app's `public/assets/scene-manifest.json` and reload to roll back the web scene. Open preserved v16 source to roll back Blender. Do not delete prior assets or commit/push without authorization.

## Visual references
Laminated treads and discreet supports informed by [Marretti Skywalk](https://www.marretti.com/staircases/glass-steps-spiral-staircase-skywalk/) and [Siller glass stairs](https://www.stairs-siller.com/glass-staircases). These are design references, not copied project geometry or evidence of this model's engineering validity.

Browser verification: WebGPU detailed-stair reference view shows the new glass, green edges and support hardware. Browser error log returned no errors. The user resumed moving through the scene during final checks, so no additional scripted camera motion was forced. Saved stair proof: outputs/architecture-v17/web-stair-detail.png; Blender source floor proof: outputs/architecture-v17/junction.png. Stills and geometry checks do not certify elimination of every temporal artifact elsewhere.
