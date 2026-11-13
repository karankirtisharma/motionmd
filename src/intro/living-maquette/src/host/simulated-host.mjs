/**
 * Simulated host for local development and repeatable checks.
 *
 * It behaves like a real world loader as far as the intro can tell: whole-world
 * tasks report unscoped progress, each selected room has its own route task that
 * captures attemptId, destinationId and destinationRequestId when it starts and
 * reports with that original scope, superseded tasks still report late, retry
 * starts a new attempt, and entry is acknowledged for one entryRequestId after
 * the AbortSignal has been checked.
 *
 * The default scenario replays the stages and timings observed on the live
 * motiondesign.ad loader (see docs/evidence/site-baseline.json). Everything
 * produced here is simulated-host evidence, never proof about the real site.
 */

const READY_CHECKS = Object.freeze({
  criticalAssetsResident: true,
  firstUsableFrameRendered: true,
  essentialNavigationReady: true,
  collisionReadyWhereRequired: true,
  selectedRouteReady: true,
  accessAllowed: true,
});

const MB = 1_000_000;

/**
 * Stage lists. `phase` is the kit phase the stage maps to. `label` is the
 * host's own plain-language task (null lets the interface use the deck copy).
 * `bytes` marks a stage with a measured download.
 */
export const SCENARIOS = Object.freeze({
  // The live loader, as observed: labels, order and durations.
  site: {
    description: 'Replay of the live motiondesign.ad loader (about 131 s)',
    stages: [
      { phase: 'boot', label: 'Checking the graphics device', ms: 4_400 },
      { phase: 'structure', label: 'Loading the architecture', ms: 45_100, bytes: 188.6 * MB },
      { phase: 'light', label: 'Preparing the light', ms: 22_500 },
      { phase: 'details', label: 'Preparing exploration', ms: 3_000 },
      { phase: 'details', label: 'Preparing textures', ms: 900 },
      { phase: 'details', label: 'Preparing reflections', ms: 54_400 },
    ],
    route: { lounge: 900, 'motion-floor': 4_000 },
  },
  normal: {
    description: 'An 80-second preparation with deck status copy',
    stages: [
      { phase: 'boot', label: null, ms: 1_200 },
      { phase: 'structure', label: null, ms: 18_000, bytes: 46 * MB },
      { phase: 'light', label: null, ms: 24_000, bytes: 62 * MB },
      { phase: 'details', label: null, ms: 26_000, bytes: 44 * MB },
      { phase: 'preparing-room', label: null, ms: 8_800 },
    ],
    route: { lounge: 2_000, 'motion-floor': 4_000 },
  },
  early: {
    description: 'Ready in about four seconds',
    stages: [
      { phase: 'structure', label: null, ms: 1_600, bytes: 20 * MB },
      { phase: 'light', label: null, ms: 1_000 },
      { phase: 'details', label: null, ms: 800 },
    ],
    route: { lounge: 500, 'motion-floor': 2_500 },
  },
  returning: {
    description: 'The room is already usable on arrival',
    stages: [],
    route: { lounge: 0, 'motion-floor': 2_500 },
  },
  slow: {
    description: 'An active load well beyond the expected wait',
    stages: [
      { phase: 'structure', label: null, ms: 20_000, bytes: 150 * MB },
      { phase: 'light', label: null, ms: 30_000 },
      { phase: 'details', label: 'Preparing graphics', ms: 90_000 },
    ],
    route: { lounge: 2_000, 'motion-floor': 4_000 },
  },
  'unknown-total': {
    description: 'A download whose total is not known',
    stages: [
      { phase: 'structure', label: null, ms: 14_000, bytes: null },
      { phase: 'light', label: null, ms: 10_000 },
      { phase: 'details', label: null, ms: 8_000 },
    ],
    route: { lounge: 1_500, 'motion-floor': 3_500 },
  },
  stall: {
    description: 'The host reports a suspected stall during lighting; retry recovers',
    stages: [
      { phase: 'structure', label: null, ms: 5_000, bytes: 40 * MB },
      { phase: 'light', label: null, ms: 9_000, stallAfter: 3_000 },
      { phase: 'details', label: null, ms: 4_000 },
    ],
    route: { lounge: 1_500, 'motion-floor': 3_500 },
  },
  failure: {
    description: 'The host reports a failure during lighting; retry recovers',
    stages: [
      { phase: 'structure', label: null, ms: 5_000, bytes: 40 * MB },
      { phase: 'light', label: null, ms: 9_000, failAfter: 3_000 },
      { phase: 'details', label: null, ms: 4_000 },
    ],
    route: { lounge: 1_500, 'motion-floor': 3_500 },
  },
});

const realClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

export function createSimulatedHost({
  scenario = 'site',
  speed = 1,
  tickMs = 200,
  entryAckMs = 700,
  retryAckMs = 400,
  lightVersionAckMs = 300,
  lightVersion = true,
  failFirstEntry = false,
  lateCallbacks = true,
  stallRecoversAfterMs = 24_000,
  holdAtMs = null,
  routeMs = null,
  clock = realClock,
  onTrace,
  onEntered,
  onLightVersionOpened,
} = {}) {
  const plan = SCENARIOS[scenario];
  if (!plan) throw new RangeError(`Unknown simulated scenario: ${scenario}`);
  const scale = 1 / Math.max(0.05, speed);
  const duration = (ms) => ms * scale;

  const trace = [];
  function record(type, detail = {}) {
    const event = { t: Math.round(clock.now()), source: 'simulated-host', type, ...detail };
    trace.push(event);
    if (trace.length > 2_000) trace.shift();
    try { onTrace?.(event); } catch { /* evidence only */ }
  }

  let preferences = null;
  let listener = null; // current subscription's onSnapshot
  let attemptId = 0;
  let attemptStartedAt = clock.now();
  let recovered = false; // a retry skips the scripted stall or failure
  let world = { index: -1, done: plan.stages.length === 0, halted: null };
  let interval = null;
  let entered = null;
  let entryCount = 0;
  let disposed = false;
  const routeTasks = new Map(); // `${attemptId}:${destinationRequestId}` -> task

  function send(patch, origin) {
    if (!listener) {
      record('patch-dropped', { origin, reason: 'no-subscriber' });
      return false;
    }
    let accepted = false;
    try {
      accepted = listener(patch) !== false;
    } catch (error) {
      record('patch-error', { origin, message: String(error?.message ?? error) });
      return false;
    }
    record('patch', {
      origin,
      scope: {
        attemptId: patch.attemptId,
        ...(patch.destinationId !== undefined ? { destinationId: patch.destinationId, destinationRequestId: patch.destinationRequestId } : {}),
      },
      phase: patch.phase,
      readyForEntry: patch.readyForEntry,
      accepted,
    });
    return accepted;
  }

  // ------------------------------------------------------------ world tasks
  function stageAt(elapsed) {
    let start = 0;
    for (let index = 0; index < plan.stages.length; index += 1) {
      const stage = plan.stages[index];
      const length = duration(stage.ms);
      if (elapsed < start + length) return { index, stage, into: elapsed - start, length };
      start += length;
    }
    return null;
  }

  // One measured download can span several stages; the total is their sum.
  const measured = plan.stages.filter((stage) => typeof stage.bytes === 'number');
  const totalBytes = measured.reduce((sum, stage) => sum + stage.bytes, 0);
  function downloadFor(stage, fraction) {
    if (!('bytes' in stage)) return null;
    if (stage.bytes === null) return { loadedBytes: Math.round(fraction * 120 * MB), totalBytes: null, scope: 'entry-critical' };
    let before = 0;
    for (const item of measured) {
      if (item === stage) break;
      before += item.bytes;
    }
    return { loadedBytes: Math.round(before + stage.bytes * Math.min(1, fraction)), totalBytes, scope: 'entry-critical' };
  }

  function worldTick() {
    if (disposed || world.done || world.halted) return;
    const origin = attemptId;
    let elapsed = clock.now() - attemptStartedAt;
    if (holdAtMs !== null && elapsed > duration(holdAtMs)) {
      // Review aid: keep the world at one moment so a state can be inspected.
      attemptStartedAt = clock.now() - duration(holdAtMs);
      elapsed = duration(holdAtMs);
    }
    // A scripted stall or failure happens at its moment even when the timer
    // ran late (a busy main thread must not carry the world past it).
    if (!recovered) {
      let begins = 0;
      for (const stage of plan.stages) {
        const scriptedAt = stage.failAfter ?? stage.stallAfter;
        if (scriptedAt !== undefined && elapsed > begins + duration(scriptedAt)) {
          elapsed = begins + duration(scriptedAt) + 1e-6;
          attemptStartedAt = clock.now() - elapsed;
          break;
        }
        begins += duration(stage.ms);
      }
    }
    const position = stageAt(elapsed);
    if (!position) {
      world.done = true;
      record('world-complete', { attemptId: origin });
      for (const task of routeTasks.values()) if (task.attemptId === origin) startRoutePreparation(task);
      return;
    }
    const { index, stage, into, length } = position;
    const scripted = !recovered && (stage.failAfter ?? stage.stallAfter);
    if (scripted !== undefined && scripted !== false && into >= duration(scripted) && world.index < index) {
      // The stage itself is reported before anything goes wrong in it.
      world.index = index;
      send({
        attemptId: origin, phase: stage.phase, taskLabel: stage.label, health: 'active',
        download: downloadFor(stage, 0), canRetry: false, lightVersionAvailable: lightVersion,
      }, `world:${stage.phase}`);
      return;
    }
    if (scripted !== undefined && scripted !== false && into >= duration(scripted)) {
      const failing = stage.failAfter !== undefined;
      world.halted = failing ? 'failed' : 'stalled';
      if (!failing && stallRecoversAfterMs > 0) {
        // A stall the visitor chooses to wait out: the host reports progress
        // again by itself and carries on from where it paused.
        const haltedAt = clock.now();
        clock.setTimeout(() => {
          if (disposed || attemptId !== origin || world.halted !== 'stalled') return;
          attemptStartedAt += clock.now() - haltedAt;
          world.halted = null;
          recovered = true;
          record('stall-cleared', { attemptId: origin });
          worldTick();
        }, duration(stallRecoversAfterMs));
      }
      send({
        attemptId: origin,
        phase: failing ? 'failed' : stage.phase,
        health: failing ? 'failed' : 'suspected-stall',
        taskLabel: stage.label,
        error: failing ? { code: 'simulated-load-failure' } : null,
        download: null,
        canRetry: true,
        lightVersionAvailable: lightVersion,
      }, `world:${stage.phase}`);
      return;
    }
    world.index = index;
    send({
      attemptId: origin,
      phase: stage.phase,
      taskLabel: stage.label,
      health: 'active',
      download: downloadFor(stage, into / length),
      canRetry: false,
      lightVersionAvailable: lightVersion,
    }, `world:${stage.phase}`);
  }

  // ------------------------------------------------------------ route tasks
  function beginRouteTask(scope) {
    const key = `${scope.attemptId}:${scope.destinationRequestId}`;
    if (routeTasks.has(key)) return routeTasks.get(key);
    // The task keeps the scope it was started with for its whole life.
    const task = { key, ...scope, timer: null, started: false, ready: false };
    routeTasks.set(key, task);
    record('route-task-started', { scope: { ...scope } });
    if (world.done && task.attemptId === attemptId) startRoutePreparation(task);
    return task;
  }

  function startRoutePreparation(task) {
    if (task.started || disposed) return;
    task.started = true;
    const length = duration(routeMs?.[task.destinationId] ?? plan.route[task.destinationId] ?? 2_000);
    const scope = { attemptId: task.attemptId, destinationId: task.destinationId, destinationRequestId: task.destinationRequestId };
    if (length > 0) {
      send({ ...scope, phase: 'preparing-room', taskLabel: null, health: 'active', download: null }, `route:${task.key}`);
    }
    task.timer = clock.setTimeout(() => {
      task.ready = true;
      // Reported with the originating scope even if the visitor has moved on.
      send({ ...scope, phase: 'ready', taskLabel: null, download: null, readyForEntry: true, readiness: { ...READY_CHECKS } }, `route:${task.key}`);
    }, length);
  }

  function currentRouteTask() {
    if (!preferences) return null;
    return [...routeTasks.values()].reverse().find((task) => task.attemptId === attemptId
      && task.destinationId === preferences.destinationId && task.destinationRequestId === preferences.destinationRequestId) ?? null;
  }

  function startWorld() {
    clock.clearInterval(interval);
    world = { index: -1, done: plan.stages.length === 0, halted: null };
    attemptStartedAt = clock.now();
    interval = clock.setInterval(worldTick, Math.max(16, duration(tickMs)));
  }
  startWorld();

  return {
    scenario,
    description: plan.description,
    trace,
    capabilities: Object.freeze({ sound: true, lightModes: ['warm', 'soft'], destinations: ['lounge', 'motion-floor'], lightVersion }),
    get entered() { return entered; },

    setPreferences(next, scope) {
      record('setPreferences', { scope: { ...scope }, preferences: { ...next } });
      preferences = { ...next, attemptId: scope.attemptId, destinationRequestId: scope.destinationRequestId };
      if (scope.attemptId === attemptId) beginRouteTask({ attemptId: scope.attemptId, destinationId: next.destinationId, destinationRequestId: scope.destinationRequestId });
      return true;
    },

    attachToCurrentLoad({ attemptId: attached, destinationId, destinationRequestId, onSnapshot }) {
      record('attach', { scope: { attemptId: attached, destinationId, destinationRequestId } });
      listener = onSnapshot;
      beginRouteTask({ attemptId: attached, destinationId, destinationRequestId });
      // Tell a new subscriber where the world stands straight away.
      if (world.done) {
        const task = currentRouteTask();
        if (task?.ready) {
          send({ attemptId: task.attemptId, destinationId: task.destinationId, destinationRequestId: task.destinationRequestId,
            phase: 'ready', readyForEntry: true, readiness: { ...READY_CHECKS }, lightVersionAvailable: lightVersion }, `route:${task.key}`);
        } else {
          send({ attemptId: attached, health: 'active', canRetry: false, lightVersionAvailable: lightVersion }, 'world:complete');
        }
      } else worldTick();
      return () => {
        if (listener === onSnapshot) listener = null;
        record('detach', { scope: { attemptId: attached } });
      };
    },

    retryCurrentLoad(request) {
      record('retry-requested', { scope: { attemptId: request.attemptId }, previousAttemptId: request.previousAttemptId });
      return new Promise((resolve) => {
        clock.setTimeout(() => {
          // One new attempt. Earlier route tasks keep their old scope and can
          // still report late; the controller is expected to reject them.
          attemptId = request.attemptId;
          recovered = true;
          startWorld();
          record('retry-acknowledged', { scope: { attemptId } });
          resolve(true);
          if (lateCallbacks) {
            // What a real loader can do after a retry: an old request finishes
            // anyway. Both reports carry the superseded attempt and must be
            // refused, including the readiness claim.
            const previous = request.previousAttemptId;
            clock.setTimeout(() => {
              send({ attemptId: previous, phase: 'details', taskLabel: 'Late result from the previous attempt', health: 'active' }, `stale:attempt-${previous}`);
              send({
                attemptId: previous, destinationId: request.destinationId, destinationRequestId: request.destinationRequestId,
                phase: 'ready', readyForEntry: true, readiness: { ...READY_CHECKS },
              }, `stale:attempt-${previous}`);
            }, duration(900));
          }
        }, duration(retryAckMs));
      });
    },

    openLightVersion(request) {
      record('light-version-requested', { scope: { attemptId: request.attemptId }, lightVersionRequestId: request.lightVersionRequestId });
      if (!lightVersion) return false;
      return new Promise((resolve) => {
        clock.setTimeout(() => {
          record('light-version-acknowledged', { lightVersionRequestId: request.lightVersionRequestId });
          try { onLightVersionOpened?.(request); } catch { /* demo callback */ }
          resolve(true);
        }, duration(lightVersionAckMs));
      });
    },

    enterDestination(destinationId, entryPreferences, scope) {
      entryCount += 1;
      const attempt = entryCount;
      record('entry-requested', {
        scope: { attemptId: scope.attemptId, destinationId: scope.destinationId, destinationRequestId: scope.destinationRequestId },
        entryRequestId: scope.entryRequestId,
      });
      return new Promise((resolve) => {
        clock.setTimeout(() => {
          const task = currentRouteTask();
          const current = task && task.ready && task.attemptId === scope.attemptId
            && task.destinationRequestId === scope.destinationRequestId && task.destinationId === destinationId;
          // Check the signal immediately before committing the world and input.
          if (scope.signal.aborted) {
            record('entry-abandoned', { entryRequestId: scope.entryRequestId, reason: 'aborted' });
            resolve(false);
            return;
          }
          if (!current || (failFirstEntry && attempt === 1)) {
            record('entry-declined', { entryRequestId: scope.entryRequestId, reason: current ? 'scripted' : 'not-current' });
            resolve(false);
            return;
          }
          entered = { destinationId, preferences: { ...entryPreferences }, entryRequestId: scope.entryRequestId };
          record('entry-committed', { entryRequestId: scope.entryRequestId, destinationId, preferences: { ...entryPreferences } });
          try { onEntered?.(entered); } catch { /* demo callback */ }
          resolve({
            ok: true,
            attemptId: scope.attemptId,
            destinationId,
            destinationRequestId: scope.destinationRequestId,
            entryRequestId: scope.entryRequestId,
          });
        }, duration(entryAckMs));
      });
    },

    onCallbackError(error, source) {
      record('callback-error', { source, message: String(error?.message ?? error) });
    },

    dispose() {
      disposed = true;
      clock.clearInterval(interval);
      for (const task of routeTasks.values()) clock.clearTimeout(task.timer);
      listener = null;
    },
  };
}
