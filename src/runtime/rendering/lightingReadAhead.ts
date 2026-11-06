export type ReadLightingBytes = (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

/** Start only known, required EXR transfers during room loading. Ready bytes
 * stay encoded until their original consumer needs them. The consumer owns
 * its buffer exclusively (EXR workers transfer and detach it). */
export function createLightingReadAhead(
  sizes: Readonly<Record<string, number>>, fetchBytes: ReadLightingBytes, signal: AbortSignal,
  budget = 32 * 1024 * 1024, concurrency = 2,
) {
  const queued = new Map(Object.entries(sizes).filter(([, bytes]) => bytes > 0 && bytes <= budget));
  const pending = new Map<string, { size: number; bytes: Promise<ArrayBuffer>; request: AbortController }>();
  const cancel = new AbortController();
  let reserved = 0, active = 0;
  function close() {
    signal.removeEventListener('abort', close);
    cancel.abort(signal.reason);
    queued.clear(); pending.clear(); reserved = 0;
  }
  function pump() {
    if (cancel.signal.aborted) return;
    for (const [url, size] of queued) {
      if (active >= concurrency) break;
      if (reserved + size > budget) continue;
      queued.delete(url); reserved += size; active++;
      const request = new AbortController();
      const abortRequest = () => request.abort(cancel.signal.reason);
      cancel.signal.addEventListener('abort', abortRequest, { once: true });
      const bytes = Promise.resolve().then(() => fetchBytes(url, request.signal));
      pending.set(url, { size, bytes, request });
      // Speculation cannot fail the scene. The normal demand path retries a
      // failed speculative request, with the same stall and cancellation policy.
      void bytes.catch(() => {
        if (pending.delete(url)) reserved -= size;
      }).finally(() => {
        cancel.signal.removeEventListener('abort', abortRequest);
        active--; pump();
      });
    }
  }
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) close(); else pump();
  const read: ReadLightingBytes = async (url, consumerSignal) => {
    signal.throwIfAborted(); consumerSignal?.throwIfAborted();
    queued.delete(url);
    const entry = pending.get(url);
    if (!entry) return fetchBytes(url, consumerSignal ?? signal);
    pending.delete(url);
    const abortRequest = () => entry.request.abort(consumerSignal?.reason);
    consumerSignal?.addEventListener('abort', abortRequest, { once: true });
    try {
      const bytes = await entry.bytes;
      consumerSignal?.throwIfAborted();
      return bytes;
    } catch (error) {
      signal.throwIfAborted(); consumerSignal?.throwIfAborted();
      if (cancel.signal.aborted) throw error;
      return fetchBytes(url, consumerSignal ?? signal);
    } finally {
      consumerSignal?.removeEventListener('abort', abortRequest);
      if (!cancel.signal.aborted) reserved -= entry.size;
      pump();
    }
  };
  return { read, close };
}
