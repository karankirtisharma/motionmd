# Visitor walk, run and stairs (`locomotion-v16.json`): provenance

`locomotion-v16.json` holds the visitor's walk, run and stair clips. It is loaded next to `RocketboxVisitor.glb`, whose mesh, skin, textures, Idle and Sit stay the Microsoft Rocketbox MIT asset documented in this folder.

| Clip | Source (Adobe Mixamo motion capture, X Bot) | Source FBX SHA-256 |
| --- | --- | --- |
| walk, and every stair clip | Walking | `efd3c17807a2037afeda5affbb792b5616bfa7a9c1242bc4afceefb0784e60c0` |
| run | Running | `540f795cf7b9b056f4f6af32e58058814a4fa902a6af3a35adc5f5c197e3e417` |

These are the same Mixamo source files listed in `Mixamo-PROVENANCE.md`, under the same terms. Adobe's Mixamo FAQ permits royalty-free use in projects; the raw FBX files are not redistributed.

## Processing (scripts/locomotion)

- `sources.mjs` transfers the motion onto the Rocketbox (Bip01) rig. Arms and legs take the capture's rotation changes, applied to the visitor posed like the capture's rest pose. The visitor keeps his own torso posture: spine and neck take the motion on his own rest pose, the collarbones stay at his idle angle, and the gaze stays level.
- `bake.mjs`:
  - Walk and run: travel removed, one cycle from the left heel strike.
  - Stairs: the walk is fitted to each of the building's flights (spiral at 0.8–2.2 m from the column, gallery steps, entrance step; up and down). There is one tread per step, with feet planted on tread centres and the 31 cm shoe kept off the risers.
  - Standing on a flight: per flight and direction, a pose with both shoes flat on their treads (going up, the moment before the front foot lands; going down, the footfall). The walk itself has no moment with both feet down.
- Evaluated and not used: the Quaternius Universal Animation Library (CC0). It is stylised, and its run bounces about 33 cm per stride.
