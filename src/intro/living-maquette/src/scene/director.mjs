/**
 * Decorative direction for the miniature.
 *
 * The canonical pacing is the kit's adaptable_80_second_plan (see
 * src/config/timeline-plan.mjs). The director turns decorative time and a few
 * facts from the interface (is the room ready, which room, which light, is
 * motion reduced, has the visitor taken over the model) into targets, and
 * eases the scene towards them. It never produces progress or readiness:
 * `ready` flows in from the host through the controller, never out.
 *
 * Because the scene always follows targets, any beat can be interrupted:
 * readiness resolves the model at once, a room change swaps the furnishings,
 * reduced motion composes a still, and a hidden tab simply pauses the clock.
 */
import { TIMELINE_PLAN } from '../config/timeline-plan.mjs';

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (t) => t * t * (3 - 2 * t);

/** Beat windows from the canonical plan, in seconds: [[0,4],[4,12],…]. */
export const BEATS = Object.freeze(TIMELINE_PLAN.beats.map((beat) => Object.freeze([...beat.seconds])));
const [PROMISE, AGENCY, STRUCTURE, ARRIVAL, LIGHT, FAMILIARITY, ENTRY] = BEATS;

/** Authored cue times inside the plan's windows (seconds of decorative time). */
export const CUES = Object.freeze({
  openingLight: PROMISE[0] + 0.5,          // one quiet light change establishes depth
  rotationHint: AGENCY[0],                 // the rotation control appears once
  passiveTurn: [AGENCY[0] + 0.8, AGENCY[1] - 2.2], // one very limited authored angle change
  glazing: STRUCTURE[0],                   // the glass layer arrives, pane by pane
  glazingStagger: 0.16,
  ceilingLine: STRUCTURE[0] + 5,           // one architectural detail: the light line
  arrivalHighlight: ARRIVAL[0] + 0.6,      // the first-stop choice is gently highlighted
  lightIntroduced: LIGHT[0],               // Warm / Soft appears
  // The lower lounge resolves before the first-stop choice is highlighted, as
  // in the kit's samples for this window (KF_06 at 20 s, KF_07 at 24 s).
  furnishing: STRUCTURE[0] + 8,            // chair, table, sculpture, plants
  furnishingStagger: 0.8,
  detailHold: [FAMILIARITY[0] + 1, FAMILIARITY[1] - 2], // one stable focal point
  studiesHighlight: FAMILIARITY[0] + 7,
  settle: ENTRY[0],                        // the view settles
  end: ENTRY[1],
});

const DETAIL_HOLD_ZOOM = 1.05;
const DETAIL_HOLD_ANCHOR = Object.freeze([0.04, 0.04]);
const ENTRY_ANCHOR = Object.freeze([0.5, 0.56]);

const FURNISHING_ORDER = Object.freeze(['chair', 'table', 'ribbon', 'tree_lower', 'accessories', 'tree_upper']);

/**
 * Pure: what the scene should look like at decorative time `t`.
 * @param {number} t seconds
 * @param {{ready:boolean, reduced:boolean, takenOver:boolean, roomChosen:boolean, paneCount:number}} facts
 */
