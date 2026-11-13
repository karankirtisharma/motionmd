/**
 * Presentation rules, checked against snapshots from the kit's own controller.
 * The scenario names follow ux_specification.json (acceptance_scenarios and
 * nonnegotiable_behaviour).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoaderController, getLoadScope } from '../src/kit/loader-controller.mjs';
import { COPY, COPY_DECK, SCREEN_COPY } from '../src/config/copy.mjs';
import { present } from '../src/ui/present.mjs';

const S = COPY_DECK.states;
const desktop = { layout: 'desktop', graphics: '3d' };
const stacked = { layout: 'stacked', graphics: '3d' };

function controllerAt(patches = [], options = {}) {
  const controller = createLoaderController(options);
  for (const patch of patches) controller.updateHost({ attemptId: 0, ...patch });
  return controller;
}
const scoped = (controller, patch) => ({ ...getLoadScope(controller.getSnapshot()), ...patch });
const grant = (controller) => controller.updateHost(scoped(controller, { phase: 'ready', readyForEntry: true }));

test('boot before any host phase: neutral status, every step pending, no numeral', () => {
  const model = present(createLoaderController().getSnapshot(), desktop);
  assert.equal(model.mode, 'loading');
  assert.equal(model.heading, S.boot.heading);
  assert.equal(model.status.label, S.boot.status);
  assert.equal(model.status.progress.kind, 'idle');
  assert.equal(model.status.progress.percent, null);
  assert.deepEqual(model.status.phases.map((phase) => phase.state), ['pending', 'pending', 'pending', 'pending']);
  assert.equal(model.enter, null);
});

test('measured bytes with a valid total: a floored percentage labelled Scene download', () => {
  const controller = controllerAt([{ phase: 'structure', download: { loadedBytes: 639, totalBytes: 1000, scope: 'scene' } }]);
  const model = present(controller.getSnapshot(), desktop);
  assert.equal(model.status.progress.kind, 'determinate');
  assert.equal(model.status.progress.percent, 63);
  assert.equal(model.status.supporting, SCREEN_COPY.sceneDownload);
  assert.equal(model.status.label, S.structure.status);
  assert.deepEqual(model.status.phases.map((phase) => phase.state), ['current', 'pending', 'pending', 'pending']);
});

test('99.6 percent is never shown as 100', () => {
  const controller = controllerAt([{ phase: 'details', download: { loadedBytes: 996, totalBytes: 1000 } }]);
  assert.equal(present(controller.getSnapshot(), desktop).status.progress.percent, 99);
});

test('unknown download total: no invented percentage', () => {
  const controller = controllerAt([{ phase: 'structure', download: { loadedBytes: 5_000_000, totalBytes: null } }]);
  const model = present(controller.getSnapshot(), desktop);
  assert.equal(model.status.progress.kind, 'indeterminate');
  assert.equal(model.status.progress.percent, null);
  assert.notEqual(model.status.supporting, SCREEN_COPY.sceneDownload);
});

test('a long graphics task shows the host label, calmly, and is not an error', () => {
  const controller = controllerAt([{ phase: 'light', taskLabel: 'Preparing graphics' }]);
  controller.setElapsedMs(60_000);
  const model = present(controller.getSnapshot(), desktop);
  assert.equal(model.mode, 'loading');
  assert.equal(model.status.label, 'Preparing graphics');
  assert.equal(model.status.progress.kind, 'indeterminate');
  assert.equal(model.recovery.visible, false);
});

test('elapsed time alone never offers entry; beyond the expected wait it reads as still preparing', () => {
  const controller = controllerAt([{ phase: 'details' }]);
  controller.setElapsedMs(200_000);
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.canEnter, false);
  const model = present(snapshot, desktop);
  assert.equal(model.mode, 'slow');
  assert.equal(model.enter, null);
  assert.equal(model.heading, S.slow.heading);
  assert.equal(model.body, `${S.slow.body} ${S.slow.supporting}`);
  assert.equal(model.recovery.visible, false, 'a long active wait is not a failure');
  assert.equal(present(snapshot, stacked).heading, COPY_DECK.rendered_screen_variants.M04.heading);
});

test('ready at two seconds: entry is the action, nothing else is required', () => {
  const controller = controllerAt([{ phase: 'structure' }]);
  controller.setElapsedMs(2_000);
  grant(controller);
  const model = present(controller.getSnapshot(), desktop);
  assert.equal(model.mode, 'ready');
  assert.equal(model.heading, S.ready.heading_lounge);
  assert.equal(model.body, COPY_DECK.rendered_screen_variants.D08.body);
  assert.equal(model.enter.label, S.ready.enter_lounge);
  assert.equal(model.status.progress.kind, 'hidden');
  assert.equal(model.status.phases[3].state, 'current');
  assert.equal(model.destination.visible, true, 'the choices stay available');
  const compact = present(controller.getSnapshot(), stacked);
  assert.equal(compact.heading, COPY_DECK.rendered_screen_variants.M03.heading);
  assert.equal(compact.body, COPY_DECK.rendered_screen_variants.M03.body);
});

test('destination changed after ready: honestly back to loading for the new room', () => {
  const controller = controllerAt([{ phase: 'details' }]);
  grant(controller);
  assert.equal(present(controller.getSnapshot(), desktop).mode, 'ready');
  controller.setDestination('motion-floor');
  const model = present(controller.getSnapshot(), desktop);
  assert.equal(model.mode, 'loading');
  assert.equal(model.enter, null);
  assert.equal(model.status.label, 'Preparing Motion floor');
  assert.equal(model.note.text, S.destination.motion_floor_description, 'D05: the chosen room is described while it prepares');
  grant(controller);
  const ready = present(controller.getSnapshot(), desktop);
  assert.equal(ready.heading, S.ready.heading_motion_floor);
  assert.equal(ready.enter.label, S.ready.enter_motion_floor);
  assert.deepEqual(ready.headingLines, ['The Motion floor', 'is ready', 'for you.']);
});

test('lounge, Motion floor, lounge: the first lounge result cannot unlock the latest request', () => {
  const controller = controllerAt([{ phase: 'details' }]);
  const firstLounge = getLoadScope(controller.getSnapshot());
  controller.setDestination('motion-floor');
  controller.setDestination('lounge');
  assert.equal(controller.updateHost({ ...firstLounge, phase: 'ready', readyForEntry: true }), false);
  assert.equal(present(controller.getSnapshot(), desktop).enter, null);
  grant(controller);
  assert.equal(present(controller.getSnapshot(), desktop).mode, 'ready');
});

test('the light version is offered from initial loading whenever the host has one, and never otherwise', () => {
  const without = present(controllerAt([{ phase: 'boot' }]).getSnapshot(), desktop);
  assert.equal(without.links.lightVersion, false);
  const withRoute = present(controllerAt([{ phase: 'boot', lightVersionAvailable: true }]).getSnapshot(), desktop);
  assert.equal(withRoute.links.lightVersion, true);
});

test('suspected stall: only the actions the host supports, and Keep waiting', () => {
  const none = controllerAt([{ phase: 'light', health: 'suspected-stall' }]);
  let model = present(none.getSnapshot(), desktop);
  assert.equal(model.mode, 'stalled');
  assert.equal(model.heading, S.suspected_stall.heading);
  assert.equal(model.recovery.retry, null);
  assert.equal(model.recovery.lightVersion, null);
  assert.ok(model.recovery.keepWaiting);
  assert.equal(model.body, 'Your choices are kept.', 'no light version is mentioned when there is none');

  const both = controllerAt([{ phase: 'light', health: 'suspected-stall', canRetry: true, lightVersionAvailable: true }]);
  model = present(both.getSnapshot(), desktop);
  assert.equal(model.body, S.suspected_stall.body);
  assert.equal(model.recovery.retry.label, S.failed.retry);
  assert.ok(model.recovery.lightVersion);
  assert.equal(model.status.phases[1].state, 'current', 'the rail stays on the phase the host reported');

  // The stall copy says the choices are kept once: no second line repeats it,
  // and the compact rail points at the actions instead.
  assert.equal(model.note, null);
  const compact = present(both.getSnapshot(), stacked);
  assert.equal(compact.note, null);
  assert.equal(compact.status.supporting, COPY.variant.M07.status_supporting);

  // Keep waiting returns the choices and leaves a way back to the actions.
  const waiting = present(both.getSnapshot(), { ...desktop, stallDismissed: true });
  assert.equal(waiting.mode, 'stalled-waiting');
  assert.equal(waiting.destination.visible, true);
  assert.equal(waiting.status.recoveryReopen, true);
});

test('failure: actual host evidence, recovery by what is supported, choices kept', () => {
  const controller = controllerAt([
    { phase: 'light' },
    { phase: 'failed', health: 'failed', error: { code: 'scene-failed' }, canRetry: true, lightVersionAvailable: true },
  ]);
  const model = present(controller.getSnapshot(), { ...desktop, lastMappedPhase: 'light' });
  assert.equal(model.mode, 'failed');
  assert.equal(model.heading, S.failed.heading);
  assert.equal(model.body, S.failed.body);
  assert.equal(model.status.label, S.failed.status);
  assert.equal(model.status.progress.kind, 'idle');
  assert.equal(model.status.phases[1].state, 'current', 'the rail stays where the host last was');
  assert.equal(model.note.text, S.retrying.body);
  assert.equal(model.links.studies, true, 'Explore studies stays through failure');
  assert.equal(model.destination.visible, false);
  assert.equal(present(controller.getSnapshot(), stacked).status.supporting, COPY_DECK.rendered_screen_variants.M07.status_supporting);

  const retryOnly = controllerAt([{ phase: 'failed', health: 'failed', error: { code: 'x' }, canRetry: true }]);
  const partial = present(retryOnly.getSnapshot(), desktop);
  assert.equal(partial.body, 'We could not finish preparing the studio.');
  assert.equal(partial.recovery.lightVersion, null);
});

test('main graphics failure uses the verified-device copy', () => {
  const controller = controllerAt([{ phase: 'failed', health: 'failed', error: { code: 'main-graphics-failed' }, lightVersionAvailable: true }]);
  assert.equal(present(controller.getSnapshot(), desktop).body, S.graphics_fallback.main_graphics_failed_body);
});

test('retry: one request, a busy action, preferences intact', () => {
  const requests = [];
  const controller = createLoaderController({ hooks: { onRetry: (request) => { requests.push(request); } } });
  controller.setLightMode('soft');
  controller.updateHost({ attemptId: 0, phase: 'failed', health: 'failed', error: { code: 'x' }, canRetry: true });
  assert.ok(controller.requestRetry());
  assert.equal(controller.requestRetry(), null, 'a second activation does nothing while the first is pending');
  assert.equal(requests.length, 1);
  const model = present(controller.getSnapshot(), stacked);
  assert.equal(model.mode, 'retrying');
  assert.equal(model.heading, S.retrying.heading);
  assert.equal(model.recovery.retry.busy, true);
  assert.equal(model.recovery.retry.label, COPY_DECK.rendered_screen_variants.M08.busy_action);
  assert.equal(controller.getSnapshot().preferences.lightMode, 'soft');
  // The old attempt can no longer speak.
  assert.equal(controller.updateHost({ attemptId: 0, phase: 'details' }), false);
});

test('entry acknowledgement pending and entry failure are shown without claiming success', () => {
  const controller = controllerAt([{ phase: 'details' }]);
  grant(controller);
  const pending = present(controller.getSnapshot(), { ...desktop, entry: 'pending' });
  assert.equal(pending.enter.busy, true);
  assert.equal(pending.status.label, 'Entering the lounge');
  const failed = present(controller.getSnapshot(), { ...desktop, entry: 'failed' });
  assert.equal(failed.enter.busy, false);
  assert.deepEqual(failed.note, { text: S.entering.entry_error, tone: 'error' });
});

test('device guidance appears only when the host environment confirms it', () => {
  const controller = controllerAt([{ phase: 'details' }]);
  grant(controller);
  assert.equal(present(controller.getSnapshot(), desktop).enter.hint, null);
  assert.equal(present(controller.getSnapshot(), desktop).note, null);
  const keyboard = present(controller.getSnapshot(), { ...desktop, entryHint: 'keyboard' });
  assert.equal(keyboard.enter.hint, S.ready.desktop_hint);
  assert.equal(keyboard.note.text, S.ready.desktop_hint, 'desktop: on the hint line');
  assert.equal(keyboard.status.ready.supporting, SCREEN_COPY.readySupporting, 'the rail keeps its own line');
  const touch = present(controller.getSnapshot(), { ...stacked, entryHint: 'touch' });
  assert.equal(touch.enter.hint, S.ready.mobile_hint);
  assert.equal(touch.note, null, 'compact: under the Enter action instead');
});

test('the light control sits in the header from first paint, unless the site cannot honour it', () => {
  const snapshot = controllerAt([{ phase: 'structure' }]).getSnapshot();
  assert.equal(present(snapshot, desktop).light.visible, true);
  assert.equal(present(snapshot, stacked).light.visible, true);
  assert.equal(present(snapshot, { ...desktop, lightAvailable: false }).light.visible, false);
});

test('the version choice: offered while choosing whenever the host has a lighter route', () => {
  const snapshot = controllerAt([{ phase: 'light', lightVersionAvailable: true }]).getSnapshot();
  const model = present(snapshot, desktop);
  assert.equal(model.version.visible, true);
  assert.equal(present(controllerAt([{ phase: 'light' }]).getSnapshot(), desktop).version.visible, false);
  assert.equal(model.version.busy, false);
  // The light phase keeps the arrival line (2026-11 reference).
  assert.equal(model.body, S.structure.body);
  assert.equal(model.status.label, S.light.status);
  // No reduce-motion control any more: reduced motion follows the system.
  assert.equal(model.toggles.motion, undefined);
});

test('hint lines: the deck hints on desktop, none on compact screens', () => {
  const light = controllerAt([{ phase: 'light' }]).getSnapshot();
  // The light control is in the header now, so its hint line went with it.
  assert.equal(present(light, { ...desktop, lightIntroduced: true }).note, null);
  assert.equal(present(light, { ...stacked, lightIntroduced: true }).note, null);
  const details = controllerAt([{ phase: 'details' }]).getSnapshot();
  assert.equal(present(details, desktop).note.text, S.details.hint);
  assert.equal(present(details, desktop).heading, S.details.heading);
});

test('reduced motion and the still fallback hide rotation and keep every choice', () => {
  const reduced = createLoaderController({ initialPreferences: { reducedMotion: true } });
  let model = present(reduced.getSnapshot(), desktop);
  assert.equal(model.rotation.visible, false);
  assert.equal(model.destination.visible, true);

  model = present(createLoaderController().getSnapshot(), { layout: 'desktop', graphics: 'still' });
  assert.equal(model.rotation.visible, false);
  assert.equal(model.body, S.graphics_fallback.body);
  assert.equal(model.destination.visible, true);
  assert.equal(model.links.studies, true);
});

test('the sound toggle exists only when the host has sound, and starts off', () => {
  const snapshot = createLoaderController().getSnapshot();
  assert.equal(snapshot.preferences.soundEnabled, false);
  assert.equal(present(snapshot, { ...desktop, soundAvailable: false }).toggles.sound, null);
  const toggle = present(snapshot, { ...desktop, soundAvailable: true }).toggles.sound;
  assert.deepEqual(toggle, { pressed: false, label: COPY_DECK.global.sound_off });
});

test('headline line hints never change the string', () => {
  const model = present(createLoaderController().getSnapshot(), desktop);
  assert.deepEqual(model.headingLines, ['Your first room', 'is taking', 'shape.']);
  assert.equal(model.headingLines.join(' '), model.heading);
  const compact = present(createLoaderController().getSnapshot(), stacked);
  assert.deepEqual(compact.headingLines, ['Your first room', 'is taking shape.']);
  assert.equal(COPY.slowBodyCompact, 'The full studio is still preparing. Your choices are kept.');
});

test('controls the site cannot honour are omitted', () => {
  const snapshot = controllerAt([{ phase: 'light' }]).getSnapshot();
  const oneRoom = present(snapshot, { ...desktop, destinations: ['lounge'], lightIntroduced: true });
  assert.equal(oneRoom.destination.visible, false, 'a single permitted room is not offered as a choice');
  const oneLight = present(snapshot, { ...stacked, lightAvailable: false });
  assert.equal(oneLight.light.visible, false, 'no light control unless the site applies Warm and Soft');
  assert.equal(present(snapshot, { ...desktop, lightIntroduced: true, lightAvailable: false }).note, null);
});
