/** Isolate fast-changing timeline values from the whole lounge React tree. */
export function createTourProgressStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    getServerSnapshot: () => 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: number) {
      if (!Number.isFinite(next)) return;
      next = Math.max(0, Math.min(1, next));
      if (value === next) return;
      value = next; listeners.forEach(listener => listener());
    },
  };
}
export type TourProgressStore = ReturnType<typeof createTourProgressStore>;
