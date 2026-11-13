/**
 * Living Maquette loading intro: public entry point.
 *
 *   import { mountLivingMaquette } from './src/index.mjs';
 *   const intro = mountLivingMaquette(container, { host, assetBase: './assets/' });
 *
 * `host` implements the kit's adapter callbacks (06_handoff/input_contract.json,
 * host_contract.adapter_callbacks). The intro shows what the host reports and
 * sends the visitor's choices back; entry is offered only when the controller
 * derives snapshot.canEnter from the host's scoped readiness.
 *
 * The semantic interface is usable before, and without, the 3D scene. The
 * renderer module (three.js) is imported after first paint.
 */
import { COPY, DESTINATIONS, LIGHTS } from './config/copy.mjs';
import { connectLivingMaquette } from './host/connect.mjs';
import { getLoadScope } from './kit/loader-controller.mjs';
import { interfaceCuesAt } from './scene/director.mjs';
import { LOOK } from './scene/look.mjs';
import { MAPPED_PHASES, present } from './ui/present.mjs';
import { createStudies } from './ui/studies.mjs';
import { createView } from './ui/view.mjs';

const S = COPY.state;
const NOTE_MS = 7_000;
const CONFIRM_MS = 4_600;
/** Stacked layout: how far the canvas reaches beyond the model band (CSS fades it out there). */
const CANVAS_MARGIN = Object.freeze({ top: 28, bottom: 44 });

function webgl2Available() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Which still stands in for the model (first paint and graphics fallback). */
export function stillName({ canEnter, destinationId, lightMode, composed }) {
  if (!composed) return 'structure-warm';
  return `${canEnter ? 'ready' : 'loading'}-${destinationId}-${lightMode}`;
}

/** World-space frame shared by the renderer and the pre-rendered stills. */
export const STILL = Object.freeze({ frameAspect: LOOK.camera.frame.width / LOOK.camera.frame.height, bleed: 1.5 });

