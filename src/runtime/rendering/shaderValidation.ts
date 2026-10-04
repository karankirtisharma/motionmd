import type { WebGPURenderer } from 'three/webgpu';

type RenderRecord = { pipeline?: object | null; material?: { name?: string } };
const message = 'The graphics device could not prepare this scene. Try reloading in a current browser.';

/** Three r186 resolves compileAsync even when a WebGPU pipeline reports an error. */
export function guardShaderCompilation(renderer: WebGPURenderer, onFailure: (message: string) => void) {
  const records = new Set<RenderRecord>();
  let failed = false, disposed = false;
  const previousBuilder = renderer.debug.onNodeBuilderCreated;
  const previousShaderError = renderer.debug.onShaderError;
  const fail = (detail: unknown) => {
    if (disposed) return;
    console.error('[MD shader validation]', detail);
    if (!failed) { failed = true; onFailure(message); }
  };
  renderer.debug.onNodeBuilderCreated = (builder, object) => {
    previousBuilder?.(builder, object);
    if (object && typeof object === 'object' && 'pipeline' in object) records.add(object as RenderRecord);
  };
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    previousShaderError?.(gl, program, vertex, fragment);
    fail({ renderer: 'WebGL 2', program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment) });
  };
  const device = (renderer.backend as unknown as { device?: EventTarget }).device;
  const onUncaptured = (event: Event) => {
    const error = (event as Event & { error?: { message?: string } }).error;
    fail({ renderer: 'WebGPU', message: error?.message ?? 'Uncaptured GPU validation error' });
  };
  device?.addEventListener('uncapturederror', onUncaptured);

  return {
    assertCompiled() {
      if (!disposed && 'isWebGPUBackend' in renderer.backend) {
        // Narrow, version-pinned check of the error flag Three itself records when
        // createRenderPipelineAsync fails inside its own validation error scope.
        const backend = renderer.backend as unknown as { get(key: object): { error?: boolean } };
        const invalid = [...records].filter(record => record.pipeline && backend.get(record.pipeline).error);
        if (invalid.length) fail({ renderer: 'WebGPU', invalidMaterials: invalid.map(record => record.material?.name ?? '(unnamed)') });
      }
      if (failed) throw new Error(message);
    },
    dispose() {
      if (disposed) return;
      disposed = true; records.clear();
      device?.removeEventListener('uncapturederror', onUncaptured);
      renderer.debug.onNodeBuilderCreated = previousBuilder;
      renderer.debug.onShaderError = previousShaderError;
    },
  };
}
