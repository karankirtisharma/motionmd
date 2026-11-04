import type { WebGPURenderer } from 'three/webgpu';

/** Only one rendered frame every two seconds writes timestamp queries.
 * Results are resolved asynchronously; rendering never waits for readback. */
export function createFrameMeter(renderer: WebGPURenderer, onGPU?: (ms: number, at: number) => void) {
  // The pinned r186 backend exposes trackTimestamp, omitted from its base d.ts.
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  let supported = renderer.hasFeature('timestamp-query');
  let nextGPU = 0, sampledAt = 0, sampling = false, pending = false, disposed = false;
  let latestGPU: number | undefined;
  let rendered = 0, cpu = 0;
  return {
    beginGPU(now: number) {
      if (!supported || disposed || pending || sampling || now < nextGPU) return;
      sampledAt = now;
      nextGPU = now + 2000;
      sampling = true;
      backend.trackTimestamp = true;
    },
    endGPU() {
      if (!sampling) return;
      sampling = false;
      pending = true;
      const at = sampledAt;
      // The backend checks trackTimestamp before its first await. Disable new
      // timestamp writes while this completed frame's result resolves.
      const read = renderer.resolveTimestampsAsync();
      backend.trackTimestamp = false;
      void read.then(value => {
        if (disposed || value === undefined || !Number.isFinite(value) || value <= 0) return;
        latestGPU = value;
        onGPU?.(value, at);
      }).catch(() => { supported = false; latestGPU = undefined; }).finally(() => { pending = false; });
    },
    frame(ms: number) { rendered++; cpu += ms; },
    snapshot(seconds: number) {
      const value = {
        renderedFps: Math.round(rendered / seconds),
        cpuFrameMs: rendered ? cpu / rendered : undefined,
        gpuDrawMs: rendered ? latestGPU : undefined,
        gpuTimingAvailable: supported,
      };
      rendered = 0; cpu = 0;
      return value;
    },
    dispose() {
      disposed = true;
      if (sampling) backend.trackTimestamp = false;
      sampling = false;
    },
  };
}
