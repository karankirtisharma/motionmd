/** Recover a failed native app boot without per-frame work or remounting a
 * working document. iframe load alone does not mean its JS app initialized. */
export function createFrameReadiness(options: {
  load: (attempt: number) => void;
  exhausted: () => void;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0, complete = false, disposed = false;
  function clear() { if (timer !== undefined) cancel(timer); timer = undefined; }
  function arm(ms: number) {
    clear();
    const current = attempt;
    timer = schedule(() => {
      timer = undefined;
      if (disposed || complete || current !== attempt) return;
      if (attempt < 3) load(); else options.exhausted();
    }, ms);
  }
  function load() {
    ++attempt;
    arm(30000);
    options.load(attempt);
  }
  return {
    start() { if (!disposed && !attempt) load(); },
    // Module requests settle before iframe load. Allow React effects to send
    // md:ready, then recover if a failed module left only an empty root behind.
    loaded() { if (!disposed && !complete && attempt) arm(2000); },
    ready() { if (disposed) return; complete = true; clear(); },
    dispose() { disposed = true; clear(); },
  };
}
