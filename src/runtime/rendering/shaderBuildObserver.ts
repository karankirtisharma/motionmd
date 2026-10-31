import type { WebGPURenderer } from 'three/webgpu';

type BuilderHook = NonNullable<WebGPURenderer['debug']['onNodeBuilderCreated']>;
export type ShaderBuildEvent = { atMs: number; material: string; object: string; shadowPass: boolean };
const DETAIL_LIMIT = 256;

/** Observe the public r186 builder callback without replacing shader validation.
 * This counts node builds and active programs, not GPU pipeline compile duration. */
export function observeShaderBuilds(renderer: WebGPURenderer, now = () => performance.now()) {
  const previous = renderer.debug.onNodeBuilderCreated;
  let disposed = false, capturing = false, totalBuilds = 0, frameBuilds = 0, dropped = 0;
  let events: ShaderBuildEvent[] = [];
  const programCount = () => renderer.info.memory.programs;
  const hook: BuilderHook = (builder, record) => {
    if (!disposed) {
      totalBuilds++;
      if (capturing) {
        frameBuilds++;
        if (events.length < DETAIL_LIMIT) {
          const value = record as { material?: { name?: string; isShadowPassMaterial?: boolean }; object?: { name?: string }; name?: string } | null;
          events.push({ atMs: now(), material: value?.material?.name ?? '(unnamed)', object: value?.object?.name ?? value?.name ?? '(unnamed)', shadowPass: value?.material?.isShadowPassMaterial === true });
        } else dropped++;
      }
    }
    previous?.(builder, record);
  };
  renderer.debug.onNodeBuilderCreated = hook;
  return {
    totals() { return { buildsStarted: totalBuilds, activePrograms: programCount() }; },
    start() { capturing = !disposed; frameBuilds = 0; dropped = 0; events = []; return programCount(); },
    takeFrame() {
      const result = { builds: frameBuilds, events, dropped, activePrograms: programCount() };
      frameBuilds = 0; events = []; dropped = 0;
      return result;
    },
    stop() { capturing = false; frameBuilds = 0; events = []; dropped = 0; },
    dispose() {
      if (disposed) return;
      disposed = true; capturing = false; events = []; frameBuilds = 0; dropped = 0;
      // A later observer may wrap this one. Leave its callback installed; our
      // closed wrapper becomes a pass-through to the original validation hook.
      if (renderer.debug.onNodeBuilderCreated === hook) renderer.debug.onNodeBuilderCreated = previous;
    },
  };
}
