/**
 * The host path, end to end without a browser: the production adapter
 * (src/host/connect.mjs) driving the kit controller against the simulated host
 * on a manual clock. Everything here is simulated-host evidence; the same
 * adapter is what a real site connects to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectLivingMaquette } from '../src/host/connect.mjs';
import { createSimulatedHost, SCENARIOS } from '../src/host/simulated-host.mjs';

function manualClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
  return {
    now: () => now,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.set(id, { at: now + Math.max(0, ms), fn, every: null }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) if (timer.at <= target && (!due || timer.at < due.timer.at)) due = { id, timer };
        if (!due) break;
        now = due.timer.at;
        if (due.timer.every === null) timers.delete(due.id);
        else due.timer.at += due.timer.every;
        due.timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
    flush,
  };
}

function start(scenario, hostOptions = {}, preferences = {}) {
  const clock = manualClock();
  const host = createSimulatedHost({ scenario, clock, ...hostOptions });
  const patches = [];
  const bridge = connectLivingMaquette(host, preferences, {
    onTrace(event) {
      if (event.type === 'patch') patches.push({ ...event, canEnterAfter: bridge.controller.getSnapshot().canEnter });
    },
  });
  const snapshot = () => bridge.controller.getSnapshot();
  const count = (type) => host.trace.filter((event) => event.type === type).length;
  return { clock, host, bridge, controller: bridge.controller, snapshot, patches, count };
}

test('early readiness: the scoped grant enables entry and the host acknowledges it', async () => {
  const { clock, host, bridge, snapshot, patches } = start('early');
  await clock.advance(3_300);
  assert.equal(snapshot().canEnter, false, 'the world is still preparing');
  await clock.advance(1_000);
  assert.equal(snapshot().canEnter, true);
  const grant = patches.find((patch) => patch.readyForEntry && patch.accepted);
  assert.deepEqual(grant.scope, { attemptId: 0, destinationId: 'lounge', destinationRequestId: 0 }, 'readiness carries the scope captured when the room task began');

  const entry = bridge.requestEntry();
  await clock.advance(700);
  const acknowledgement = await entry;
  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.entryRequestId, 1);
  assert.equal(bridge.entered, true);
  assert.equal(host.entered.destinationId, 'lounge');
  assert.deepEqual(host.entered.preferences, { destinationId: 'lounge', lightMode: 'warm', soundEnabled: false, reducedMotion: false });
});

test('already ready on arrival: entry is available at once', async () => {
  const { clock, snapshot } = start('returning');
  await clock.advance(1);
  assert.equal(snapshot().canEnter, true);
  assert.equal(snapshot().status, 'ready');
});

test('the selected room and light reach the host with the entry request', async () => {
  const { clock, host, bridge, controller, snapshot } = start('early');
  controller.setDestination('motion-floor');
  controller.setLightMode('soft');
  await clock.advance(6_500);
  assert.equal(snapshot().canEnter, true);
  const entry = bridge.requestEntry();
  await clock.advance(700);
  assert.equal((await entry).destinationId, 'motion-floor');
  assert.equal(host.entered.preferences.lightMode, 'soft');
  assert.equal(host.entered.preferences.destinationId, 'motion-floor');
});

test('lounge, Motion floor, lounge: the first lounge task reports late and unlocks nothing', async () => {
  const { clock, controller, snapshot, patches } = start('early');
  await clock.advance(3_500); // world complete; the first lounge task is preparing
  controller.setDestination('motion-floor');
  controller.setDestination('lounge');
  assert.equal(snapshot().destinationRequestId, 2);

  await clock.advance(400); // t = 3.9 s: the first lounge task finishes
  const stale = patches.find((patch) => patch.readyForEntry && patch.scope.destinationRequestId === 0);
  assert.ok(stale, 'the superseded task still reported');
  assert.equal(stale.accepted, false);
  assert.equal(stale.canEnterAfter, false);
  assert.equal(snapshot().canEnter, false, 'the old lounge result cannot unlock the latest lounge request');

  await clock.advance(200); // t = 4.1 s: the current lounge task finishes
  assert.equal(snapshot().canEnter, true);
  const current = patches.find((patch) => patch.readyForEntry && patch.accepted);
  assert.equal(current.scope.destinationRequestId, 2);

  await clock.advance(2_500); // the abandoned Motion floor task finishes too
  const abandoned = patches.find((patch) => patch.readyForEntry && patch.scope.destinationId === 'motion-floor');
  assert.equal(abandoned.accepted, false);
  assert.equal(snapshot().canEnter, true);
  assert.equal(snapshot().preferences.destinationId, 'lounge');
});

test('failure, then retry: one new attempt, late results from the old attempt refused, choices kept', async () => {
  const { clock, controller, snapshot, patches, count } = start('failure');
  controller.setLightMode('soft');
  controller.setDestination('motion-floor');
  await clock.advance(8_300);
  assert.equal(snapshot().status, 'error');
  assert.equal(snapshot().canRetry, true);
  assert.equal(snapshot().canEnter, false);

  assert.ok(controller.requestRetry());
  assert.equal(controller.requestRetry(), null, 'a repeated activation is ignored while the request is pending');
  assert.equal(snapshot().retryPending, true);
  await clock.advance(450);
  assert.equal(count('retry-requested'), 1);
  assert.equal(snapshot().attemptId, 1);
  assert.equal(snapshot().retryPending, false);

  await clock.advance(1_000); // the previous attempt's late results arrive
  const late = patches.filter((patch) => patch.scope.attemptId === 0 && patch.t === undefined && patch.accepted === false);
  assert.ok(late.length >= 2, 'both late results from attempt 0 were refused');
  assert.ok(late.some((patch) => patch.readyForEntry), 'including its readiness claim');
  assert.equal(snapshot().canEnter, false);
  assert.equal(snapshot().phase !== 'details' || snapshot().taskLabel !== 'Late result from the previous attempt', true);

  assert.deepEqual(
    { room: snapshot().preferences.destinationId, light: snapshot().preferences.lightMode },
    { room: 'motion-floor', light: 'soft' },
  );
  await clock.advance(22_000);
  assert.equal(snapshot().canEnter, true, 'the new attempt completes for the kept room');
  assert.equal(snapshot().attemptId, 1);
});

test('entry: duplicate activation is one request; a room change while pending aborts it', async () => {
  const { clock, host, bridge, controller, snapshot, count } = start('early');
  await clock.advance(4_300);
  assert.equal(snapshot().canEnter, true);

  const first = bridge.requestEntry();
  const duplicate = await bridge.requestEntry();
  assert.equal(duplicate, false);
  assert.equal(bridge.lastEntry, 'unavailable');
  assert.equal(count('entry-requested'), 1);
  assert.equal(bridge.entryPending, true);

  await clock.advance(300); // acknowledgement not yet due
  controller.setDestination('motion-floor');
  assert.equal(await first, false, 'the superseded entry does not complete');
  assert.equal(bridge.lastEntry, 'aborted');
  await clock.advance(500); // the host reaches its commit point and sees the abort
  assert.equal(count('entry-abandoned'), 1);
  assert.equal(count('entry-committed'), 0);
  assert.equal(host.entered, null);
  assert.equal(bridge.entered, false);
  assert.equal(snapshot().preferences.destinationId, 'motion-floor', 'the newer selection stays active');
  assert.equal(snapshot().canEnter, false);

  await clock.advance(2_600);
  assert.equal(snapshot().canEnter, true);
  const second = bridge.requestEntry();
  await clock.advance(700);
  const acknowledgement = await second;
  assert.equal(acknowledgement.entryRequestId, 2);
  assert.equal(host.entered.destinationId, 'motion-floor');
});

test('entry: a retry while the acknowledgement is pending aborts it', async () => {
  const { clock, bridge, controller, snapshot, count } = start('early');
  await clock.advance(4_300);
  const pending = bridge.requestEntry();
  // The host withdraws readiness and offers retry (for example a lost context).
  controller.updateHost({ attemptId: 0, destinationId: 'lounge', destinationRequestId: 0, phase: 'failed', health: 'failed', error: { code: 'context-lost' }, canRetry: true });
  assert.equal(await pending, false);
  assert.equal(bridge.lastEntry, 'aborted');
  assert.ok(controller.requestRetry());
  await clock.advance(1_200);
  assert.equal(snapshot().attemptId, 1);
  assert.equal(count('entry-committed'), 0);
});

test('entry declined by the host is a current, recoverable failure; the next request succeeds', async () => {
  const { clock, bridge, snapshot } = start('early', { failFirstEntry: true });
  await clock.advance(4_300);
  const declined = bridge.requestEntry();
  await clock.advance(700);
  assert.equal(await declined, false);
  assert.equal(bridge.lastEntry, 'declined');
  assert.equal(bridge.entered, false);
  assert.equal(snapshot().canEnter, true, 'the page and its choices stay as they were');
  const retried = bridge.requestEntry();
  await clock.advance(700);
  assert.equal((await retried).ok, true);
  assert.equal(bridge.lastEntry, null);
});

test('light version: requested once, acknowledged by the host', async () => {
  const opened = [];
  const { clock, controller, snapshot, count } = start('normal', { onLightVersionOpened: (request) => opened.push(request) });
  await clock.advance(1_000);
  assert.equal(snapshot().lightVersionAvailable, true, 'available from the first host report');
  assert.ok(controller.requestLightVersion());
  assert.equal(controller.requestLightVersion(), null);
  assert.equal(snapshot().lightVersionRequested, true);
  await clock.advance(350);
  assert.equal(snapshot().lightVersionRequested, false);
  assert.equal(snapshot().lightVersionError, null);
  assert.equal(count('light-version-requested'), 1);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].preferences.destinationId, 'lounge');
});

test('light version unsupported by the host: never offered', async () => {
  const { clock, controller, snapshot } = start('normal', { lightVersion: false });
  await clock.advance(1_000);
  assert.equal(snapshot().lightVersionAvailable, false);
  assert.equal(controller.requestLightVersion(), null);
});

test('progress: a percentage only for measured bytes with a total', async () => {
  const known = start('normal');
  await known.clock.advance(10_000);
  assert.equal(known.snapshot().phase, 'structure');
  assert.ok(known.snapshot().progress.percent > 0 && known.snapshot().progress.percent < 100);
  await known.clock.advance(62_000); // preparing the room: no bytes to measure
  assert.equal(known.snapshot().phase, 'preparing-room');
  assert.equal(known.snapshot().progress.percent, null);

  const unknown = start('unknown-total');
  await unknown.clock.advance(7_000);
  assert.ok(unknown.snapshot().progress.loadedBytes > 0);
  assert.equal(unknown.snapshot().progress.percent, null);
});

test('the site replay carries the live loader labels as task labels', async () => {
  const { clock, snapshot } = start('site');
  const labels = new Set();
  for (let t = 0; t < 131; t += 1) {
    await clock.advance(1_000);
    if (snapshot().taskLabel) labels.add(snapshot().taskLabel);
  }
  for (const stage of SCENARIOS.site.stages) assert.ok(labels.has(stage.label), stage.label);
  assert.equal(snapshot().canEnter, false);
  await clock.advance(1_500);
  assert.equal(snapshot().canEnter, true);
});

test('a host-reported stall is its own state, offers the supported actions and clears by itself', async () => {
  const { clock, snapshot } = start('stall');
  await clock.advance(8_300);
  assert.equal(snapshot().status, 'stalled');
  assert.equal(snapshot().health, 'suspected-stall');
  assert.equal(snapshot().canRetry, true);
  assert.equal(snapshot().error, null, 'a stall is not a failure');
  await clock.advance(24_500);
  assert.equal(snapshot().status, 'loading');
  await clock.advance(12_000);
  assert.equal(snapshot().canEnter, true);
});

test('only permitted rooms can be selected', () => {
  const clock = manualClock();
  const host = createSimulatedHost({ scenario: 'early', clock });
  const bridge = connectLivingMaquette(host, {}, { destinations: ['lounge'], expectedWaitMs: 5_000 });
  assert.throws(() => bridge.controller.setDestination('motion-floor'), RangeError);
  assert.equal(bridge.controller.getSnapshot().expectedWaitMs, 5_000);
});

test('disposing the intro detaches from the host and aborts a pending entry', async () => {
  const { clock, bridge, count } = start('early');
  await clock.advance(4_300);
  const pending = bridge.requestEntry();
  bridge.dispose();
  assert.equal(await pending, false);
  assert.equal(count('detach'), 1);
  await clock.advance(1_000);
  assert.equal(count('entry-committed'), 0);
});
