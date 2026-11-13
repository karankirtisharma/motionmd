/**
 * Pure state for the Living Maquette intro. The host supplies real readiness
 * and progress. Scope route-specific updates to the attempt and selection that
 * originated the work, including callbacks that restore entry after a failure.
 */
export const READINESS_FLAGS = Object.freeze([
  'criticalAssetsResident',
  'firstUsableFrameRendered',
  'essentialNavigationReady',
  'collisionReadyWhereRequired',
  'selectedRouteReady',
  'accessAllowed',
]);

const PHASES = new Set(['boot', 'structure', 'light', 'details', 'preparing-room', 'ready', 'failed']);
const HEALTH = new Set(['active', 'suspected-stall', 'failed']);
const LIGHT_MODES = new Set(['warm', 'soft']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

function choice(value, values, name) {
  if (!values.has(value)) throw new RangeError(`Unsupported ${name}: ${value}`);
  return value;
}

function download(value) {
  if (value === null) return { loadedBytes: null, totalBytes: null, scope: null, percent: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('download must be an object or null');
  }
  const loadedBytes = value.loadedBytes ?? null;
  const totalBytes = value.totalBytes ?? null;
  for (const [name, amount] of Object.entries({ loadedBytes, totalBytes })) {
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      throw new RangeError(`${name} must be nonnegative and finite, or null`);
    }
  }
  const scope = value.scope == null ? null : text(value.scope, 'download.scope');
  const percent = loadedBytes !== null && totalBytes > 0 && loadedBytes <= totalBytes
    ? (loadedBytes / totalBytes) * 100 : null;
  return { loadedBytes, totalBytes, scope, percent };
}

function readiness(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('readiness must be an object or null');
  }
  return Object.fromEntries(READINESS_FLAGS.map((key) => [
    key, own(value, key) ? boolean(value[key], `readiness.${key}`) : false,
  ]));
}

function hasFailed(state) {
  return state.health === 'failed' || state.phase === 'failed' || state.error !== null;
}

function canEnterFor(state) {
  const conditionsPass = state.readiness === null || READINESS_FLAGS.every((key) => state.readiness[key]);
  return state.readyForEntry && conditionsPass && !hasFailed(state)
    && state.health === 'active' && !state.retryPending;
}

export function getLoadScope(snapshot) {
  return Object.freeze({
    attemptId: snapshot.attemptId,
    destinationId: snapshot.preferences.destinationId,
    destinationRequestId: snapshot.destinationRequestId,
  });
}

