import { prepareRenderAsync } from './prepareRenderAsync.ts';
import type { Material, Object3D, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Prepare visible objects in the actual render context in bounded submissions.
 * Scene visibility and the complete shadow cache remain intact. Post-processing
 * quads must always run: they dispatch the nested main pass on every batch. */
export async function prepareRenderSlices(
  renderer: Pick<WebGPURenderer, 'getRenderObjectFunction' | 'setRenderObjectFunction' | 'renderObject'>,
  scene: Scene, draw: (submit: NonNullable<ReturnType<WebGPURenderer['getRenderObjectFunction']>>) => Promise<void>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const forward: NonNullable<ReturnType<WebGPURenderer['getRenderObjectFunction']>> = (...args) => renderer.renderObject(...args);
  if (await prepareRenderAsync(renderer as WebGPURenderer, () => draw(forward), signal)) return;
  const objects = new Set<Object3D>();
  scene.traverseVisible(object => { if ('isMesh' in object || 'isLine' in object || 'isPoints' in object) objects.add(object); });
  type PreparedObjects = Map<Object3D, Map<Material, Set<string | null>>>;
  const contexts = new Map<object | null, Map<object | null, PreparedObjects>>();
  const previous = renderer.getRenderObjectFunction();
  let budget = 0, pending = false;
  const submit: NonNullable<typeof previous> = (...args) => {
    const object = args[0], material = args[4], pass = args[8] ?? null;
    if (objects.has(object)) {
      // r186 gives each nested render context its own clipping context. The
      // same mesh in TRAA's resolve and outer coverage pass needs both keys.
      // Use the dispatched context/lights identities, without renderer internals.
      const clipping = args[7] ?? null, lights = args[6] ?? null;
      let contextsForLights = contexts.get(clipping);
      if (!contextsForLights) contexts.set(clipping, contextsForLights = new Map());
      let prepared = contextsForLights.get(lights);
      if (!prepared) contextsForLights.set(lights, prepared = new Map());
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
      await draw(submit);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } while (pending);
    signal?.throwIfAborted();
  } finally { renderer.setRenderObjectFunction(previous); }
}
