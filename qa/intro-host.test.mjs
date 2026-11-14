import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldIntroHost } from '../src/intro/worldIntroHost.mjs';
const prefs = { destinationId: 'lounge', lightMode: 'warm', soundEnabled: false, reducedMotion: false };
function fixture() {
  const patches = []; let entries = 0; let retries = 0;
  const host = createWorldIntroHost({ preferences() {}, retry() { retries++; }, light() {}, enter() { entries++; } });
  const scope = { attemptId: 1, destinationId: 'lounge', destinationRequestId: 0 };
  host.setPreferences(prefs, scope);
  host.attachToCurrentLoad({ ...scope, onSnapshot: patch => patches.push(patch) });
  const enter = overrides => host.enterDestination('lounge', prefs, { ...scope, signal: new AbortController().signal, ...overrides });
  return { host, patches, scope, enter, entries: () => entries, retries: () => retries };
}
test('only real readiness permits entry, never progress percentages', () => {
  const f = fixture(), task = f.host.beginLoad();
  task.progress({ phase: 'Loading the architecture', progress: 1 });
  assert.equal(f.enter(), false);
  assert.equal(f.patches.at(-1).download, undefined);
  task.ready(); assert.equal(f.enter().ok, true); assert.equal(f.enter(), false);
  assert.equal(f.entries(), 1);
});
test('late ready and error from a superseded attempt cannot change the new load', () => {
  const f = fixture(), old = f.host.beginLoad();
  f.host.retryCurrentLoad(); old.ready(); old.fail();
  const fresh = f.host.beginLoad();
  assert.equal(f.enter(), false); fresh.ready(); old.fail();
  assert.equal(f.enter().ok, true); assert.equal(f.retries(), 1);
});
test('aborted and wrong-room entry scopes never commit', () => {
  const f = fixture(), task = f.host.beginLoad(); task.ready();
  const abort = new AbortController(); abort.abort();
  assert.equal(f.enter({ signal: abort.signal }), false);
  assert.equal(f.enter({ destinationRequestId: 99 }), false);
  assert.equal(f.entries(), 0);
});
test('unsupported rooms and lighting are declined; Lite is available from first patch', () => {
  const f = fixture();
  assert.equal(f.patches[0].lightVersionAvailable, true);
  assert.equal(f.host.setPreferences({ ...prefs, destinationId: 'unknown' }, f.scope), false);
  assert.equal(f.host.setPreferences({ ...prefs, lightMode: 'unknown' }, f.scope), false);
});
test('disposed runtime and subscription cannot publish', () => {
  const f = fixture(), task = f.host.beginLoad(); task.cancel();
  const count = f.patches.length; task.ready(); assert.equal(f.patches.length, count);
});

test('kit bridge accepts current destination readiness and forwards arrival preferences', async () => {
  const { connectLivingMaquette } = await import('../src/intro/living-maquette/src/host/connect.mjs');
  let committed;
  const host = createWorldIntroHost({ preferences() {}, retry() {}, light() {}, enter(preferences) { committed = preferences; } });
  const task = host.beginLoad();
  const bridge = connectLivingMaquette(host, prefs, { destinations: ['lounge', 'motion-floor'] });
  bridge.controller.setDestination('motion-floor');
  bridge.controller.setDestination('lounge');
  assert.equal(bridge.controller.getSnapshot().canEnter, false);
  task.ready();
  assert.equal(bridge.controller.getSnapshot().canEnter, true);
  bridge.controller.setDestination('motion-floor');
  bridge.controller.setLightMode('soft');
  assert.equal(bridge.controller.getSnapshot().canEnter, true);
  assert.ok(await bridge.requestEntry());
  assert.equal(committed.destinationId, 'motion-floor');
  assert.equal(committed.lightMode, 'soft');
  bridge.dispose();
});
test('real kit retry rebinds entry to the new attempt without changing preferences', async () => {
  const { connectLivingMaquette } = await import('../src/intro/living-maquette/src/host/connect.mjs');
  let committed = 0;
  const host = createWorldIntroHost({ preferences() {}, retry() {}, light() {}, enter() { committed++; } });
  const old = host.beginLoad();
  const bridge = connectLivingMaquette(host, prefs, { destinations: ['lounge', 'motion-floor'] });
  try {
    const previous = bridge.controller.getSnapshot();
    old.fail();
    assert.ok(bridge.controller.requestRetry());
    await new Promise(resolve => setTimeout(resolve, 0));
    const fresh = host.beginLoad();
    old.ready();
    assert.equal(bridge.controller.getSnapshot().canEnter, false);
    fresh.ready();
    assert.equal(bridge.controller.getSnapshot().attemptId, previous.attemptId + 1);
    assert.equal(bridge.controller.getSnapshot().canEnter, true);
    assert.equal(host.enterDestination('lounge', prefs, {
      attemptId: previous.attemptId, destinationId: 'lounge',
      destinationRequestId: previous.destinationRequestId, signal: new AbortController().signal,
    }), false, 'the old attempt cannot enter the replacement runtime');
    assert.ok(await bridge.requestEntry(), 'the acknowledged retry can actually enter');
    assert.equal(committed, 1);
  } finally { bridge.dispose(); }
});
