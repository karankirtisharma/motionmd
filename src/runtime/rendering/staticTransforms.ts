import { Object3D } from 'three';

/** Cache only the explicitly immutable architectural tree after source repairs and
 * interactive extraction. World transforms of runtime lift and authored-animation
 * subtrees remain live. Call restore before changing a cached node's transform. */
export function freezeArchitectureTransforms(root: Object3D, animatedRoots: Object3D[] = []) {
  const excluded = new Set(animatedRoots);
  const frozen = new Set<Object3D>();
  const saved: Array<{ object: Object3D; local: boolean; world: boolean }> = [];
  root.updateWorldMatrix(true, true);
  function visit(object: Object3D) {
    if (excluded.has(object) || object.userData.liftRole || 'isSkinnedMesh' in object || 'isBone' in object || object.animations.length) return;
    frozen.add(object);
    saved.push({ object, local: object.matrixAutoUpdate, world: object.matrixWorldAutoUpdate });
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    for (const child of object.children) visit(child);
  }
  visit(root);
  return {
    count: saved.length,
    has: (object: Object3D) => frozen.has(object),
    restore() {
      for (const entry of saved) {
        entry.object.matrixAutoUpdate = entry.local;
        entry.object.matrixWorldAutoUpdate = entry.world;
        entry.object.matrixWorldNeedsUpdate = true;
      }
      saved.length = 0;
      frozen.clear();
    },
  };
}