export function createLoaderController({
  expectedWaitMs = 80_000,
  destinations = ['lounge', 'motion-floor'],
  initialPreferences = {},
  hooks = {},
} = {}) {
  if (!Number.isFinite(expectedWaitMs) || expectedWaitMs <= 0) {
    throw new RangeError('expectedWaitMs must be positive and finite');
  }
  if (!Array.isArray(destinations) || !destinations.length) {
    throw new TypeError('destinations must be a nonempty array');
  }
  const allowedDestinations = new Set(destinations.map((id) => text(id, 'destination')));
  const listeners = new Set();
  const notifications = [];
  let publishing = false;
  let revision = 0;
  let state = {
    attemptId: 0,
    destinationRequestId: 0,
    elapsedMs: 0,
    expectedWaitMs,
    phase: 'boot',
    taskLabel: null,
    health: 'active',
    progress: download(null),
    readyForEntry: false,
    readiness: null,
    error: null,
    preferenceError: null,
    canRetry: false,
    retryPending: false,
    lightVersionAvailable: false,
    lightVersionRequested: false,
    lightVersionRequestId: 0,
    lightVersionError: null,
    passive: true,
    view: 'intro',
    routeFields: new Set(),
    preferences: {
      destinationId: choice(initialPreferences.destinationId ?? destinations[0], allowedDestinations, 'destination'),
      lightMode: choice(initialPreferences.lightMode ?? 'warm', LIGHT_MODES, 'lightMode'),
      soundEnabled: boolean(initialPreferences.soundEnabled ?? false, 'soundEnabled'),
      reducedMotion: boolean(initialPreferences.reducedMotion ?? false, 'reducedMotion'),
    },
  };

  function getSnapshot() {
    const { routeFields, ...visible } = state;
    const canEnter = canEnterFor(state);
    let status = 'loading';
    if (hasFailed(state)) status = 'error';
    else if (state.health === 'suspected-stall') status = 'stalled';
    else if (canEnter) status = 'ready';
    else if (state.elapsedMs >= expectedWaitMs) status = 'slow';
    return freeze(clone({ ...visible, canEnter, status }));
  }

  function reportCallbackError(error, source) {
    try {
      const report = hooks.onCallbackError?.(error, source);
      if (report && typeof report.then === 'function') Promise.resolve(report).catch(() => {});
    } catch {
      // A failing diagnostic callback must leave recovery and notifications usable.
    }
  }

  function notify(subscription, event) {
    if (subscription.revision >= event.revision) return;
    subscription.revision = event.revision;
    try {
      const result = subscription.listener(event.snapshot);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch((error) => reportCallbackError(error, 'subscriber'));
      }
    } catch (error) {
      reportCallbackError(error, 'subscriber');
    }
  }

  function publish(next, dispatch) {
    state = next;
    const snapshot = getSnapshot();
    notifications.push({ revision: ++revision, snapshot });
    if (publishing) {
      dispatch?.(snapshot);
      return snapshot;
    }
    publishing = true;
    try {
      dispatch?.(snapshot);
      // Queue nested updates until every observer has seen the preceding state.
      while (notifications.length) {
        const event = notifications.shift();
        for (const subscription of listeners) notify(subscription, event);
      }
    } finally {
      publishing = false;
    }
    return snapshot;
  }

  function dispatchHook(name, args, { onResolve, onReject } = {}) {
    if (typeof hooks[name] !== 'function') return;
    function reject(error) {
      onReject?.();
      reportCallbackError(error, name);
    }
    function resolve(value, asynchronous) {
      if (value === false) reject(new Error(`${name} declined the request`));
      else onResolve?.(value, asynchronous);
    }
    try {
      const result = hooks[name](...args);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then((value) => resolve(value, true), reject);
      } else {
        resolve(result, false);
      }
    } catch (error) {
      reject(error);
    }
  }

  function updateHost(patch) {
    if (!patch || !Number.isSafeInteger(patch.attemptId)) {
      throw new TypeError('Host updates require an integer attemptId');
    }
    if (patch.attemptId !== state.attemptId) return false;
    const scoped = own(patch, 'destinationId') || own(patch, 'destinationRequestId');
    if (scoped) {
      if (typeof patch.destinationId !== 'string' || !Number.isSafeInteger(patch.destinationRequestId)) {
        throw new TypeError('Route-specific updates require destinationId and integer destinationRequestId');
      }
      if (patch.destinationId !== state.preferences.destinationId
        || patch.destinationRequestId !== state.destinationRequestId) return false;
    }
    if (own(patch, 'lightVersionRequested')) {
      if (patch.lightVersionRequested !== false || !Number.isSafeInteger(patch.lightVersionRequestId)) {
        throw new TypeError('Light version acknowledgement requires false and its integer lightVersionRequestId');
      }
      if (!state.lightVersionRequested || patch.lightVersionRequestId !== state.lightVersionRequestId) return false;
    }

    const next = { ...state, retryPending: false, routeFields: new Set(state.routeFields) };
    function setField(key, value) {
      next[key] = value;
      if (scoped) next.routeFields.add(key);
      else next.routeFields.delete(key);
    }
    if (own(patch, 'phase')) setField('phase', choice(patch.phase, PHASES, 'phase'));
    if (own(patch, 'taskLabel')) setField('taskLabel', patch.taskLabel === null ? null : text(patch.taskLabel, 'taskLabel'));
    if (own(patch, 'health')) setField('health', choice(patch.health, HEALTH, 'health'));
    if (own(patch, 'download')) setField('progress', download(patch.download));
    if (own(patch, 'readyForEntry')) setField('readyForEntry', boolean(patch.readyForEntry, 'readyForEntry'));
    if (own(patch, 'readiness')) setField('readiness', readiness(patch.readiness));
    if (own(patch, 'canRetry')) setField('canRetry', boolean(patch.canRetry, 'canRetry'));
    if (own(patch, 'lightVersionAvailable')) setField('lightVersionAvailable', boolean(patch.lightVersionAvailable, 'lightVersionAvailable'));
    if (own(patch, 'lightVersionRequested')) {
      next.lightVersionRequested = false;
      next.lightVersionError = null;
    }
    if (own(patch, 'error')) {
      if (patch.error !== null && (typeof patch.error !== 'object' || Array.isArray(patch.error))) {
        throw new TypeError('error must be an object or null');
      }
      setField('error', clone(patch.error));
    }
    const grantsReadiness = patch.readyForEntry === true
      || patch.readiness?.selectedRouteReady === true
      || (!canEnterFor(state) && canEnterFor(next));
    if (grantsReadiness && !scoped) {
      throw new TypeError('Readiness updates require matching destinationId and destinationRequestId');
    }
    publish(next);
    return true;
  }

  function selectDestination(next) {
    next.destinationRequestId += 1;
    next.readyForEntry = false;
    next.readiness = null;
    const defaults = {
      phase: 'preparing-room', taskLabel: null, health: 'active', progress: download(null),
      error: null, canRetry: false, lightVersionAvailable: false,
    };
    for (const field of state.routeFields) {
      if (own(defaults, field)) next[field] = defaults[field];
    }
    if (next.phase === 'ready') {
      next.phase = 'preparing-room';
      next.taskLabel = null;
    }
    next.routeFields = new Set();
  }

  function setPreference(key, value) {
    const preferences = { ...state.preferences, [key]: value };
    const changedDestination = key === 'destinationId' && value !== state.preferences.destinationId;
    const next = { ...state, passive: false, preferences, preferenceError: null };
    if (changedDestination) selectDestination(next);
    return publish(next, (snapshot) => {
      dispatchHook('onPreferencesChange', [snapshot.preferences, getLoadScope(snapshot)], {
        onReject() {
          if (state.preferences !== preferences || state.attemptId !== snapshot.attemptId) return;
          const failure = { code: 'preferences-failed' };
          const failed = { ...state, preferenceError: failure };
          if (changedDestination && !canEnterFor(state)) {
            failed.phase = 'failed';
            failed.error = failure;
            failed.routeFields = new Set([...state.routeFields, 'phase', 'error']);
          }
          publish(failed);
        },
      });
    });
  }

  function settleLightVersion(request, failed) {
    if (state.attemptId !== request.attemptId || state.lightVersionRequestId !== request.lightVersionRequestId
      || !state.lightVersionRequested) return;
    publish({
      ...state,
      lightVersionRequested: false,
      lightVersionError: failed ? { code: 'light-version-failed' } : null,
    });
  }

  return Object.freeze({
    getSnapshot,
    updateHost,
    subscribe(listener, { emitCurrent = true } = {}) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const subscription = { listener, revision: emitCurrent ? revision - 1 : revision };
      listeners.add(subscription);
      if (emitCurrent) notify(subscription, { revision, snapshot: getSnapshot() });
      return () => listeners.delete(subscription);
    },
    setElapsedMs(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < state.elapsedMs) {
        throw new RangeError('elapsedMs must be finite and monotonic within an attempt');
      }
      return publish({ ...state, elapsedMs });
    },
    setDestination(id) { return setPreference('destinationId', choice(id, allowedDestinations, 'destination')); },
    setLightMode(mode) { return setPreference('lightMode', choice(mode, LIGHT_MODES, 'lightMode')); },
    setSoundEnabled(value) { return setPreference('soundEnabled', boolean(value, 'soundEnabled')); },
    setReducedMotion(value) { return setPreference('reducedMotion', boolean(value, 'reducedMotion')); },
    setPassive(value) { return publish({ ...state, passive: boolean(value, 'passive') }); },
    openSelectedWork() { return publish({ ...state, view: 'selected-work' }); },
    closeSelectedWork() { return publish({ ...state, view: 'intro' }); },
    requestRetry() {
      if (!state.canRetry || state.retryPending) return null;
      const request = freeze(clone({
        ...getLoadScope(state),
        previousAttemptId: state.attemptId,
        attemptId: state.attemptId + 1,
        preferences: state.preferences,
      }));
      publish({
        ...state,
        attemptId: request.attemptId,
        elapsedMs: 0,
        phase: 'boot',
        taskLabel: null,
        health: 'active',
        progress: download(null),
        readyForEntry: false,
        readiness: null,
        error: null,
        preferenceError: null,
        retryPending: true,
        lightVersionRequested: false,
        lightVersionError: null,
        routeFields: new Set([...state.routeFields].filter((field) => field === 'canRetry' || field === 'lightVersionAvailable')),
      }, () => dispatchHook('onRetry', [request], {
        onReject() {
          if (state.attemptId !== request.attemptId) return;
          publish({
            ...state,
            phase: 'failed',
            health: 'failed',
            readyForEntry: false,
            retryPending: false,
            error: { code: 'retry-failed' },
          });
        },
      }));
      return request;
    },
    requestLightVersion() {
      if (!state.lightVersionAvailable || state.lightVersionRequested) return null;
      const request = freeze(clone({
        ...getLoadScope(state),
        lightVersionRequestId: state.lightVersionRequestId + 1,
        preferences: state.preferences,
      }));
      publish({
        ...state,
        lightVersionRequested: true,
        lightVersionRequestId: request.lightVersionRequestId,
        lightVersionError: null,
      }, () => dispatchHook('onLightVersion', [request], {
        onResolve(value, asynchronous) {
          // A void synchronous hook can dispatch and acknowledge separately.
          if (asynchronous || value === true) settleLightVersion(request, false);
        },
        onReject() { settleLightVersion(request, true); },
      }));
      return request;
    },
  });
}