export function targetsAt(t, facts) {
  const { ready, reduced, takenOver, roomChosen, paneCount = 0 } = facts;
  const revealed = new Set();
  const everyPane = () => { for (let i = 0; i < paneCount; i += 1) revealed.add(`pane:${i}`); };
  const everyFurnishing = () => { for (const id of FURNISHING_ORDER) revealed.add(id); revealed.add('workspace'); };

  if (ready) {
    everyPane();
    everyFurnishing();
    revealed.add('front-centre');
    return { phase: 'ready', explode: 0, revealed, ceilingLine: 1, passiveYawDeg: 0, zoom: 1, openingLight: false, settled: true };
  }
  if (reduced) {
    // A still, composed loading state: nothing assembles on its own.
    everyPane();
    everyFurnishing();
    return { phase: 'exploded', explode: 1, revealed, ceilingLine: 1, passiveYawDeg: 0, zoom: 1, openingLight: false, settled: true };
  }

  const structural = t >= CUES.glazing;
  if (structural) {
    for (let i = 0; i < paneCount; i += 1) if (t >= CUES.glazing + i * CUES.glazingStagger) revealed.add(`pane:${i}`);
  }
  if (roomChosen) everyFurnishing(); // a chosen room is shown at once
  else {
    FURNISHING_ORDER.forEach((id, index) => { if (t >= CUES.furnishing + index * CUES.furnishingStagger) revealed.add(id); });
    if (t >= CUES.furnishing) revealed.add('workspace');
  }

  // One limited authored turn, then a small return; none once the visitor has taken over.
  let passiveYawDeg = 0;
  if (!takenOver) {
    const [turnStart, turnEnd] = CUES.passiveTurn;
    if (t >= turnStart) passiveYawDeg = 5 * smooth(clamp((t - turnStart) / (turnEnd - turnStart), 0, 1));
    if (t >= CUES.glazing) passiveYawDeg = 2;
    // The detail hold turns the lounge a few degrees towards the visitor.
    if (t >= CUES.detailHold[0] && t < CUES.detailHold[1]) passiveYawDeg = -3;
    if (t >= CUES.settle) passiveYawDeg = 0;
  }
  const holding = !takenOver && t >= CUES.detailHold[0] && t < CUES.detailHold[1];

  return {
    // Furnishing chosen early needs the open-front mask even before the glazing beat.
    phase: structural || roomChosen ? 'exploded' : 'structure',
    explode: t >= CUES.settle ? 0.72 : 1,
    revealed,
    ceilingLine: t >= CUES.ceilingLine ? 1 : 0.14,
    passiveYawDeg,
    // The detail hold is a small push-in that keeps the model's top-left
    // corner where it was: nothing moves towards the headline or the toggles.
    zoom: holding ? DETAIL_HOLD_ZOOM : 1,
    openingLight: t < CUES.openingLight,
    settled: t >= CUES.end,
  };
}

/** Interface cues that depend only on decorative time (never on readiness). */
export function interfaceCuesAt(t, { reduced }) {
  if (reduced) return { rotationHint: true, lightIntroduced: true, arrivalHighlight: false, studiesHighlight: false };
  return {
    rotationHint: t >= CUES.rotationHint,
    lightIntroduced: t >= CUES.lightIntroduced,
    arrivalHighlight: t >= CUES.arrivalHighlight && t < CUES.arrivalHighlight + 6,
    studiesHighlight: t >= CUES.studiesHighlight && t < CUES.studiesHighlight + 6,
  };
}

/** Critically damped follower: smooth start, smooth stop, no overshoot. */
function createFollower(value, smoothTime) {
  let velocity = 0;
  return {
    get value() { return value; },
    snap(next) { value = next; velocity = 0; },
    step(target, dt) {
      const omega = 2 / Math.max(0.0001, smoothTime);
      const x = omega * dt;
      const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = value - target;
      const temp = (velocity + omega * change) * dt;
      velocity = (velocity - omega * temp) * decay;
      const next = target + (change + temp) * decay;
      const settled = Math.abs(next - target) < 1e-4 && Math.abs(velocity) < 1e-4;
      value = settled ? target : next;
      if (settled) velocity = 0;
      return !settled;
    },
  };
}

