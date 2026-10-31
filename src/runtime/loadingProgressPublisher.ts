import type { LoadingProgress } from '../types';

type Timer = ReturnType<typeof setTimeout>;
type Scheduler = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => Timer;
  cancel: (timer: Timer) => void;
};
const browserScheduler: Scheduler = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: timer => clearTimeout(timer),
};

/** Bound only UI publication, not the download/compile work that reports it.
 * Phase changes stay immediate; a burst retains its latest exact value.
 */
export function createLoadingProgressPublisher(
  publish: (value: LoadingProgress) => void,
  intervalMs = 100,
  scheduler: Scheduler = browserScheduler,
) {
  let disposed = false;
  let timer: Timer | undefined;
  let pending: LoadingProgress | undefined;
  let previous: LoadingProgress | undefined;
  let publishedAt = -Infinity;
  function cancelTimer() {
    if (timer !== undefined) scheduler.cancel(timer);
    timer = undefined;
  }
  function deliver(value: LoadingProgress) {
    cancelTimer();
    pending = undefined;
    previous = value;
    publishedAt = scheduler.now();
    publish(value);
  }
  function flush() {
    cancelTimer();
    if (!disposed && pending) deliver(pending);
  }
  return {
    push(value: LoadingProgress) {
      if (disposed) return;
      if (previous?.phase === value.phase && previous.detail === value.detail && previous.progress === value.progress) {
        pending = undefined;
        cancelTimer();
        return;
      }
      const snapshot = { ...value };
      const elapsed = scheduler.now() - publishedAt;
      if (!previous || previous.phase !== value.phase || value.phase === 'Ready' || elapsed >= intervalMs) {
        deliver(snapshot);
      } else {
        pending = snapshot;
        if (timer === undefined) timer = scheduler.schedule(flush, intervalMs - elapsed);
      }
    },
    flush,
    dispose() { disposed = true; pending = undefined; cancelTimer(); },
  };
}
