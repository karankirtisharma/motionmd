import { createLoaderController, getLoadScope } from './loader-controller.mjs';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const LOAD_SCOPE_FIELDS = ['attemptId', 'destinationId', 'destinationRequestId'];
const ENTRY_SCOPE_FIELDS = [...LOAD_SCOPE_FIELDS, 'entryRequestId'];

function sameScope(a, b) {
  return LOAD_SCOPE_FIELDS.every((field) => a[field] === b[field]);
}

function matchesAcknowledgement(acknowledgement, scope) {
  if (acknowledgement === true) return true;
  if (!acknowledgement || typeof acknowledgement !== 'object'
    || Array.isArray(acknowledgement) || acknowledgement.ok === false) return false;
  return ENTRY_SCOPE_FIELDS.every((field) => !own(acknowledgement, field)
    || acknowledgement[field] === scope[field]);
}

/**
 * Adapter boundary for connecting the supplied controller to real host loading.
 * A host task retains the attempt and destination request IDs it started with.
 * An entry operation must honor its AbortSignal before transferring world/input
 * ownership. This adapter sends an abort when the entry request becomes stale.
 */
export function connectLivingMaquette(host, initialPreferences = {}) {
  let activeSubscription = null;
  let disposed = false;
  let pendingEntry = null;
  let entryRequestId = 0;
  let entered = false;

  const controller = createLoaderController({
    initialPreferences,
    hooks: {
      onPreferencesChange: syncPreferences,
      async onRetry(request) {
        if (disposed) return false;
        cancelInvalidEntry();
        detach();
        const accepted = await host.retryCurrentLoad(request);
        if (accepted === false) return false;
        if (!disposed && controller.getSnapshot().attemptId === request.attemptId) attach(request.attemptId);
      },
      onLightVersion: (request) => disposed ? false : host.openLightVersion(request),
      onCallbackError: (error, source) => host.onCallbackError?.(error, source),
    },
  });

  function detach() {
    const subscription = activeSubscription;
    activeSubscription = null;
    subscription?.unsubscribe?.();
  }

  function attach(attemptId) {
    const snapshot = controller.getSnapshot();
    if (disposed || snapshot.attemptId !== attemptId) return;
    const subscription = { unsubscribe: null };
    activeSubscription = subscription;
    try {
      const unsubscribe = host.attachToCurrentLoad({
        ...getLoadScope(snapshot),
        preferences: snapshot.preferences,
        onSnapshot(patch) {
          if (disposed || activeSubscription !== subscription) return false;
          if (!patch || typeof patch !== 'object') throw new TypeError('Host snapshot must be an object');
          // An isolated subscription may supply its captured attempt as a default.
          // An explicitly different origin must be rejected, never relabelled.
          if (own(patch, 'attemptId')) {
            if (patch.attemptId !== attemptId) return false;
            return controller.updateHost(patch);
          }
          return controller.updateHost({ ...patch, attemptId });
        },
      });
      if (typeof unsubscribe !== 'function') throw new TypeError('Host attachment must return an unsubscribe function');
      subscription.unsubscribe = unsubscribe;
      if (activeSubscription !== subscription || disposed) unsubscribe();
    } catch (error) {
      if (activeSubscription === subscription) activeSubscription = null;
      throw error;
    }
  }

  function syncPreferences(preferences, scope) {
    if (disposed) return false;
    cancelInvalidEntry();
    function acknowledged(accepted) {
      if (accepted === false) return false;
      const snapshot = controller.getSnapshot();
      if (!activeSubscription && !snapshot.retryPending && sameScope(scope, getLoadScope(snapshot))) {
        attach(scope.attemptId);
      }
      return accepted;
    }
    const response = host.setPreferences(preferences, scope);
    if (response && typeof response.then === 'function') {
      return Promise.resolve(response).then(acknowledged);
    }
    return acknowledged(response);
  }

  function cancelInvalidEntry() {
    if (!pendingEntry) return;
    const snapshot = controller.getSnapshot();
    if (!snapshot.canEnter || !sameScope(pendingEntry.scope, getLoadScope(snapshot))) {
      pendingEntry.abortController.abort();
    }
  }

  const stopWatchingEntry = controller.subscribe(cancelInvalidEntry, { emitCurrent: false });

  function reportCallbackError(error, source) {
    try {
      const result = host.onCallbackError?.(error, source);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch {
      // A failing diagnostic must leave startup and cleanup usable.
    }
  }

  function reportStartupFailure(error, scope) {
    if (disposed || !sameScope(scope, getLoadScope(controller.getSnapshot()))) return;
    controller.updateHost({
      ...scope,
      phase: 'failed',
      health: 'failed',
      error: { code: 'initialization-failed' },
      canRetry: typeof host.retryCurrentLoad === 'function',
    });
    reportCallbackError(error, 'initialization');
  }

  const initial = controller.getSnapshot();
  const initialScope = getLoadScope(initial);
  try {
    const response = syncPreferences(initial.preferences, initialScope);
    if (response === false) reportStartupFailure(new Error('Host declined initial preferences'), initialScope);
    else if (response && typeof response.then === 'function') {
      Promise.resolve(response).then((accepted) => {
        if (accepted === false) reportStartupFailure(new Error('Host declined initial preferences'), initialScope);
      }, (error) => reportStartupFailure(error, initialScope));
    }
  } catch (error) {
    reportStartupFailure(error, initialScope);
  }

  return {
    controller,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWatchingEntry();
      pendingEntry?.abortController.abort();
      try {
        detach();
      } catch (error) {
        reportCallbackError(error, 'dispose');
      }
    },
    async requestEntry() {
      const snapshot = controller.getSnapshot();
      if (disposed || entered || !snapshot.canEnter || (pendingEntry && !pendingEntry.scope.signal.aborted)) return false;
      const abortController = new AbortController();
      const scope = Object.freeze({
        ...getLoadScope(snapshot), entryRequestId: ++entryRequestId, signal: abortController.signal,
      });
      const operation = { scope, abortController };
      pendingEntry = operation;
      let onAbort;
      const aborted = new Promise((resolve) => {
        onAbort = () => resolve(false);
        scope.signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const acknowledgement = await Promise.race([
          host.enterDestination(snapshot.preferences.destinationId, snapshot.preferences, scope),
          aborted,
        ]);
        const current = controller.getSnapshot();
        if (disposed || scope.signal.aborted || pendingEntry !== operation || !current.canEnter
          || !sameScope(scope, getLoadScope(current)) || !matchesAcknowledgement(acknowledgement, scope)) return false;
        entered = true;
        return acknowledgement;
      } catch (error) {
        if (scope.signal.aborted) return false;
        throw error;
      } finally {
        scope.signal.removeEventListener('abort', onAbort);
        if (pendingEntry === operation) pendingEntry = null;
      }
    },
  };
}
