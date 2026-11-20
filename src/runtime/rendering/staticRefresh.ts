import { Object3D, REVISION, type Material } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

// three r186 RenderObjectRefreshType (src/constants.js).
const NONE = 0, SHARED = 1, FULL = 2;

type RenderRecord = { object: Object3D & { occlusionTest?: boolean }; material: Material & { transmission?: number }; getMonitor(): object };
type NodeManager = {
  needsRefresh(record: RenderRecord): number;
  getNodeFrameForRender(record: RenderRecord): { renderId: number };
};

/** r186 re-evaluates every uniform of every drawn object on every frame as soon as
 * a material carries a custom node or the pass writes motion vectors, which is
 * true for this whole scene. That per-object work, not the graphics card, is what
 * limits the frame rate in wide views (bridge, upper gallery: ~480 draws).
 *
 * The frozen architecture never changes: its world matrix, material values and
 * textures are fixed after loading, and its camera-dependent terms are computed
 * in the shader from shared camera uniforms. For exactly those objects use the
 * renderer's own "static" refresh path: a full refresh the first time (and after
 * every invalidate()), then one shared-uniform refresh per shader per render,
 * and nothing per object. Draw order, culling, pipelines and the image are
 * unchanged. Anything moving, skinned, transparent, transmissive, or with its
 * own per-draw hook (screens, mirror pane) keeps the stock path.
 *
 * Call invalidate() whenever something a frozen object samples is recreated or a
 * frozen material is edited (shadow-map size, drawing-buffer size, diagnostics). */
export function enableStaticRefreshSkip(renderer: WebGPURenderer, isFrozen: (object: Object3D) => boolean) {
  const nodes = (renderer as unknown as { _nodes?: NodeManager })._nodes;
  if (REVISION !== '186' || !nodes?.needsRefresh || !nodes.getNodeFrameForRender) return undefined;
  const stock = nodes.needsRefresh, plainHook = Object3D.prototype.onBeforeRender;
  let epoch = 1;
  const refreshed = new WeakMap<object, number>(), eligible = new WeakMap<object, boolean>(), shared = new WeakMap<object, number>();
  const qualifies = (record: RenderRecord) => {
    const { object, material } = record;
    const own = (object as Object3D & { material?: Material | Material[] }).material;
    return 'isMesh' in object && !('isSkinnedMesh' in object) && isFrozen(object) &&
      object.onBeforeRender === plainHook && object.occlusionTest !== true &&
      // Only the object's own lit material: shadow and other override passes stay stock.
      (Array.isArray(own) ? own.includes(material) : own === material) &&
      // Glass stays on the stock path: its backdrop copy is re-created whenever a render
      // target changes size (the mirror's does, constantly), and a skipped refresh then
      // submits a destroyed texture. Measured: the scene failed validation that way.
      'isNodeMaterial' in material && 'roughness' in material && material.transparent !== true && !(Number(material.transmission) > 0);
  };
  nodes.needsRefresh = function (record: RenderRecord) {
    let fast = eligible.get(record);
    if (fast === undefined) eligible.set(record, fast = qualifies(record));
    if (!fast) return stock.call(this, record);
    if (refreshed.get(record) !== epoch) { refreshed.set(record, epoch); return FULL; }
    // Shared (camera, light, frame) uniforms and frame-scoped node work such as
    // shadow maps and previous-camera matrices still run once per shader per render.
    const monitor = record.getMonitor(), renderId = this.getNodeFrameForRender(record).renderId;
    if (shared.get(monitor) !== renderId) { shared.set(monitor, renderId); return SHARED; }
    return NONE;
  };
  return {
    invalidate() { epoch++; },
    dispose() { nodes.needsRefresh = stock; },
  };
}
