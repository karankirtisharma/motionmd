type MirrorOptions = {
  source: Element;
  copies: (element: Element) => readonly (Element | undefined)[];
  /** Source geometry may change while a compositor animation runs without mutations. */
  onFrame?: () => void;
};
type Replica = { animation: Animation; owned: boolean };
type Entry = { source: Animation; effect: KeyframeEffect; replicas: Map<Element, Replica>; cancel: () => void };

function cssIdentity(animation: Animation): string | null {
  if ('animationName' in animation) return `animation:${String(animation.animationName)}`;
  if ('transitionProperty' in animation) return `transition:${String(animation.transitionProperty)}`;
  return null;
}

/** Bridge compositor-owned Motion/WAAPI effects that a MutationObserver cannot see.
 * There is still one application: replicas have no listeners or application state.
 * Infinite CSS effects run on native timelines; RAF exists only during discovery
 * or finite active animations, never as a permanent animation poll. */
export function createStudioAnimationMirror({ source, copies, onFrame }: MirrorOptions) {
  const sourceWindow = source.ownerDocument.defaultView;
  if (!sourceWindow) throw new Error('The Studio source window is not available.');
  const entries = new Map<Animation, Entry>();
  let disposed = false, visible = true, frame = 0, discoverFrames = 0;

  function remove(entry: Entry) {
    entry.source.removeEventListener('cancel', entry.cancel);
    entry.source.removeEventListener('finish', refresh);
    for (const { animation, owned } of entry.replicas.values()) if (owned) animation.cancel();
    entries.delete(entry.source);
  }

  function syncClock(original: Animation, replica: Animation) {
    const time = original.currentTime;
    if (time === null) return;
    const rate = original.playbackRate;
    if (replica.playbackRate !== rate) replica.playbackRate = rate;
    // Each iframe DocumentTimeline has its own origin. Copying startTime between
    // documents shifts the animation; preserve elapsed currentTime instead.
    if (visible && original.playState === 'running' && rate !== 0 && typeof time === 'number') {
      const now = replica.timeline?.currentTime;
      if (typeof now === 'number') {
        const start = now - time / rate;
        if (replica.playState !== 'running' || typeof replica.startTime !== 'number' || Math.abs(replica.startTime - start) > 2) {
          replica.startTime = start;
        }
        return;
      }
    }
    if (replica.playState !== 'paused') replica.pause();
    // Repeated hover/state discoveries must not invalidate an already-held
    // compositor effect with the same currentTime on every visual fragment.
    if (replica.currentTime !== time) replica.currentTime = time;
  }

  function attach(entry: Entry) {
    const target = entry.effect.target;
    if (!target) return;
    const identity = cssIdentity(entry.source);
    const targets = new Set(copies(target).filter((copy): copy is Element => !!copy));
    for (const [copy, replica] of entry.replicas) if (!targets.has(copy)) {
      if (replica.owned) replica.animation.cancel();
      entry.replicas.delete(copy);
    }
    for (const copy of targets) {
      let replica = entry.replicas.get(copy);
      if (replica?.animation.playState === 'idle') { entry.replicas.delete(copy); replica = undefined; }
      if (!replica) {
        if (identity) {
          // Stylesheets already create CSS glints/transitions on each copy. Reuse
          // their effects rather than drawing a second animation over the first.
          const existing = copy.getAnimations().find(animation => {
            const effect = animation.effect as KeyframeEffect | null;
            return cssIdentity(animation) === identity && effect?.target === copy && effect.pseudoElement === entry.effect.pseudoElement;
          });
          if (existing) replica = { animation: existing, owned: false };
        } else {
          const animation = copy.animate(entry.effect.getKeyframes(), {
            ...entry.effect.getTiming(),
            composite: entry.effect.composite,
            iterationComposite: entry.effect.iterationComposite,
            pseudoElement: entry.effect.pseudoElement,
          });
          replica = { animation, owned: true };
        }
        if (replica) entry.replicas.set(copy, replica);
      }
      if (replica) syncClock(entry.source, replica.animation);
    }
  }

  function discover() {
    const active = new Set(source.getAnimations({ subtree: true }));
    for (const entry of entries.values()) if (!active.has(entry.source)) remove(entry);
    for (const animation of active) {
      const effect = animation.effect as KeyframeEffect | null;
      if (!effect?.target || !source.contains(effect.target) || typeof effect.getKeyframes !== 'function') continue;
      let entry = entries.get(animation);
      if (!entry) {
        entry = { source: animation, effect, replicas: new Map(), cancel: () => {} };
        const current = entry;
        entry.cancel = () => { remove(current); refresh(); };
        animation.addEventListener('cancel', entry.cancel);
        animation.addEventListener('finish', refresh);
        entries.set(animation, entry);
      }
      attach(entry);
    }
  }

  function finiteActive(entry: Entry) {
    return (entry.source.pending || entry.source.playState === 'running') &&
      Number.isFinite(entry.effect.getComputedTiming().endTime);
  }
  function tick() {
    frame = 0;
    if (disposed || !visible) return;
    if (discoverFrames > 0) { discoverFrames--; discover(); }
    let moving = false;
    for (const entry of entries.values()) {
      if (entry.source.playState === 'idle') { remove(entry); continue; }
      if (finiteActive(entry)) moving = true;
      for (const { animation } of entry.replicas.values()) syncClock(entry.source, animation);
    }
    if (moving) onFrame?.();
    if (moving || discoverFrames > 0) frame = sourceWindow!.requestAnimationFrame(tick);
  }
  function refresh() {
    if (disposed) return;
    // Motion can create its WAAPI effects in the RAF following a React mutation.
    discoverFrames = 2;
    if (visible && !frame) frame = sourceWindow!.requestAnimationFrame(tick);
  }
  refresh();
  return {
    refresh,
    hasActiveAnimations: () => [...entries.values()].some(finiteActive),
    setVisible(next: boolean) {
      if (visible === next || disposed) return;
      visible = next;
      if (!next) {
        sourceWindow.cancelAnimationFrame(frame); frame = 0;
        for (const entry of entries.values()) for (const { animation } of entry.replicas.values()) animation.pause();
      } else refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true; sourceWindow.cancelAnimationFrame(frame); frame = 0;
      for (const entry of entries.values()) remove(entry);
      entries.clear();
    },
  };
}