export function createDirector({ stage, manifest, initial = {}, onInterfaceCues, now = () => performance.now() }) {
  const look = stage.look;
  const idOf = (node) => node.userData?.maquette_id ?? node.name;

  // ---------------------------------------------------------- reveal groups
  // Mesh-bearing kit nodes, grouped for authored reveals. A group is either
  // listed by the manifest (detail_groups) or derived from the glazing names.
  function drawableChildren(root) {
    const nodes = [];
    for (const node of root.children) {
      let drawable = false;
      node.traverse((child) => { if (child.isMesh && !child.userData.maquette_anchor) drawable = true; });
      if (drawable) nodes.push(node);
    }
    return nodes;
  }
  const membersOf = (node) => {
    const members = node.userData?.maquette_members;
    return typeof members === 'string' ? members.split('|') : [idOf(node)];
  };
  const groups = new Map(); // key -> { nodes, follower, lift, meshes }
  function addGroup(key, nodes, lift) {
    if (!nodes.length) return;
    groups.set(key, { key, nodes, lift, follower: createFollower(0, 0.24), transient: null, shown: false });
  }

  const mainNodes = drawableChildren(stage.mainRoot);
  const detailGroups = manifest.detail_groups ?? {};
  for (const key of FURNISHING_ORDER) {
    const ids = new Set(detailGroups[key] ?? []);
    // A small settle from above. The upper tree rides the upper floor's pose,
    // so it fades in place instead.
    addGroup(key, mainNodes.filter((node) => membersOf(node).every((id) => ids.has(id))), key === 'tree_upper' ? 0 : 0.16);
  }
  const frontCentreIds = new Set(manifest.phase_visibility?.exploded?.hidden_ids ?? []);
  addGroup('front-centre', mainNodes.filter((node) => membersOf(node).every((id) => frontCentreIds.has(id))), 0);
  // Individual panes: glass and its frame share a pane key, ordered left to right, low to high.
  const paneKey = (node) => {
    const match = /^(?:Batch_)?Glass_(front|left|upper_internal_guard)(?:_(s\d)_(\d))?/.exec(idOf(node));
    return match ? `${match[1]}:${match[2] ?? ''}:${match[3] ?? ''}` : null;
  };
  const panes = new Map();
  for (const node of mainNodes) {
    const key = paneKey(node);
    if (!key || membersOf(node).every((id) => frontCentreIds.has(id))) continue;
    if (!panes.has(key)) panes.set(key, []);
    panes.get(key).push(node);
  }
  const paneOrder = [...panes.keys()].sort((a, b) => {
    const rank = (key) => {
      const [side, storey, index] = key.split(':');
      return (side === 'left' ? 0 : side === 'front' ? 100 : 200) + (storey === 's1' ? 10 : 0) + Number(index || 0);
    };
    return rank(a) - rank(b);
  });
  paneOrder.forEach((key, index) => addGroup(`pane:${index}`, panes.get(key), 0));
  const paneCount = paneOrder.length;

  function attachWorkspaceGroup() {
    if (groups.has('workspace') || !stage.workspaceRoot) return;
    addGroup('workspace', drawableChildren(stage.workspaceRoot), 0.16);
  }
  attachWorkspaceGroup(); // already loaded (stills, or a host that preloads it)

  // -------------------------------------------------------------- transients
  // While a group fades, its meshes use short-lived transparent copies of
  // their materials. The originals come back when the fade ends.
  function beginTransient(group) {
    if (group.transient) return;
    const entries = [];
    for (const node of group.nodes) {
      node.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const originals = mesh.material;
        const list = Array.isArray(originals) ? originals : [originals];
        const copies = list.map((material) => {
          const copy = material.clone();
          copy.userData = { ...material.userData, source: material, sourceOpacity: material.opacity, sourceEnv: material.envMapIntensity };
          copy.transparent = true;
          if (!material.transparent) copy.depthWrite = true;
          return copy;
        });
        entries.push({ mesh, originals, copies, castShadow: mesh.castShadow });
        mesh.material = Array.isArray(originals) ? copies : copies[0];
      });
    }
    group.transient = entries;
  }
  function updateTransient(group, amount) {
    if (!group.transient) return;
    for (const entry of group.transient) {
      for (const copy of entry.copies) {
        copy.opacity = copy.userData.sourceOpacity * amount;
        // Additive glass: fade the reflection with the tint.
        if (copy.userData.source.blending !== undefined && copy.userData.source.name === 'LM_Runtime_Glass') {
          copy.envMapIntensity = copy.userData.source.envMapIntensity * amount;
        }
      }
      entry.mesh.castShadow = entry.castShadow && amount > 0.45;
    }
  }
  function endTransient(group) {
    if (!group.transient) return;
    for (const entry of group.transient) {
      entry.mesh.material = entry.originals;
      entry.mesh.castShadow = entry.castShadow;
      for (const copy of entry.copies) copy.dispose();
    }
    group.transient = null;
  }

  // ------------------------------------------------------------------- state
  const facts = {
    ready: Boolean(initial.ready),
    reduced: Boolean(initial.reducedMotion),
    takenOver: false,
    roomChosen: false,
    destination: initial.destinationId ?? 'lounge',
    lightMode: initial.lightMode ?? 'warm',
    entering: false,
  };
  const followers = {
    explode: createFollower(1, 0.42),
    ceilingLine: createFollower(0.14, 0.5),
    yaw: createFollower(0, 0.55),
    zoom: createFollower(1, 1.1),
    light: createFollower(1, 0.7), // opens in the soft rig; the warm key arrives
    entry: createFollower(0, 0.38),
  };
  let userYaw = 0;
  let dragging = false;
  let adapterPhase = null;
  let appliedDestination = null;
  let swap = null; // { to } while the previous room's furnishing fades out
  let started = false;
  let disposed = false;
  let startTime = 0;
  let hiddenSince = null;
  let pausedTotal = 0;
  let lastStep = 0;
  let wakeTimer = 0;
  let stopAnimation = null;
  let lastCues = '';
  let seekTime = null;

  const clockSeconds = () => {
    if (seekTime !== null) return seekTime;
    if (!started) return 0;
    const reference = hiddenSince ?? now();
    return Math.max(0, (reference - startTime - pausedTotal) / 1000);
  };

  const roomGroups = (destination) => (destination === 'motion-floor'
    ? ['workspace']
    : (manifest.destination_hide_groups?.['motion-floor'] ?? ['chair', 'table', 'ribbon', 'tree_lower']));

  function syncVisibility() {
    // Let the kit adapter decide first, then withhold what is not revealed yet.
    stage.adapter.setPhaseVisibility(adapterPhase);
    if (appliedDestination) stage.adapter.setDestinationVisual(appliedDestination);
    for (const group of groups.values()) {
      if (group.follower.value > 0.002) continue;
      for (const node of group.nodes) node.visible = false;
    }
    stage.invalidate(true);
  }

  function applyDestinationVisual(destination) {
    if (destination === 'motion-floor' && !stage.workspaceRoot) {
      // Visual only. Until the furnishings arrive the lounge stays in place.
      stage.loadWorkspace().then(() => {
        attachWorkspaceGroup();
        if (facts.destination === 'motion-floor') requestSwap('motion-floor');
      }).catch(() => { /* the lounge stays; room readiness is the host's business */ });
      return;
    }
    requestSwap(destination);
  }

  function requestSwap(destination) {
    if (appliedDestination === destination) return;
    if (appliedDestination === null || facts.reduced) {
      appliedDestination = destination;
      swap = null;
      syncVisibility();
    } else {
      swap = { to: destination };
    }
    wake();
  }

  function applyGroup(group, amount) {
    const visible = amount > 0.002;
    if (visible && !group.shown) {
      group.shown = true;
      syncVisibility();
    } else if (!visible && group.shown) {
      group.shown = false;
      endTransient(group);
      syncVisibility();
    }
    if (!visible) return;
    if (amount < 0.998) {
      beginTransient(group);
      updateTransient(group, smooth(amount));
    } else endTransient(group);
    if (group.lift) {
      const offset = (1 - smooth(amount)) * group.lift;
      for (const node of group.nodes) {
        node.userData.lmRestY ??= node.position.y;
        node.position.y = node.userData.lmRestY + offset;
      }
    }
  }

  function step(time) {
    if (disposed) return false;
    const dt = facts.reduced || seekTime !== null ? 1e3 : clamp((time - lastStep) / 1000, 0, 0.1);
    lastStep = time;
    const t = clockSeconds();
    const targets = targetsAt(t, { ...facts, paneCount });
    let moving = false;

    // ---- room swap: previous furnishing out, then the adapter switch, then in
    const outgoing = swap ? new Set(roomGroups(appliedDestination)) : null;
    if (swap) {
      let gone = true;
      for (const key of outgoing) {
        const group = groups.get(key);
        if (group && group.follower.value > 0.002) gone = false;
      }
      if (gone) {
        appliedDestination = swap.to;
        swap = null;
        syncVisibility();
      }
      moving = true;
    }

    // ---- phase mask
    const frontCentre = groups.get('front-centre');
    const wantsReadyMask = targets.phase === 'ready' || (frontCentre && frontCentre.follower.value > 0.002);
    const nextPhase = wantsReadyMask ? 'ready' : targets.phase;
    if (nextPhase !== adapterPhase) {
      adapterPhase = nextPhase;
      syncVisibility();
    }

    // ---- reveals
    for (const group of groups.values()) {
      const inRoom = !roomGroups(appliedDestination === 'motion-floor' ? 'lounge' : 'motion-floor').includes(group.key);
      let goal = targets.revealed.has(group.key) && adapterPhase !== 'structure' ? 1 : 0;
      if (outgoing?.has(group.key)) goal = 0;
      if (!inRoom) goal = 0; // furnishing of the room that is not shown
      const before = group.follower.value;
      const active = group.follower.step(goal, dt);
      if (active || before !== group.follower.value) {
        applyGroup(group, group.follower.value);
        moving = true;
        stage.invalidate(true);
      }
      if (active) moving = true;
    }

    // ---- pose, light line, light rig
    if (followers.explode.step(targets.explode, dt)) moving = true;
    stage.setExplodedAmount(followers.explode.value);

    if (followers.ceilingLine.step(targets.ceilingLine, dt)) moving = true;
    const lightGoal = targets.openingLight ? 1 : (facts.lightMode === 'soft' ? 1 : 0);
    if (followers.light.step(lightGoal, dt)) moving = true;
    stage.setLighting({ mix: followers.light.value, emissive: followers.ceilingLine.value });

    // ---- camera: turntable yaw, detail hold, entry push
    const yawGoal = clamp(userYaw + targets.passiveYawDeg * DEG, -look.yaw.limitDeg * DEG, look.yaw.limitDeg * DEG);
    if (dragging) followers.yaw.snap(yawGoal);
    else if (followers.yaw.step(yawGoal, dt)) moving = true;
    stage.setYaw(followers.yaw.value);

    if (followers.zoom.step(facts.entering ? 1 : targets.zoom, dt)) moving = true;
    if (followers.entry.step(facts.entering ? 1 : 0, dt)) moving = true;
    const entry = smooth(followers.entry.value);
    stage.setView({
      zoom: followers.zoom.value * (1 + entry * 1.25),
      // The anchor moves from the hold's corner to the room as entry begins.
      anchor: [
        DETAIL_HOLD_ANCHOR[0] + (ENTRY_ANCHOR[0] - DETAIL_HOLD_ANCHOR[0]) * entry,
        DETAIL_HOLD_ANCHOR[1] + (ENTRY_ANCHOR[1] - DETAIL_HOLD_ANCHOR[1]) * entry,
      ],
      targetOffset: [-0.3 * entry, -2.1 * entry, 0.6 * entry],
    });


    // ---- interface cues (decorative time only)
    const cues = interfaceCuesAt(t, facts);
    const signature = JSON.stringify(cues);
    if (signature !== lastCues) {
      lastCues = signature;
      onInterfaceCues?.(cues, t);
    }

    if (moving || dragging) return true;
    scheduleWake(t, targets);
    stopAnimation = null;
    return false;
  }

  /** Sleep until the next authored cue instead of running frames through a hold. */
  function scheduleWake(t, targets) {
    clearTimeout(wakeTimer);
    if (facts.ready || facts.reduced || targets.settled || seekTime !== null) return;
    const times = [
      CUES.openingLight, CUES.rotationHint, CUES.passiveTurn[0], CUES.glazing, CUES.ceilingLine,
      CUES.arrivalHighlight, CUES.arrivalHighlight + 6, CUES.lightIntroduced, CUES.furnishing,
      CUES.detailHold[0], CUES.detailHold[1], CUES.studiesHighlight, CUES.studiesHighlight + 6, CUES.settle, CUES.end,
      ...Array.from({ length: paneCount }, (_, i) => CUES.glazing + i * CUES.glazingStagger),
      ...FURNISHING_ORDER.map((_, i) => CUES.furnishing + i * CUES.furnishingStagger),
    ];
    const next = times.filter((time) => time > t + 1e-3).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    wakeTimer = setTimeout(wake, Math.max(16, (next - t) * 1000 + 4));
  }

  function wake() {
    if (disposed || !started || stopAnimation) return;
    lastStep = now();
    stopAnimation = stage.animate(step);
  }

  function onVisibility() {
    if (document.hidden) {
      hiddenSince ??= now();
      clearTimeout(wakeTimer);
    } else if (hiddenSince !== null) {
      pausedTotal += now() - hiddenSince;
      hiddenSince = null;
      wake();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    paneCount,
    get time() { return clockSeconds(); },
    get facts() { return { ...facts }; },
    get userYaw() { return userYaw; },

    start() {
      if (started) return;
      started = true;
      startTime = now();
      if (document.hidden) hiddenSince = startTime;
      appliedDestination = facts.destination === 'motion-floor' && !stage.workspaceRoot ? 'lounge' : facts.destination;
      if (facts.destination === 'motion-floor') applyDestinationVisual('motion-floor');
      // Compose the very first frame synchronously so the poster can hand over.
      const first = targetsAt(0, { ...facts, paneCount });
      followers.explode.snap(first.explode);
      followers.ceilingLine.snap(first.ceilingLine);
      followers.light.snap(facts.reduced || facts.ready ? (facts.lightMode === 'soft' ? 1 : 0) : 1);
      if (facts.ready || facts.reduced) for (const group of groups.values()) if (first.revealed.has(group.key)) group.follower.snap(1);
      adapterPhase = first.phase;
      syncVisibility();
      for (const group of groups.values()) { group.shown = group.follower.value > 0.002; }
      lastStep = now();
      step(lastStep);
      wake();
    },

    /** The room became usable, or stopped being usable (host fact, via the controller). */
    setReady(ready) {
      if (facts.ready === ready) return;
      facts.ready = ready;
      wake();
    },
    setDestination(destinationId, { chosen = true } = {}) {
      if (chosen) facts.roomChosen = true;
      if (facts.destination === destinationId && appliedDestination === destinationId) { wake(); return; }
      facts.destination = destinationId;
      applyDestinationVisual(destinationId);
      wake();
    },
    setLightMode(mode) {
      facts.lightMode = mode;
      wake();
    },
    setReducedMotion(reduced) {
      if (facts.reduced === reduced) return;
      facts.reduced = reduced;
      if (reduced) {
        userYaw = 0;
        dragging = false;
      } else {
        // No replay: carry on from the settled part of the plan.
        facts.takenOver = true;
      }
      wake();
    },
    /** Visitor input takes over from passive movement. */
    rotateBy(direction) {
      if (facts.reduced) return;
      facts.takenOver = true;
      const limit = look.yaw.limitDeg * DEG;
      userYaw = clamp(userYaw + direction * look.yaw.stepDeg * DEG, -limit, limit);
      wake();
    },
    dragStart() {
      if (facts.reduced) return;
      facts.takenOver = true;
      userYaw = followers.yaw.value; // absorb any passive turn so nothing jumps
      dragging = true;
      wake();
    },
    dragBy(deltaRadians) {
      if (!dragging) return;
      const limit = look.yaw.limitDeg * DEG;
      // Resist a little at the limits instead of stopping dead.
      const next = userYaw + deltaRadians;
      const over = Math.abs(next) - limit;
      userYaw = over > 0 ? Math.sign(next) * (limit + over * 0.25) : next;
      wake();
    },
    dragEnd() {
      if (!dragging) return;
      dragging = false;
      const limit = look.yaw.limitDeg * DEG;
      userYaw = clamp(userYaw, -limit, limit);
      wake();
    },
    /** The short anchored push towards the room after the host acknowledged entry. */
    setEntering(entering) {
      facts.entering = entering;
      wake();
    },
    /**
     * Advance one step at an explicit time on the injected clock. For offline
     * rendering (tools/record-transition.mjs) and tests; the live scene is
     * stepped by the stage's own frame loop.
     */
    tick(time) { return step(time); },
    /**
     * Jump to a decorative time and compose it without easing. For captures,
     * tests and reduced-motion stills; it does not touch readiness.
     */
    seek(seconds) {
      seekTime = seconds;
      step(now());
      step(now());
      seekTime = null;
      startTime = now() - seconds * 1000 - pausedTotal;
      stage.renderOnce();
    },
    dispose() {
      disposed = true;
      clearTimeout(wakeTimer);
      stopAnimation?.();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const group of groups.values()) endTransient(group);
    },
  };
}
