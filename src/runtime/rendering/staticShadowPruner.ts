import type { Object3D } from 'three';

/** Only the same proven-immutable membership used by the static shadow cache.
 * Hiding maximal complete branches prevents the renderer from building a second
 * render list for architecture that its dynamic-shadow callback would discard.
 * Mixed ancestors remain visible so lift, rig and other moving children survive.
 * Rebuild after static-scene invalidation; never use this for a main/mirror pass. */
export function createStaticShadowPruner(scene: Object3D, isStatic: (object: Object3D) => boolean) {
  const branches: Object3D[] = [];
  let renderables = 0;
  function visit(object: Object3D): boolean {
    const start = branches.length;
    // Never remove scene services even if a source exporter marked their parent
    // immutable. The directional light and its target normally live outside it.
    let complete = isStatic(object) && !('isLight' in object) && !('isCamera' in object);
    for (const child of object.children) if (!visit(child)) complete = false;
    if (complete) {
      branches.length = start;
      branches.push(object);
      if ('isMesh' in object || 'isLine' in object || 'isPoints' in object || 'isSprite' in object) renderables++;
    }
    return complete;
  }
  visit(scene);
  const visibility = branches.map(() => false);
  let hidden = false;
  return {
    get branchCount() { return branches.length; },
    get renderableCount() { return renderables; },
    hide() {
      if (hidden) throw new Error('Static shadow pruning cannot overlap render passes.');
      hidden = true;
      for (let i = 0; i < branches.length; i++) {
        visibility[i] = branches[i].visible;
        branches[i].visible = false;
      }
    },
    restore() {
      if (!hidden) return;
      for (let i = 0; i < branches.length; i++) branches[i].visible = visibility[i];
      hidden = false;
    },
  };
}
