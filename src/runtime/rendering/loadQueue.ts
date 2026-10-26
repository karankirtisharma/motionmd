/** Bound decode/download concurrency without changing application order. Errors stay on
 * the returned promise; a queued rejection cannot become an unhandled rejection. */
export function createLoadQueue(limit = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  function pump() { while (active < limit && waiting.length) waiting.shift()!(); }
  return function enqueue<T>(load: () => Promise<T>): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        active++;
        Promise.resolve().then(load).then(resolve, reject).finally(() => { active--; pump(); });
      });
      pump();
    });
    void promise.catch(() => {});
    return promise;
  };
}