export function mountLivingMaquette(container, options = {}) {
  const {
    host,
    assetBase = './assets/',
    destinations = ['lounge', 'motion-floor'],
    expectedWaitMs = 80_000,
    initialPreferences = {},
    sound = Boolean(host?.capabilities?.sound),
    // Offer Warm / Soft only if the site applies both at arrival.
    lightModes = host?.capabilities?.lightModes ?? ['warm', 'soft'],
    entryHint = null,
    headingLevel = 1,
    brandHref = null,
    // Header identity: text, or an element such as the logo. Default: the copy deck's name.
    brand = null,
    // The three scene files, under assetBase by default. Each may be another
    // URL (fingerprinted names, a CDN); each model may also be a function that
    // resolves to the file's bytes, for a site that loads through its own pipeline.
    sceneAssets = {},
    graphics = 'auto',
    noteMs = NOTE_MS,
    confirmMs = CONFIRM_MS,
    loadScene = () => Promise.all([import('./scene/stage.mjs'), import('./scene/director.mjs')]),
    onEntered,
    onExit,
    onLightVersion,
    onEvent,
    onTrace,
  } = options;
  if (!container) throw new TypeError('mountLivingMaquette needs a container element');
  if (!host) throw new TypeError('mountLivingMaquette needs a host adapter');

  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const emitEvent = (name, detail) => { try { onEvent?.(name, { t: Math.round(performance.now()), ...detail }); } catch { /* measurement must not break the intro */ } };

  const view = createView(container, { headingLevel, brandHref, brand });
  const { refs, root } = view;

  const ui = {
    layout: 'desktop',
    graphics: 'pending',
    destinations,
    soundAvailable: sound,
    lightAvailable: lightModes.includes('warm') && lightModes.includes('soft'),
    entryHint,
    lastMappedPhase: null,
    lightIntroduced: false,
    rotationShown: false,
    stallDismissed: false,
    entry: 'idle',
    lightLanding: false,
    entered: false,
    transientNote: null,
  };

  const bridge = connectLivingMaquette(host, {
    reducedMotion: motionQuery.matches,
    ...initialPreferences,
  }, { expectedWaitMs, destinations, onTrace });
  const { controller } = bridge;

  let snapshot = controller.getSnapshot();
  let model = null;
  let stage = null;
  let director = null;
  let disposed = false;
  let attemptSeen = snapshot.attemptId;
  let attemptStartedAt = performance.now();
  let motionChosenByVisitor = false;
  let lightRequestPending = false;
  let noteTimer = 0;
  let confirmTimer = 0;
  let renderQueued = false;
  let worldReadyReported = false;
  const mountedAt = performance.now();

  root.dataset.motion = snapshot.preferences.reducedMotion ? 'reduced' : 'full';

  // ------------------------------------------------------------------ studies
  const studies = createStudies({
    view,
    assetBase: base,
    onChange(state) {
      if (state.open) controller.openSelectedWork();
      else controller.closeSelectedWork();
      syncLayout();
    },
  });

  // ------------------------------------------------------------------- render
  function render() {
    renderQueued = false;
    if (disposed) return;
    const next = present(snapshot, ui);
    if (!ui.rotationShown) next.rotation.visible = false;
    const previous = model;
    model = next;
    view.render(next);
    announceChanges(previous, next);
    syncStill();
  }
  function queueRender() {
    if (renderQueued || disposed) return;
    renderQueued = true;
    queueMicrotask(render);
  }

  function announceChanges(previous, next) {
    if (!previous) return;
    if (previous.mode !== next.mode) {
      switch (next.mode) {
        case 'ready':
          view.announce(studies.state.open ? S.selected_work.ready_notice : `${next.heading} ${S.ready.status}.`);
          return;
        case 'failed':
          view.announce(`${next.heading} ${next.body}`, { assertive: true });
          return;
        case 'stalled':
        case 'slow':
        case 'light-landing':
          view.announce(`${next.heading} ${next.body}`);
          return;
        case 'retrying':
          view.announce(S.retrying.status);
          return;
        default: break;
      }
    }
    if (next.note?.tone === 'error' && previous.note?.text !== next.note.text) {
      view.announce(next.note.text, { assertive: true });
      return;
    }
    // Phase or task changes, never percentage ticks.
    if (previous.status.label !== next.status.label && (next.mode === 'loading' || next.mode === 'slow')) {
      view.announce(next.status.label);
    }
  }

  // ------------------------------------------------------------ host snapshots
  const stopSnapshots = controller.subscribe((nextSnapshot) => {
    const previous = snapshot;
    snapshot = nextSnapshot;
    if (snapshot.attemptId !== attemptSeen) {
      attemptSeen = snapshot.attemptId;
      attemptStartedAt = performance.now();
      ui.lastMappedPhase = null;
      ui.stallDismissed = false;
    }
    if (MAPPED_PHASES.includes(snapshot.phase)) ui.lastMappedPhase = snapshot.phase;
    if (snapshot.status !== 'stalled') ui.stallDismissed = false;
    if (snapshot.canEnter || snapshot.status === 'slow' || MAPPED_PHASES.indexOf(snapshot.phase) >= 1) ui.lightIntroduced = true;
    if (snapshot.preferences.reducedMotion) { ui.lightIntroduced = true; }
    const scopeChanged = previous.attemptId !== snapshot.attemptId
      || previous.destinationRequestId !== snapshot.destinationRequestId;
    if (scopeChanged && ui.entry === 'failed') ui.entry = 'idle';

    if (previous.phase !== snapshot.phase) emitEvent('real_phase_changed', { phase: snapshot.phase });
    if (snapshot.canEnter && !worldReadyReported) {
      worldReadyReported = true;
      emitEvent('world_ready', { sinceMountMs: Math.round(performance.now() - mountedAt), destinationId: snapshot.preferences.destinationId });
    }
    if (!previous.error && snapshot.status === 'error') emitEvent('load_failed', { code: snapshot.error?.code ?? null });

    // A light-version request has settled: acknowledged, or failed.
    if (lightRequestPending && !snapshot.lightVersionRequested) {
      lightRequestPending = false;
      if (!snapshot.lightVersionError) {
        ui.lightLanding = true;
        if (studies.state.open) studies.close({ restoreFocus: false });
        requestAnimationFrame(() => refs.heading.focus({ preventScroll: true }));
      }
    }

    root.dataset.motion = snapshot.preferences.reducedMotion ? 'reduced' : 'full';
    director?.setReady(snapshot.canEnter);
    queueRender();
  });

  // Elapsed time only acknowledges a long active wait; it never grants entry
  // or reports a stall.
  const elapsedTimer = setInterval(() => {
    if (disposed || ui.entered) return;
    const elapsed = Math.floor(performance.now() - attemptStartedAt);
    try { controller.setElapsedMs(Math.max(elapsed, controller.getSnapshot().elapsedMs)); } catch { /* monotonic guard */ }
  }, 1_000);

  // ------------------------------------------------------------ transient UI
  function showNote(text) {
    ui.transientNote = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { ui.transientNote = null; queueRender(); }, noteMs);
    queueRender();
  }
  function showSoftConfirmation(visible) {
    clearTimeout(confirmTimer);
    refs.confirm.hidden = !visible;
    if (visible) confirmTimer = setTimeout(() => { refs.confirm.hidden = true; }, confirmMs);
  }

  // ------------------------------------------------------------------ actions
  view.on('destination', (destinationId) => {
    if (!DESTINATIONS[destinationId] || destinationId === snapshot.preferences.destinationId) return;
    controller.setDestination(destinationId);
    director?.setDestination(destinationId);
    showNote(DESTINATIONS[destinationId].description);
    view.announce(COPY.destinationAnnouncement(destinationId));
    emitEvent('destination_selected', { destinationId });
    emitEvent('optional_interaction', { kind: 'destination' });
  });
  view.on('light', (lightMode) => {
    if (!LIGHTS[lightMode] || lightMode === snapshot.preferences.lightMode) return;
    controller.setLightMode(lightMode);
    director?.setLightMode(lightMode);
    showSoftConfirmation(lightMode === 'soft');
    view.announce(COPY.lightAnnouncement(lightMode));
    emitEvent('light_selected', { lightMode });
    emitEvent('optional_interaction', { kind: 'light' });
  });
  view.on('sound', () => {
    controller.setSoundEnabled(!snapshot.preferences.soundEnabled);
    view.announce(controller.getSnapshot().preferences.soundEnabled ? COPY.soundOn : COPY.soundOff);
  });
  // Reduced motion follows the visitor's system setting (there is no control
  // on the page since the 2026-11 revision); the site may also set it through
  // intro.setReducedMotion(), e.g. from its own accessibility settings.
  function setReducedMotion(reduced, { byVisitor }) {
    if (byVisitor) motionChosenByVisitor = true;
    if (reduced === snapshot.preferences.reducedMotion) return;
    controller.setReducedMotion(reduced);
    director?.setReducedMotion(reduced);
    if (reduced) view.announce(S.reduced_motion.announcement);
  }
  const onSystemMotion = (event) => { if (!motionChosenByVisitor) setReducedMotion(event.matches, { byVisitor: false }); };
  motionQuery.addEventListener?.('change', onSystemMotion);

  view.on('rotate', (direction) => {
    director?.rotateBy(direction);
    if (snapshot.passive) controller.setPassive(false);
    emitEvent('optional_interaction', { kind: 'rotate' });
  });
  view.on('studies', () => {
    studies.open(refs.studies);
    emitEvent('work_opened', {});
    emitEvent('optional_interaction', { kind: 'studies' });
  });
  view.on('retry', () => {
    const request = controller.requestRetry();
    if (request) emitEvent('retry_requested', { attemptId: request.attemptId });
  });
  view.on('keep-waiting', () => {
    ui.stallDismissed = true;
    queueRender();
    requestAnimationFrame(() => refs['recovery-reopen'].focus({ preventScroll: true }));
  });
  view.on('recovery-reopen', () => {
    ui.stallDismissed = false;
    queueRender();
    requestAnimationFrame(() => (refs.retry.hidden ? refs.heading : refs.retry).focus({ preventScroll: true }));
  });
  view.on('light-version', () => {
    const request = controller.requestLightVersion();
    if (!request) return;
    lightRequestPending = true;
    emitEvent('fallback_requested', { lightVersionRequestId: request.lightVersionRequestId });
  });
  view.on('landing-back', () => {
    ui.lightLanding = false;
    queueRender();
    requestAnimationFrame(() => refs.heading.focus({ preventScroll: true }));
  });
  view.on('landing-enter', () => {
    try { onLightVersion?.({ preferences: { ...snapshot.preferences }, scope: getLoadScope(snapshot) }); } catch (error) { host.onCallbackError?.(error, 'light-version-navigation'); }
  });

  async function enter() {
    if (ui.entry === 'pending' || ui.entered) return; // one request in flight
    ui.entry = 'pending';
    render();
    const destinationId = snapshot.preferences.destinationId;
    emitEvent('entry_requested', { destinationId });
    let acknowledgement = false;
    let failed = false;
    try {
      acknowledgement = await bridge.requestEntry();
    } catch (error) {
      failed = true;
      host.onCallbackError?.(error, 'entry');
    }
    if (disposed) return;
    if (acknowledgement) {
      ui.entry = 'idle';
      handOff(acknowledgement, destinationId);
      return;
    }
    // A superseded or aborted request is not an error the visitor caused or can fix.
    ui.entry = failed || bridge.lastEntry === 'declined' ? 'failed' : 'idle';
    render();
  }
  view.on('enter', enter);

  function handOff(acknowledgement, destinationId) {
    ui.entered = true;
    const preferences = { ...snapshot.preferences };
    const reduced = preferences.reducedMotion;
    emitEvent('entry_completed', { destinationId, sinceMountMs: Math.round(performance.now() - mountedAt) });
    view.announce(COPY.welcomeHeading(destinationId));
    if (studies.state.open) studies.close({ restoreFocus: false });
    root.inert = true;
    root.dataset.leaving = reduced ? 'crossfade' : 'push';
    director?.setEntering(true);
    try { onEntered?.({ acknowledgement, destinationId, preferences, scope: getLoadScope(snapshot) }); } catch (error) { host.onCallbackError?.(error, 'entered'); }
    // Short anchored transition, or a brief crossfade when motion is reduced.
    const duration = reduced ? 240 : 900;
    root.style.transition = `opacity ${reduced ? 240 : 520}ms ease ${reduced ? 0 : 380}ms`;
    root.style.opacity = '0';
    setTimeout(() => {
      dispose();
      try { onExit?.({ destinationId, preferences }); } catch (error) { host.onCallbackError?.(error, 'exit'); }
    }, duration);
  }

  // -------------------------------------------------------------- keyboard
  function onKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (studies.state.open) {
      if (studies.state.view === 'detail') studies.backToStudies();
      else studies.close();
      event.preventDefault();
    }
  }
  root.addEventListener('keydown', onKeydown);

  // ------------------------------------------------------- layout and stills
  let stageRect = { x: 0, y: 0, width: 1, height: 1 };
  function syncLayout() {
    if (disposed) return;
    const width = root.clientWidth;
    const viewportHeight = window.innerHeight || root.clientHeight;
    // Larger default text needs room in proportion: the two-column layout is
    // judged in text-scaled pixels, as browser zoom would judge it.
    const textScale = Math.max(1, refs['scale-probe'].getBoundingClientRect().width / 100 || 1);
    const layout = width / textScale >= 960 && width / Math.max(1, viewportHeight) >= 1.15 ? 'desktop' : 'stacked';
    if (ui.layout !== layout) {
      ui.layout = layout;
      view.setLayout(layout);
      studies.refreshLayout();
      render();
    }
    view.fitHeading();
    root.style.setProperty('--lm-rail-height', `${Math.round(refs.status.offsetHeight)}px`);
    root.style.setProperty('--lm-header-bottom', `${Math.round(refs.header.offsetTop + refs.header.offsetHeight)}px`);
    const rootBox = root.getBoundingClientRect();
    const box = refs.stage.getBoundingClientRect();
    stageRect = { x: box.left - rootBox.left, y: box.top - rootBox.top, width: Math.max(1, box.width), height: Math.max(1, box.height) };
    // Still: the same frame the renderer fits, plus the bleed the stills carry.
    const scale = Math.min(stageRect.width / STILL.frameAspect, stageRect.height);
    const frameWidth = scale * STILL.frameAspect * STILL.bleed;
    const frameHeight = scale * STILL.bleed;
    Object.assign(refs.poster.style, {
      left: `${stageRect.x + stageRect.width / 2 - frameWidth / 2}px`,
      top: `${stageRect.y + stageRect.height / 2 - frameHeight / 2}px`,
      width: `${frameWidth}px`,
      height: `${frameHeight}px`,
    });
    // On desktop the canvas is the whole page: the studio floor carries the
    // long shadows. In the stacked layout it is the model band and a soft
    // margin, which draws nothing behind the controls and far fewer pixels.
    const canvasBox = { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight };
    if (layout === 'stacked') {
      canvasBox.y = Math.max(0, stageRect.y - CANVAS_MARGIN.top);
      canvasBox.height = Math.min(root.clientHeight, stageRect.y + stageRect.height + CANVAS_MARGIN.bottom) - canvasBox.y;
    }
    Object.assign(refs.canvas.style, { top: `${canvasBox.y}px`, width: `${canvasBox.width}px`, height: `${Math.max(1, canvasBox.height)}px` });
    stage?.resize(
      { width: canvasBox.width, height: Math.max(1, canvasBox.height) },
      { x: stageRect.x - canvasBox.x, y: stageRect.y - canvasBox.y, width: stageRect.width, height: stageRect.height },
    );
  }
  const resizeObserver = new ResizeObserver(syncLayout);
  resizeObserver.observe(root);
  resizeObserver.observe(refs.status);
  resizeObserver.observe(refs.header);
  resizeObserver.observe(refs.main);
  // The model's box can change while the page keeps its size (a third
  // recovery action, a longer headline): the scene is refitted then too.
  resizeObserver.observe(refs.stage);
  window.addEventListener('resize', syncLayout);

  let stillShown = null;
  function syncStill() {
    const live = ui.graphics === '3d';
    refs.canvas.dataset.visible = String(live);
    if (live) {
      refs.poster.dataset.visible = 'false';
      return;
    }
    const composed = ui.graphics === 'still' || snapshot.preferences.reducedMotion || snapshot.canEnter
      || snapshot.preferences.destinationId !== 'lounge' || snapshot.preferences.lightMode !== 'warm';
    const name = stillName({
      canEnter: snapshot.canEnter,
      destinationId: snapshot.preferences.destinationId,
      lightMode: snapshot.preferences.lightMode,
      composed,
    });
    if (name === stillShown) return;
    stillShown = name;
    refs.poster.onerror = () => {
      refs.poster.dataset.visible = 'false';
      if (!disposed && ui.graphics === 'still') emitEvent('intro_still_ready', { unavailable: true });
    };
    refs.poster.onload = () => {
      if (disposed) return;
      if (ui.graphics !== '3d') refs.poster.dataset.visible = 'true';
      if (ui.graphics === 'still') emitEvent('intro_still_ready', {});
    };
    refs.poster.src = `${base}images/stills/${name}.webp`;
  }

  // ---------------------------------------------------- interface cue clock
  function applyCues(cues) {
    let changed = false;
    if (cues.lightIntroduced && !ui.lightIntroduced) { ui.lightIntroduced = true; changed = true; }
    if (cues.rotationHint && !ui.rotationShown) { ui.rotationShown = true; changed = true; }
    root.dataset.highlight = cues.arrivalHighlight ? 'destination' : cues.studiesHighlight ? 'studies' : 'none';
    if (changed) queueRender();
  }
  // Until the renderer runs its own clock (and for the still fallback), the
  // optional controls are introduced on the same plan from first paint.
  const cueTimer = setInterval(() => {
    if (director || disposed) return;
    applyCues(interfaceCuesAt((performance.now() - mountedAt) / 1000, { reduced: snapshot.preferences.reducedMotion }));
  }, 500);

  // ------------------------------------------------------------------- scene
  function fallBackToStill() {
    if (disposed) return;
    director?.dispose();
    director = null;
    try { stage?.dispose(); } catch { /* already lost */ }
    stage = null;
    ui.graphics = 'still';
    root.dataset.graphics = 'still';
    stillShown = null;
    queueRender();
  }

  async function startScene() {
    if (disposed) return;
    if (graphics === 'still' || !webgl2Available()) {
      fallBackToStill();
      return;
    }
    try {
      const [{ createStage }, { createDirector }] = await loadScene();
      const manifest = await fetch(sceneAssets.manifest ?? `${base}models/scene_manifest.json`).then((response) => {
        if (!response.ok) throw new Error('Scene manifest unavailable');
        return response.json();
      });
      if (disposed) return;
      const created = await createStage({
        canvas: refs.canvas,
        manifest,
        assets: {
          mainModel: sceneAssets.mainModel ?? [`${base}models/Living_Maquette_meshopt.glb`, `${base}models/Living_Maquette_quantized.glb`],
          workspaceModel: sceneAssets.workspaceModel ?? [`${base}models/MotionFloor_Furnishings_meshopt.glb`, `${base}models/MotionFloor_Furnishings_quantized.glb`],
        },
        onContextLost: fallBackToStill,
      });
      if (disposed) { created.dispose(); return; }
      stage = created;
      syncLayout();
      director = createDirector({
        stage,
        manifest,
        initial: {
          ready: snapshot.canEnter,
          reducedMotion: snapshot.preferences.reducedMotion,
          destinationId: snapshot.preferences.destinationId,
          lightMode: snapshot.preferences.lightMode,
        },
        onInterfaceCues: applyCues,
      });
      director.start();
      // Commit a populated canvas before replacing the poster or releasing the splash.
      stage.renderOnce();
      ui.graphics = '3d';
      root.dataset.graphics = '3d';
      render();
      emitEvent('intro_scene_ready', { sinceMountMs: Math.round(performance.now() - mountedAt) });
    } catch (error) {
      host.onCallbackError?.(error, 'intro-scene');
      fallBackToStill();
    }
  }

  // ------------------------------------------------------------ model dragging
  let drag = null;
  const insideStage = (event) => {
    const rootBox = root.getBoundingClientRect();
    const x = event.clientX - rootBox.left;
    const y = event.clientY - rootBox.top;
    return x >= stageRect.x && x <= stageRect.x + stageRect.width && y >= stageRect.y && y <= stageRect.y + stageRect.height;
  };
  refs.canvas.addEventListener('pointerdown', (event) => {
    if (!director || event.button !== 0 || !insideStage(event) || snapshot.preferences.reducedMotion) return;
    drag = { id: event.pointerId, x: event.clientX, moved: false };
    refs.canvas.setPointerCapture?.(event.pointerId);
    director.dragStart();
    root.dataset.dragging = 'true';
  });
  refs.canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId || !director) return;
    const dx = event.clientX - drag.x;
    drag.x = event.clientX;
    if (dx !== 0 && !drag.moved) {
      drag.moved = true;
      if (snapshot.passive) controller.setPassive(false);
      emitEvent('optional_interaction', { kind: 'drag' });
    }
    // Dragging right brings the right side of the model towards the visitor.
    director.dragBy((dx / Math.max(240, stageRect.width)) * 0.9);
  });
  const endDrag = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    director?.dragEnd();
    root.dataset.dragging = 'false';
  };
  refs.canvas.addEventListener('pointerup', endDrag);
  refs.canvas.addEventListener('pointercancel', endDrag);

  // -------------------------------------------------------------------- start
  syncLayout();
  render();
  emitEvent('intro_first_paint', { sinceMountMs: Math.round(performance.now() - mountedAt) });
  emitEvent('intro_first_control_usable', { sinceMountMs: Math.round(performance.now() - mountedAt) });
  // The renderer waits for an idle moment so it never delays first paint or
  // the host's own start-up work.
  const idle = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 120));
  idle(() => startScene(), { timeout: 1_500 });

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(elapsedTimer);
    clearInterval(cueTimer);
    clearTimeout(noteTimer);
    clearTimeout(confirmTimer);
    stopSnapshots();
    resizeObserver.disconnect();
    window.removeEventListener('resize', syncLayout);
    motionQuery.removeEventListener?.('change', onSystemMotion);
    root.removeEventListener('keydown', onKeydown);
    director?.dispose();
    try { stage?.dispose(); } catch { /* context already gone */ }
    bridge.dispose();
    view.destroy();
  }

  return {
    controller,
    bridge,
    view,
    studies,
    get snapshot() { return snapshot; },
    get model() { return model; },
    get stage() { return stage; },
    get director() { return director; },
    get graphics() { return ui.graphics; },
    /** The site's own reduced-motion setting; from then on the system setting is no longer followed. */
    setReducedMotion(reduced) { setReducedMotion(Boolean(reduced), { byVisitor: true }); },
    dispose,
  };
}
