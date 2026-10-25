# v19 founder landing connection

Architecture correction, 15 October 2026. GitHub publication authorized by the user; native Blender sources and rollback copies remain local.

## Scope

The marked cream wall was `EH52 east vestibule rear jamb`. The subsequent cyan-circled thin frame was `Front wing curtain wall mullion.027`. Both are retired in the editable Blender derivative and removed from the website geometry. The bronze `FR46 gallery soffit support` at the intended railing endpoint remains.

The curved landing now joins the founder gallery at that support. Crossing guard glass and rail were removed, with the retained guard trimmed to the new opening. The slab and collision surface share the same geometry. Original simple low-iron glass, bronze and marble are retained, including the separate v17 glass spiral. Other rooms and interactions are unchanged.

## Source and rollback

Workspace-relative locations:

- Editable source: `outputs/architecture-v19/MD_Presentation_Lounge_v19.blend`
- Bake copy: `outputs/architecture-v19/MD_Lounge_Sunset_v19_prepared.blend`
- Preserved source: `outputs/architecture-v18/MD_Presentation_Lounge_v18.blend`
- Frozen website rollback: `outputs/architecture-v19/rollback-v18-manifest.json`
- Modeling, audit, render and export scripts: `work/architecture-v19/`

v18 SHA256: `68aac8e252ca8557eb92d6039f86d43426f69f260949f3478b1673f9866a8c17`.
The source audit compares native vertex positions, topology, UVs, material assignments and world matrices: 9,151 retained objects unchanged, eight retired, six added, no unexpected changes. All new solids are closed and nondegenerate. This is not a comparison of every possible modifier or rendered pixel.

The source pipeline order is `edit.py`, `weld-source-rail.py`, then `remove-mullion.py`. Do not rerun setup generators over the final scripts; their original templates predate the last steering. The saved v19 source is authoritative. Targeted ownership matching removes retired faces from existing chunks; new geometry uses lossless Meshopt attribute compression. Twelve affected GI atlases across seven groups are rebaked at 256 Cycles samples, then denoised with protected UV borders. The new PBR atlas is 4096px UASTC KTX2 with mipmaps.

## Verification

Final results are recorded below. Existing sunset reflection captures remain; this task does not claim a new reflection capture or a full structural engineering assessment. Browser verification is on the available desktop GPU; mobile and other GPU configurations need separate validation.

Run from the app:

```powershell
npm test
npm run build
node qa/architecture-v19/audit-slab.mjs
node qa/architecture-v19/audit-camera.mjs
node qa/architecture-v19/probe-surfaces.mjs
node qa/architecture-v19/audit-precision.mjs
node qa/architecture-v19/audit-assets.mjs
node qa/architecture-v19/audit-opening.mjs
```

Debug reference cameras: **V19 founder connection** and **V19 joined landing reverse**. Select **Tour** to restore the normal camera.

## Final automated results

| Check | Result |
|---|---|
| Automated tests | 51 passed, 0 failed |
| Landing/support/walk/sprint/guard checks | 44 passed |
| New founder opening | Walk and sprint both directions; 20 visual geometry rays clear |
| Source topology | New solids closed, no degenerate faces |
| Export ownership | All eight targeted objects matched |
| Surface overlap | 0 competing area samples; 126 new-join height samples |
| Marble height fidelity | 40 samples, max error 0.0000002 m |
| Cinematic sweep | 9,000 samples, 0 intersections |
| Asset closure | 120 dependencies present; chunk byte lengths and hashes valid |
| Production build / TypeScript | Passed |

The final browser check exposed remaining wall faces in the old entrance GLB: some corner positions differ from the native source by up to 3.262 mm. The initial 60-micrometre ownership matcher missed these. A fallback restricted to the retired jamb's material and eight corner positions removes those faces, without broad bounding-box deletion. The bake-prepared mesh had already removed all six jamb faces, so its lighting did not require another bake. The opening-ray regression now checks the delivered geometry as well as collision clearance.

Total scene geometry: 10,742,670 triangles (675 fewer than v18). No performance improvement is claimed from this small change. The new v19 chunk is 494,872 bytes. Existing renderer deprecation warnings remain outside this architectural correction.

## Browser review

Final v19 WebGPU views inspected from both sides after the export correction: the wall and circled frame are absent, the retained bronze support remains, and the connected floor is visible. Page error logs returned an empty list. Movement verification is the automated full-capsule walk/sprint suite; no new manual traversal is claimed. Existing THREE.Clock/RGBELoader deprecation warnings remain.

![Corrected live browser opening](browser-junction.png)
