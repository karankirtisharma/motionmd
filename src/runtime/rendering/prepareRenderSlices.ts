import type { Material, Object3D, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Prepare visible objects in the actual render context in bounded submissions.
 * Scene visibility and the complete shadow cache remain intact. Post-processing
 * quads must always run: they dispatch the nested main pass on every batch. */
export async function prepareRenderSlices(
  renderer: Pick<WebGPURenderer, 'getRenderObjectFunction' | 'setRenderObjectFunction' | 'renderObject'>,
  scene: Scene, draw: () => Promise<void>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const objects = new Set<Object3D>();
  scene.traverseVisible(object => { if ('isMesh' in object || 'isLine' in object || 'isPoints' in object) objects.add(object); });
  const prepared = new Map<Object3D, Map<Material, Set<string | null>>>();
  const previous = renderer.getRenderObjectFunction();
  let budget = 0, pending = false;
  const submit: NonNullable<typeof previous> = (...args) => {
    const object = args[0], material = args[4], pass = args[8] ?? null;
    if (objects.has(object)) {
      let materials = prepared.get(object);
      if (materials?.get(material)?.has(pass)) return;
      if (budget === 0) { pending = true; return; }
      budget--;
      if (!materials) prepared.set(object, materials = new Map());
      let passes = materials.get(material);
      if (!passes) materials.set(material, passes = new Set());
      // Transmissive double-sided materials use distinct back/front shader keys.
      // Warming just one side leaves an unbounded final-frame compilation burst.
      passes.add(pass);
    }
    if (previous) previous.call(renderer, ...args); else renderer.renderObject(...args);
  };
  renderer.setRenderObjectFunction(submit);
  try {
    do {
      signal?.throwIfAborted(); budget = 4; pending = false;
      await draw();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } while (pending);
    signal?.throwIfAborted();
  } finally { renderer.setRenderObjectFunction(previous); }
}
