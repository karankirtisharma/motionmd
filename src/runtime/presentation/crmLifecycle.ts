/** Host-owned idle timer: the supplied CRM idle mode otherwise restarts its
 * tour even while seated/hidden. No frame loop, remounts, or route restoration. */
export function createCrmLifecycle(options: {
  tour: (on: boolean) => void;
  pause: (paused: boolean) => void;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current = '', touring = false, disposed = false;
  function stop() {
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    if (touring) { touring = false; options.tour(false); }
  }
  return {
    update(ready: boolean, visible: boolean, seated: boolean) {
      if (disposed) return;
      const state = !ready ? 'loading' : !visible ? 'hidden' : seated ? 'seated' : 'idle';
      if (state === current) return;
      const stoodUp = current === 'seated' && state === 'idle';
      current = state;
      stop();
      if (!ready) return;
      options.pause(!visible);
      if (state === 'idle') {
        const start = () => { timer = undefined; if (!disposed && current === 'idle') { touring = true; options.tour(true); } };
        // Preserve the explicit stand-up contract; initial visibility waits 40s.
        if (stoodUp) start(); else timer = schedule(start, 40000);
      }
    },
    dispose() { if (disposed) return; disposed = true; stop(); },
  };
}
