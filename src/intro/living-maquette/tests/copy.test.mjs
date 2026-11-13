/**
 * Copy integrity. With LM_KIT=<path to the extracted kit> the generated modules
 * are compared with the kit's own files; without it the structural checks run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COPY, COPY_DECK, DESTINATIONS, HEADING_LINES, KIT_COPY_DECK, LIGHTS, SCREEN_COPY, headingLines, renameLite } from '../src/config/copy.mjs';
import { STUDY_CATALOG } from '../src/config/study-catalog.mjs';
import { TIMELINE_PLAN } from '../src/config/timeline-plan.mjs';

const kit = process.env.LM_KIT;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('generated modules equal the kit files', { skip: kit && existsSync(kit) ? false : 'set LM_KIT to the extracted kit to compare' }, () => {
  const read = (path) => JSON.parse(readFileSync(join(kit, path), 'utf8'));
  assert.deepEqual(plain(KIT_COPY_DECK), read('01_ui_package/handoff/copy_deck.json'));
  assert.deepEqual(plain(STUDY_CATALOG), read('01_ui_package/handoff/study_catalog.json'));
  assert.deepEqual(plain(TIMELINE_PLAN), read('01_ui_package/handoff/ux_specification.json').adaptable_80_second_plan);
  for (const [theirs, ours] of [
    ['01_ui_package/components/loader-controller.mjs', 'src/kit/loader-controller.mjs'],
    ['01_ui_package/components/loader-integration-example.mjs', 'src/kit/loader-integration-example.mjs'],
    ['05_components/maquette-scene-adapter.mjs', 'src/kit/maquette-scene-adapter.mjs'],
  ]) {
    assert.equal(readFileSync(new URL(`../${ours}`, import.meta.url), 'utf8'), readFileSync(join(kit, theirs), 'utf8'), ours);
  }
});

test('the two rooms and two lights use the deck labels', () => {
  assert.deepEqual(Object.keys(DESTINATIONS), ['lounge', 'motion-floor']);
  assert.equal(DESTINATIONS.lounge.label, 'The lounge');
  assert.equal(DESTINATIONS['motion-floor'].label, 'Motion floor');
  assert.equal(DESTINATIONS.lounge.enter, 'Enter the lounge');
  assert.equal(DESTINATIONS['motion-floor'].enter, 'Enter the Motion floor');
  assert.deepEqual(Object.values(LIGHTS).map((light) => light.label), ['Warm', 'Soft']);
});

test('filled patterns read as the approved screens do', () => {
  assert.equal(COPY.preparingDestination('motion-floor'), 'Preparing Motion floor'); // D05, M02
  assert.equal(COPY.preparingDestination('lounge'), 'Preparing the lounge');
  assert.equal(COPY.destinationAnnouncement('motion-floor'), 'First stop: Motion floor.');
  assert.equal(COPY.lightAnnouncement('soft'), 'Soft light selected.');
  assert.equal(COPY.enteringStatus('motion-floor'), 'Entering the Motion floor');
  assert.equal(COPY.welcomeHeading('lounge'), 'Welcome to the lounge.'); // T01
  assert.equal(COPY.arrivalSupporting('warm'), 'Your warm light and first stop are set.'); // T01
  assert.equal(COPY.studyActionName('Light'), 'Explore Light study');
  assert.equal(COPY.percentText(64), 'Scene download: 64 percent.');
  assert.equal(COPY.phaseState('Light', 'current'), 'Light in progress');
  assert.equal(COPY.phaseState('Structure', 'complete'), 'Structure complete');
  assert.equal(COPY.phaseState('Welcome', 'pending'), 'Welcome pending');
});

test('recovery copy never names an action the host does not offer', () => {
  assert.equal(COPY.failedBody({ canRetry: true, lightVersion: true }), COPY_DECK.states.failed.body);
  assert.equal(COPY.failedBody({ canRetry: true, lightVersion: false }), 'We could not finish preparing the studio.');
  assert.equal(COPY.failedBody({ canRetry: false, lightVersion: true }), 'We could not finish preparing the studio.');
  assert.equal(COPY.stalledBody({ lightVersion: true }), COPY_DECK.states.suspected_stall.body);
  assert.equal(COPY.stalledBody({ lightVersion: false }), 'Your choices are kept.');
});

test('screen-only strings are present, short and free of placeholders they do not fill', () => {
  for (const [key, value] of Object.entries(SCREEN_COPY)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.trim().length > 0 && value.length < 90, key);
  }
  assert.equal((SCREEN_COPY.arrivalSupporting.match(/\{\w+\}/g) ?? []).join(), '{light}');
});

test('headline line hints are drawn headlines of the deck, word for word', () => {
  const strings = new Set();
  const collect = (value) => {
    if (typeof value === 'string') strings.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(COPY_DECK);
  for (const layout of ['desktop', 'stacked']) {
    for (const [heading, lines] of Object.entries(HEADING_LINES[layout])) {
      assert.equal(lines.join(' '), heading, `${layout}: ${heading}`);
      assert.ok(strings.has(heading), `${layout}: "${heading}" is deck copy`);
    }
  }
  assert.equal(headingLines('desktop', 'Not a drawn headline.'), null);
  assert.deepEqual(headingLines('stacked', 'A little longer.'), ['A little longer.']);
});

test('the studies are the three labelled previews, never client work', () => {
  assert.deepEqual(STUDY_CATALOG.studies.map((study) => study.title), ['Space', 'Light', 'Form']);
  assert.equal(STUDY_CATALOG.card_badge, 'Preview study');
  for (const study of STUDY_CATALOG.studies) {
    assert.ok(study.image_alt.length > 20, 'each still has a real description');
    assert.ok(existsSync(new URL(`../assets/images/studies/${study.detail_web_image.split('/').pop()}`, import.meta.url)), study.id);
    assert.ok(existsSync(new URL(`../assets/images/studies/${study.id}-thumb.webp`, import.meta.url)), `${study.id} thumbnail`);
  }
});

test('the shown deck is the kit deck with only the Lite Version rename', () => {
  assert.deepEqual(COPY_DECK, renameLite(KIT_COPY_DECK));
  assert.equal(COPY_DECK.states.failed.body, 'We could not finish preparing the studio. Try again, or use the Lite Version.');
  assert.equal(COPY_DECK.global.light_version, 'Use Lite Version');
  const flat = JSON.stringify(COPY_DECK);
  assert.ok(!/light version/i.test(flat));
  // Everything else is untouched.
  assert.equal(JSON.stringify(KIT_COPY_DECK).replace(/\b[Ll]ight version\b/g, 'Lite Version'), flat);
});
