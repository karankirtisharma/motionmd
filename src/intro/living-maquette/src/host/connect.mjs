/**
 * Production adapter between the kit's loader controller and a real host.
 *
 * This is the kit's 01_ui_package/components/loader-integration-example.mjs
 * with three additions and no change to its scope, abort or acknowledgement
 * rules (the kit's own test file runs against this module as well):
 *
 *  1. `options.expectedWaitMs` and `options.destinations` reach the controller.
 *     The example could not set the calibrated wait or the permitted rooms.
 *  2. `options.onTrace(event)` reports every host patch with the controller's
 *     accept/reject decision, and every action sent to the host. Evidence only;
 *     it cannot change state.
 *  3. `requestEntry()` reports why it returned false on `bridge.lastEntry`
 *     ('declined' | 'stale' | 'aborted' | 'unavailable'), so the interface can
 *     tell a current failure (show the recoverable message) from a superseded
 *     request (say nothing).
 *
 * Host callbacks (see 06_handoff/input_contract.json, host_contract):
 *   setPreferences(preferences, scope)
 *   attachToCurrentLoad({ attemptId, destinationId, destinationRequestId, preferences, onSnapshot }) -> unsubscribe
 *   retryCurrentLoad(request)
 *   openLightVersion(request)
 *   enterDestination(destinationId, preferences, scope)   scope carries entryRequestId and signal
 *   onCallbackError(error, source)                         optional
 */
import { createLoaderController, getLoadScope } from '../kit/loader-controller.mjs';

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

function scopeOf(patch) {
  const scope = {};
  for (const field of LOAD_SCOPE_FIELDS) if (own(patch, field)) scope[field] = patch[field];
  return scope;
}

export function connectLivingMaquette(host, initialPreferences = {}, options = {}) {
  let activeSubscription = null;
  let disposed = false;
  let pendingEntry = null;
  let entryRequestId = 0;
  let entered = false;

  function trace(event) {
    if (typeof options.onTrace !== 'function') return;
    try { options.onTrace(event); } catch { /* evidence must never break loading */ }
  }

  const controllerOptions = {
    initialPreferences,
    hooks: {
      onPreferencesChange: syncPreferences,
      async onRetry(request) {
        if (disposed) return false;
        cancelInvalidEntry();
        detach();
        trace({ direction: 'to-host', type: 'retryCurrentLoad', scope: scopeOf(request) });
        const accepted = await host.retryCurrentLoad(request);
        trace({ direction: 'from-host', type: 'retry-acknowledged', scope: scopeOf(request), accepted: accepted !== false });
        if (accepted === false) return false;
        if (!disposed && controller.getSnapshot().attemptId === request.attemptId) attach(request.attemptId);
      },
      onLightVersion: (request) => {
        if (disposed) return false;
        trace({ direction: 'to-host', type: 'openLightVersion', scope: scopeOf(request), lightVersionRequestId: request.lightVersionRequestId });
        return host.openLightVersion(request);
      },
      onCallbackError: (error, source) => host.onCallbackError?.(error, source),
    },
  };
  if (options.expectedWaitMs !== undefined) controllerOptions.expectedWaitMs = options.expectedWaitMs;
  if (options.destinations !== undefined) controllerOptions.destinations = options.destinations;
  const controller = createLoaderController(controllerOptions);

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
    trace({ direction: 'to-host', type: 'attachToCurrentLoad', scope: getLoadScope(snapshot) });
    try {
      const unsubscribe = host.attachToCurrentLoad({
        ...getLoadScope(snapshot),
        preferences: snapshot.preferences,
        onSnapshot(patch) {
          if (disposed || activeSubscription !== subscription) {
            trace({ direction: 'from-host', type: 'patch', scope: patch ? scopeOf(patch) : {}, accepted: false, reason: 'closed-subscription' });
            return false;
          }
          if (!patch || typeof patch !== 'object') throw new TypeError('Host snapshot must be an object');
          // An isolated subscription may supply its captured attempt as a default.
          // An explicitly different origin must be rejected, never relabelled.
          let accepted;
          if (own(patch, 'attemptId')) {
            accepted = patch.attemptId !== attemptId ? false : controller.updateHost(patch);
          } else {
            accepted = controller.updateHost({ ...patch, attemptId });
          }
          trace({
            direction: 'from-host',
            type: 'patch',
            scope: { attemptId, ...scopeOf(patch) },
            fields: Object.keys(patch).filter((key) => !LOAD_SCOPE_FIELDS.includes(key)),
            readyForEntry: patch.readyForEntry,
            phase: patch.phase,
            accepted,
            reason: accepted ? undefined : 'superseded-scope',
          });
          return accepted;
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
    trace({ direction: 'to-host', type: 'setPreferences', scope: { ...scope }, preferences: { ...preferences } });
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
      if (!pendingEntry.scope.signal.aborted) {
        trace({ direction: 'to-host', type: 'entry-aborted', scope: scopeOf(pendingEntry.scope), entryRequestId: pendingEntry.scope.entryRequestId });
      }
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

  const bridge = {
    controller,
    /** Why the latest requestEntry() resolved false; null after a success or before any request. */
    lastEntry: null,
    get entered() { return entered; },
    get entryPending() { return Boolean(pendingEntry && !pendingEntry.scope.signal.aborted); },
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
      if (disposed || entered || !snapshot.canEnter || (pendingEntry && !pendingEntry.scope.signal.aborted)) {
        bridge.lastEntry = 'unavailable';
        return false;
      }
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
      trace({ direction: 'to-host', type: 'enterDestination', scope: scopeOf(scope), entryRequestId: scope.entryRequestId, preferences: { ...snapshot.preferences } });
      try {
        const acknowledgement = await Promise.race([
          host.enterDestination(snapshot.preferences.destinationId, snapshot.preferences, scope),
          aborted,
        ]);
        const current = controller.getSnapshot();
        const stale = disposed || pendingEntry !== operation || !current.canEnter || !sameScope(scope, getLoadScope(current));
        if (scope.signal.aborted || stale || !matchesAcknowledgement(acknowledgement, scope)) {
          bridge.lastEntry = scope.signal.aborted ? 'aborted' : stale ? 'stale' : 'declined';
          trace({ direction: 'from-host', type: 'entry-result', scope: scopeOf(scope), entryRequestId: scope.entryRequestId, accepted: false, reason: bridge.lastEntry });
          return false;
        }
        entered = true;
        bridge.lastEntry = null;
        trace({ direction: 'from-host', type: 'entry-result', scope: scopeOf(scope), entryRequestId: scope.entryRequestId, accepted: true });
        return acknowledgement;
      } catch (error) {
        if (scope.signal.aborted) {
          bridge.lastEntry = 'aborted';
          return false;
        }
        bridge.lastEntry = 'declined';
        trace({ direction: 'from-host', type: 'entry-result', scope: scopeOf(scope), entryRequestId: scope.entryRequestId, accepted: false, reason: 'error' });
        throw error;
      } finally {
        scope.signal.removeEventListener('abort', onAbort);
        if (pendingEntry === operation) pendingEntry = null;
      }
    },
  };
  return bridge;
}
