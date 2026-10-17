# Gallery opening and continuous mirror — 17 October 2026

The red-marked library backing, portal separator, shallow head and jamb are removed. The parked glass door and handle are retired with that opening. The adjacent green-marked bronze panel and its joints are replaced by one silvered mirror face, a solid backing and a 20 mm bronze perimeter with restrained bevels. The existing soffit support and balcony safety glass remain.

## Source and rollback

- Editable source (workspace-relative): `outputs/architecture-v21/MD_Presentation_Lounge_v21.blend`.
- Preserved baseline: `outputs/architecture-v19/MD_Presentation_Lounge_v19.blend`.
- Nine retired objects remain in a hidden archive collection in v21.
- Website rollback manifest: `outputs/architecture-v21/base-manifest.json`. Reverting to the previous manifest disables the new mirror because no tagged pane is loaded. Existing baseline assets were not overwritten.
- `change.json` records exact source object names and hashes. `source-fidelity.json` confirms 9,148 retained objects unchanged in geometry, UVs, world transforms and material assignments, with no unexpected object changes. New solids are closed and nondegenerate; the reflective face is intentionally a single quad.

## Website

Only the founder chunk was patched: 684 triangles belonging to the exact retired objects were removed, with no vertex-position changes elsewhere. All nine targets matched by source geometry and material identity. Two collision files changed; the mirror has a dedicated solid collider. The v20 material and lighting assets are retained.

`galleryMirror.ts` renders one HDR planar reflection only while the mirror is visible from its front. It clips at the actual face, supports the existing reversed-depth projection, hides the pane during reflection to avoid recursion, restores renderer state on failure, and caps the reflection target at 1536 pixels on its long edge. No scene geometry is duplicated for the reflection. The debug camera `V21 mirror detail` frames the new wall.

## Verification and limits

- 57/57 automated tests pass, including 15 targeted geometry rays, walk/run traversal through the widened opening in both directions, solid mirror collision, reflection clipping under WebGPU/WebGL depth conventions, and renderer-state restoration.
- Type checking and production build pass. Asset validation finds all 453 required files and 11 geometry chunks.
- `blender-preview.png` is a rendered Blender source preview, not a browser screenshot.
- Live browser inspection was blocked by the browser tool's URL security policy. Actual GPU shader execution, reflection appearance in motion and frame-time impact therefore remain unverified.
- Existing v20 diffuse bakes and local reflection probes remain. A removal-specific indirect-light rebake has not been performed; inspect for residual indirect shading around the widened opening before final visual approval.
- Work is local and has not been committed or pushed this turn.

The reflection implementation was checked against the pinned Three.js r186 source and the [official ReflectorNode documentation](https://threejs.org/docs/pages/ReflectorNode.html). The additional oblique-projection handling preserves the project's reversed-depth setting.
