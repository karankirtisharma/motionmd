/** One chunk is prepared at a time; one small successor may download alongside it.
 * Oversized rooms run alone so two complete GLBs are never staged together. */
export async function loadProgressively<T extends { bytes: number }, V>(
  items: T[], signal: AbortSignal,
  download: (item: T, signal: AbortSignal) => Promise<V>,
  prepare: (item: T, value: V) => Promise<void>,
  budget = 128 * 1024 * 1024,
) {
  const local = new AbortController();
  const abort = () => local.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const start = (item: T) => {
    local.signal.throwIfAborted();
    const pending = download(item, local.signal);
    void pending.catch(() => {});
    return pending;
  };
  let next: Promise<V> | undefined;
  try {
    signal.throwIfAborted();
    for (let i = 0; i < items.length; i++) {
      const item = items[i], value = await (next ?? start(item));
      local.signal.throwIfAborted();
      next = i + 1 < items.length && item.bytes + items[i + 1].bytes <= budget ? start(items[i + 1]) : undefined;
      await prepare(item, value);
      local.signal.throwIfAborted();
      // Let progress, input and cancellation paint between room preparation tasks.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    local.abort(); signal.removeEventListener('abort', abort);
    // Observe the in-flight prefetch after failure/cancellation.
    await next?.catch(() => {});
  }
}
