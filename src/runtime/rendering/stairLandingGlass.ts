import { BufferGeometry, Float32BufferAttribute, Mesh, type Object3D } from 'three';

// Exact closed source pane from WG53 raised studio void guard glass in
// architecture-v18_collision_architecture-v16_collision_additional-solids.glb.
// The visual export omitted this upper-landing span; its collision already exists.
const positions = [
  3.5999999046325684, 4.257999897003174, -24.856000900268555,
  3.5999999046325684, 4.257999897003174, -24.8439998626709,
  6, 4.230000019073486, -24.893999099731445,
  6, 4.230000019073486, -24.9060001373291,
  3.5999999046325684, 5.357999801635742, -24.856000900268555,
  3.5999999046325684, 5.357999801635742, -24.8439998626709,
  6, 5.329999923706055, -24.893999099731445,
  6, 5.329999923706055, -24.9060001373291,
];
const indices = [1, 3, 2, 1, 0, 3, 6, 1, 2, 6, 5, 1, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 7, 4, 5, 7, 5, 6, 5, 4, 0, 5, 0, 1];
export const STAIR_LANDING_GUARD_NAME = 'Restored_WG53_raised_studio_void_guard_glass';

/** Restore only the omitted landing pane. The adjoining slope/curved guard,
 * source glass factors and existing source collision remain unchanged. */
export function restoreStairLandingGlass(root: Object3D) {
  if (root.getObjectByName(STAIR_LANDING_GUARD_NAME)) return 0;
  const source = root.getObjectByName('WEB_v13_architecture_14');
  if (!(source instanceof Mesh) || !source.parent || Array.isArray(source.material) || source.material.name !== 'v13__Low iron glass | 12 mm') return 0;
  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new Float32BufferAttribute(positions, 3));
  indexed.setIndex(indices);
  // Separate broad faces from the 12 mm edges to keep planar reflections.
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const pane = new Mesh(geometry, source.material);
  pane.name = STAIR_LANDING_GUARD_NAME;
  pane.userData.sourceName = 'WG53 raised studio void guard glass';
  pane.userData.mdRestoredGuardGlass = true;
  pane.userData.castShadow = false;
  // Source coordinates share the merged v13 primitive's space.
  pane.position.copy(source.position);
  pane.quaternion.copy(source.quaternion);
  pane.scale.copy(source.scale);
  source.parent.add(pane);
  return 1;
}
