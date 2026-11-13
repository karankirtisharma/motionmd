import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldIntroHost } from '../src/intro/worldIntroHost.mjs';
const prefs = { destinationId: 'lounge', lightMode: 'warm', sound: false, reducedMotion: false };
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
  assert.equal(f.host.setPreferences({ ...prefs, destinationId: 'motion-floor' }, f.scope), false);
  assert.equal(f.host.setPreferences({ ...prefs, lightMode: 'soft' }, f.scope), false);
});
test('disposed runtime and subscription cannot publish', () => {
  const f = fixture(), task = f.host.beginLoad(); task.cancel();
  const count = f.patches.length; task.ready(); assert.equal(f.patches.length, count);
});
