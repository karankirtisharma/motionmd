import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

type Job = { count: number; size: number; source: Uint8Array; mode: string; filter?: string; resolve: (value: Uint8Array) => void; reject: (reason: unknown) => void };
/** Per-load workers: bounded transfer copies, no global pool surviving reload/retry. */
export function createMeshoptDecoder(signal: AbortSignal, workerFactory = () => new Worker(new URL('./meshopt.worker.ts', import.meta.url), { type: 'module' })) {
  const waiting: Job[] = [];
  const slots: Array<{ worker: Worker; job?: Job }> = [];
  let closed = false;
  function dispose(reason: unknown = new DOMException('Geometry decode cancelled', 'AbortError')) {
    if (closed) return;
    closed = true; signal.removeEventListener('abort', abort);
    for (const slot of slots) { slot.job?.reject(reason); slot.job = undefined; slot.worker.terminate(); }
    slots.length = 0;
    for (const job of waiting.splice(0)) job.reject(reason);
  }
  const abort = () => dispose(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (slot.job || !waiting.length) continue;
      const job = slot.job = waiting.shift()!;
      // Copy only when a worker is available, not all 560 MB of studio views at once.
      const source = new Uint8Array(job.source);
      try { slot.worker.postMessage({ count: job.count, size: job.size, source, mode: job.mode, filter: job.filter }, [source.buffer]); }
      catch (error) { dispose(error); }
    }
  }
  function initialize() {
    if (slots.length) return;
    try {
      for (let i = 0; i < 2; i++) {
        const slot: { worker: Worker; job?: Job } = { worker: workerFactory() };
        slots.push(slot);
        slot.worker.onmessage = (event: MessageEvent<{ result?: Uint8Array; error?: string }>) => {
          const job = slot.job;
          if (!job || closed) return;
          if (!event.data.result) { dispose(new Error(event.data.error ?? 'Geometry decode failed')); return; }
          slot.job = undefined; job.resolve(event.data.result); pump();
        };
        slot.worker.onerror = event => dispose(new Error(event.message || 'Geometry worker could not start'));
      }
    } catch (error) { dispose(error); }
  }
  return {
    ...MeshoptDecoder,
    decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: string, filter?: string): Promise<Uint8Array> {
      if (closed || signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Geometry decode cancelled', 'AbortError'));
      if (typeof Worker === 'undefined') return MeshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter);
      initialize();
      if (closed) return Promise.reject(new Error('Geometry worker could not start'));
      const promise = new Promise<Uint8Array>((resolve, reject) => { waiting.push({ count, size, source, mode, filter, resolve, reject }); pump(); });
      void promise.catch(() => {});
      return promise;
    },
    dispose,
  };
}
