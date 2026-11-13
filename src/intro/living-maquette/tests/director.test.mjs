/**
 * The decorative plan as pure functions of decorative time and a few facts.
 * Readiness flows in; nothing here can produce it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BEATS, CUES, interfaceCuesAt, targetsAt } from '../src/scene/director.mjs';
import { TIMELINE_PLAN } from '../src/config/timeline-plan.mjs';

const facts = (overrides = {}) => ({ ready: false, reduced: false, takenOver: false, roomChosen: false, paneCount: 12, ...overrides });
const within = (value, [start, end]) => value >= start && value < end;

test('the beat windows are the canonical 80-second plan', () => {
  assert.deepEqual(BEATS, TIMELINE_PLAN.beats.map((beat) => beat.seconds));
  assert.equal(BEATS[0][0], 0);
  assert.equal(BEATS.at(-1)[1], 80);
});

test('every authored cue sits inside the window the plan gives it', () => {
  const [promise, agency, structure, arrival, light, familiarity, entry] = BEATS;
  assert.ok(within(CUES.openingLight, promise));
  assert.ok(within(CUES.rotationHint, agency));
  assert.ok(within(CUES.passiveTurn[0], agency) && within(CUES.passiveTurn[1], agency));
  assert.ok(within(CUES.glazing, structure));
  assert.ok(within(CUES.glazing + 11 * CUES.glazingStagger, structure), 'the last pane lands inside the window');
  assert.ok(within(CUES.ceilingLine, structure));
  assert.ok(within(CUES.furnishing, structure) && within(CUES.furnishing + 5 * CUES.furnishingStagger, structure), 'the lounge resolves before the choice is highlighted');
  assert.ok(within(CUES.arrivalHighlight, arrival));
  assert.ok(within(CUES.lightIntroduced, light));
  assert.ok(within(CUES.detailHold[0], familiarity) && within(CUES.detailHold[1], familiarity));
  assert.ok(within(CUES.studiesHighlight, familiarity));
  assert.ok(within(CUES.settle, entry));
});

test('first frame: the bare structure with the roof lifted, nothing revealed', () => {
  const targets = targetsAt(0, facts());
  assert.equal(targets.phase, 'structure');
  assert.equal(targets.explode, 1);
  assert.equal(targets.revealed.size, 0);
  assert.equal(targets.passiveYawDeg, 0);
  assert.equal(targets.zoom, 1);
});

test('decorative time never assembles the model or shows the ready mask', () => {
  for (let t = 0; t <= 400; t += 0.5) {
    const targets = targetsAt(t, facts());
    assert.notEqual(targets.phase, 'ready', `t=${t}`);
    assert.ok(targets.explode > 0.5, `t=${t}`);
    assert.equal(targets.revealed.has('front-centre'), false, `t=${t}`);
  }
});

test('host readiness pre-empts every beat at once', () => {
  for (const t of [0, 3, 11.9, 26, 41, 57, 71, 200]) {
    const targets = targetsAt(t, facts({ ready: true }));
    assert.equal(targets.phase, 'ready');
    assert.equal(targets.explode, 0);
    assert.equal(targets.zoom, 1);
    assert.equal(targets.passiveYawDeg, 0);
    assert.equal(targets.revealed.has('front-centre'), true);
    assert.equal(targets.revealed.has('chair'), true);
    assert.equal(targets.revealed.size, 12 + 6 + 2);
  }
});

test('reduced motion: one composed still, no turn, no push-in, at any time', () => {
  const first = targetsAt(0, facts({ reduced: true }));
  assert.equal(first.phase, 'exploded');
  assert.equal(first.revealed.has('pane:0'), true);
  assert.equal(first.revealed.has('chair'), true);
  for (const t of [0, 5, 30, 60, 90]) {
    const targets = targetsAt(t, facts({ reduced: true }));
    assert.equal(targets.passiveYawDeg, 0);
    assert.equal(targets.zoom, 1);
    assert.equal(targets.explode, 1);
    assert.deepEqual([...targets.revealed].sort(), [...first.revealed].sort());
  }
  assert.deepEqual(interfaceCuesAt(0, { reduced: true }), { rotationHint: true, lightIntroduced: true, arrivalHighlight: false, studiesHighlight: false });
});

test('the one authored turn is small, and stops as soon as the visitor takes over', () => {
  let peak = 0;
  for (let t = 0; t <= 120; t += 0.25) {
    const yaw = targetsAt(t, facts()).passiveYawDeg;
    peak = Math.max(peak, Math.abs(yaw));
    assert.equal(targetsAt(t, facts({ takenOver: true })).passiveYawDeg, 0, `t=${t}`);
    assert.equal(targetsAt(t, facts({ takenOver: true })).zoom, 1, `t=${t}`);
  }
  assert.ok(peak > 0 && peak <= 5);
  assert.equal(targetsAt(BEATS[1][0] - 0.1, facts()).passiveYawDeg, 0, 'nothing turns before the agency beat');
});

test('the glass arrives pane by pane, then the light line, then the lounge', () => {
  assert.equal(targetsAt(CUES.glazing - 0.1, facts()).revealed.size, 0);
  assert.equal(targetsAt(CUES.glazing, facts()).revealed.has('pane:0'), true);
  assert.equal(targetsAt(CUES.glazing, facts()).revealed.has('pane:1'), false);
  assert.equal(targetsAt(CUES.glazing + 12 * CUES.glazingStagger, facts()).revealed.has('pane:11'), true);
  assert.ok(targetsAt(CUES.ceilingLine - 0.1, facts()).ceilingLine < 0.5);
  assert.equal(targetsAt(CUES.ceilingLine, facts()).ceilingLine, 1);
  assert.equal(targetsAt(CUES.furnishing - 0.1, facts()).revealed.has('chair'), false);
  assert.equal(targetsAt(CUES.furnishing, facts()).revealed.has('chair'), true);
  assert.equal(targetsAt(BEATS[3][0], facts()).revealed.has('tree_upper'), true);
});

test('a chosen room is furnished at once, whatever the beat', () => {
  const targets = targetsAt(1, facts({ roomChosen: true }));
  assert.equal(targets.phase, 'exploded', 'the open-front mask, so the room can be seen');
  assert.equal(targets.revealed.has('chair'), true);
  assert.equal(targets.revealed.has('workspace'), true);
  assert.equal(targets.revealed.has('pane:0'), false, 'the glass still follows its own beat');
});

test('interface cues follow decorative time only', () => {
  assert.equal(interfaceCuesAt(3.9, { reduced: false }).rotationHint, false);
  assert.equal(interfaceCuesAt(4, { reduced: false }).rotationHint, true);
  assert.equal(interfaceCuesAt(39.9, { reduced: false }).lightIntroduced, false);
  assert.equal(interfaceCuesAt(40, { reduced: false }).lightIntroduced, true);
  assert.equal(interfaceCuesAt(26, { reduced: false }).arrivalHighlight, true);
  assert.equal(interfaceCuesAt(33, { reduced: false }).arrivalHighlight, false, 'a single, short emphasis');
  assert.equal(interfaceCuesAt(63, { reduced: false }).studiesHighlight, true);
  assert.equal(interfaceCuesAt(90, { reduced: false }).studiesHighlight, false);
});

test('beyond 80 seconds the view holds: no loop, no countdown, no further change', () => {
  const at = (t) => {
    const { revealed, ...rest } = targetsAt(t, facts());
    return { ...rest, revealed: [...revealed].sort() };
  };
  assert.equal(at(80).settled, true);
  assert.deepEqual(at(81), at(600));
  assert.equal(at(600).phase, 'exploded');
});
