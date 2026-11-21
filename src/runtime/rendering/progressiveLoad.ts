/** Keep source preparation ordered. Transfer slots can refill during a parse, but
 * resident buffers (including the item being parsed) count against the same budget. */
export async function loadProgressively<T extends { bytes: number }, V>(
  items: T[], signal: AbortSignal,
  download: (item: T, signal: AbortSignal) => Promise<V>,
  prepare: (item: T, value: V) => Promise<void>,
  budget = 128 * 1024 * 1024,
) {
  const local = new AbortController();
  const abort = () => local.abort(signal.reason);
  const pending = new Map<number, Promise<V>>();
  let next = 0, active = 0, reserved = 0, downloadFailed = false;
  function fill() {
    while (!local.signal.aborted && !downloadFailed && active < 2 && next < items.length) {
      const item = items[next];
      // An oversized room can start on its own. Never admit a neighbour until it is released.
      if (pending.size && reserved + item.bytes > budget) break;
      reserved += item.bytes;
      active++;
      const transfer = (async () => download(item, local.signal))();
      pending.set(next++, transfer);
      void transfer.then(() => { active--; fill(); }, () => { active--; downloadFailed = true; });
    }
  }

  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    fill();
    for (let i = 0; i < items.length; i++) {
      const value = await pending.get(i)!;
      local.signal.throwIfAborted();
      await prepare(items[i], value);
      local.signal.throwIfAborted();
      pending.delete(i);
      reserved -= items[i].bytes;
      fill();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    local.abort();
    signal.removeEventListener('abort', abort);
    await Promise.allSettled(pending.values());
  }
}
