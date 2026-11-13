/** Adapter boundary: only the current real runtime may grant entry. */
export function createWorldIntroHost(actions) {
  let revision = 0;
  let subscription = null;
  let scope = null;
  let entered = false;
  let state = { phase: 'boot', readyForEntry: false, lightVersionAvailable: true };
  const same = (a, b) => a && b && ['attemptId', 'destinationId', 'destinationRequestId'].every(key => a[key] === b[key]);
  const publish = () => subscription?.onSnapshot({ ...state, ...subscription.scope });
  const reset = () => {
    revision += 1;
    entered = false;
    state = { phase: 'boot', readyForEntry: false, lightVersionAvailable: true };
  };
  return {
    capabilities: { sound: false, lightModes: ['warm'] },
    setPreferences(preferences, nextScope) {
      if (preferences.destinationId !== 'lounge' || preferences.lightMode !== 'warm' || preferences.soundEnabled) return false;
      scope = { ...nextScope };
      actions.preferences(preferences);
      return true;
    },
    attachToCurrentLoad(request) {
      const current = { scope: { attemptId: request.attemptId, destinationId: request.destinationId, destinationRequestId: request.destinationRequestId }, onSnapshot: request.onSnapshot };
      subscription = current;
      publish();
      return () => { if (subscription === current) subscription = null; };
    },
    retryCurrentLoad() {
      // Invalidate immediately, before React schedules the replacement runtime.
      reset();
      actions.retry();
      return true;
    },
    openLightVersion() { actions.light(); return true; },
    enterDestination(destinationId, preferences, entryScope) {
      if (entered || !state.readyForEntry || destinationId !== 'lounge' || !same(scope, entryScope)) return false;
      // There is no async gap between this check and the actual scene commit.
      if (entryScope.signal.aborted) return false;
      if (actions.enter(preferences, entryScope) === false) return false;
      entered = true;
      return { ok: true, ...entryScope };
    },
    beginLoad() {
      reset();
      const token = revision;
      publish();
      const update = patch => {
        if (token !== revision) return;
        state = { ...state, ...patch };
        publish();
      };
      return {
        progress(value) {
          const label = value.phase.toLowerCase();
          // Existing byte counters describe decompressed fetch streams, not network
          // transfer. Do not turn those or shader counts into a download percentage.
          const phase = /architecture/.test(label) ? 'structure'
            : /finishing/.test(label) ? 'preparing-room'
            : /exploration|texture|reflection/.test(label) ? 'details'
            : /light/.test(label) ? 'light' : 'boot';
          update({ phase, taskLabel: value.phase, readyForEntry: false });
        },
        ready() { update({ phase: 'ready', taskLabel: null, health: 'active', readyForEntry: true }); },
        fail() { update({ phase: 'failed', health: 'failed', readyForEntry: false, canRetry: true, error: { code: 'initialization-failed' } }); },
        cancel() { if (token === revision) revision += 1; },
      };
    },
  };
}
