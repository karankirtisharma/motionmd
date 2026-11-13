/**
 * Presentation model: controller snapshot + local interface state -> everything
 * the view shows. Pure and DOM-free so that the state rules in
 * ux_specification.json can be tested in Node.
 *
 * Rules that matter most:
 *  - Entry comes only from snapshot.canEnter.
 *  - A percentage appears only for a measured byte total, labelled Scene download.
 *  - The phase rail is driven by host phases; the decorative timeline never
 *    marks a step.
 *  - Recovery actions appear only when the host reports them as available.
 */
import { COPY, DESTINATIONS, LIGHTS, SCREEN_COPY, headingLines } from '../config/copy.mjs';

export const MAPPED_PHASES = Object.freeze(['structure', 'light', 'details']);
const RAIL_STEPS = Object.freeze(['structure', 'light', 'details', 'welcome']);

const S = COPY.state;

const PHASE_STATUS = Object.freeze({
  boot: S.boot.status,
  structure: S.structure.status,
  light: S.light.status,
  details: S.details.status,
  'preparing-room': S.preparing_room.status,
  ready: S.preparing_room.status, // a ready phase without host readiness is still preparation
  failed: S.failed.status,
});

/** Which top-level screen the snapshot calls for. */
export function resolveMode(snapshot, ui = {}) {
  if (ui.entered) return 'entered';
  if (ui.lightLanding) return 'light-landing';
  if (snapshot.retryPending) return 'retrying';
  if (snapshot.status === 'error') return 'failed';
  if (snapshot.status === 'stalled') return ui.stallDismissed ? 'stalled-waiting' : 'stalled';
  if (snapshot.canEnter) return 'ready';
  if (snapshot.status === 'slow') return 'slow';
  return 'loading';
}

function headingAndBody(mode, snapshot, ui) {
  const stacked = ui.layout === 'stacked';
  const destination = DESTINATIONS[snapshot.preferences.destinationId];
  const recovery = { canRetry: snapshot.canRetry, lightVersion: snapshot.lightVersionAvailable };
  switch (mode) {
    case 'light-landing':
      return [S.light_version_landing.heading, S.light_version_landing.body];
    case 'retrying':
      return [S.retrying.heading, S.retrying.body];
    case 'failed': {
      const graphics = snapshot.error?.code === 'main-graphics-failed';
      return [S.failed.heading, graphics ? S.graphics_fallback.main_graphics_failed_body : COPY.failedBody(recovery)];
    }
    case 'stalled':
      return [S.suspected_stall.heading, COPY.stalledBody(recovery)];
    case 'ready':
      return stacked
        ? [COPY.variant.M03.heading, COPY.variant.M03.body]
        : [destination.readyHeading, COPY.variant.D08.body];
    case 'slow':
      return stacked ? [COPY.variant.M04.heading, COPY.slowBodyCompact] : [S.slow.heading, COPY.slowBody];
    default: {
      // loading and stalled-waiting follow the host phase
      if (ui.graphics === 'still' && !snapshot.preferences.reducedMotion) {
        return [S.graphics_fallback.heading, S.graphics_fallback.body];
      }
      switch (snapshot.phase) {
        // 2026-11 reference: the light phase keeps the arrival line; the light
        // control now lives in the header.
        case 'light': return [S.light.heading, S.structure.body];
        case 'details': return [S.details.heading, S.details.body];
        case 'preparing-room':
        case 'ready': return [S.preparing_room.heading, S.preparing_room.body];
        case 'structure': return [S.structure.heading, S.structure.body];
        default: return [S.boot.heading, S.boot.body];
      }
    }
  }
}

function statusLabel(mode, snapshot, ui) {
  const destinationId = snapshot.preferences.destinationId;
  if (ui.entry === 'pending') return COPY.enteringStatus(destinationId);
  switch (mode) {
    case 'light-landing': return S.light_version_landing.status;
    case 'retrying': return S.retrying.status;
    case 'failed': return S.failed.status;
    case 'stalled':
    case 'stalled-waiting': return S.suspected_stall.status;
    case 'ready': return S.ready.status;
    case 'slow': return snapshot.taskLabel ?? S.slow.status;
    default:
      if (snapshot.taskLabel) return snapshot.taskLabel;
      if (snapshot.phase === 'preparing-room' && snapshot.destinationRequestId > 0) return COPY.preparingDestination(destinationId);
      return PHASE_STATUS[snapshot.phase] ?? S.boot.status;
  }
}

function progress(mode, snapshot) {
  if (mode === 'ready' || mode === 'light-landing') return { kind: 'hidden', percent: null };
  if (mode === 'failed') return { kind: 'idle', percent: null };
  if (mode === 'retrying') return { kind: 'indeterminate', percent: null };
  const percent = snapshot.progress.percent;
  if (Number.isFinite(percent)) {
    // Never round a partial download up to 100.
    return { kind: 'determinate', percent: Math.min(100, Math.floor(percent)), exact: percent };
  }
  const noHostReportYet = snapshot.phase === 'boot' && snapshot.taskLabel === null;
  return { kind: noHostReportYet ? 'idle' : 'indeterminate', percent: null };
}

function supporting(mode, snapshot, ui, progressModel) {
  const stacked = ui.layout === 'stacked';
  if (snapshot.lightVersionRequested) return S.light_version_request.pending;
  switch (mode) {
    case 'light-landing': return S.light_version_landing.supporting;
    case 'ready': return SCREEN_COPY.readySupporting;
    case 'failed': return stacked ? COPY.variant.M07.status_supporting : SCREEN_COPY.choicesKept;
    case 'retrying': return stacked ? COPY.variant.M08.status_supporting : SCREEN_COPY.working;
    // With the actions on screen the compact rail points at them, as M07 does.
    case 'stalled': return snapshot.taskLabel ?? (stacked ? COPY.variant.M07.status_supporting : SCREEN_COPY.choicesKept);
    case 'stalled-waiting': return snapshot.taskLabel ?? SCREEN_COPY.choicesKept;
    default:
      if (progressModel.kind === 'determinate') return SCREEN_COPY.sceneDownload;
      return stacked ? SCREEN_COPY.choicesKept : SCREEN_COPY.working;
  }
}

function phaseRail(mode, snapshot, ui) {
  // Current step: the host's mapped phase. While the host reports an unmapped
  // task, a failure or a stall, the rail stays where the host last was. Before
  // any mapped report in this attempt every step is pending.
  const mapped = MAPPED_PHASES.indexOf(snapshot.phase);
  let current;
  if (mode === 'ready') current = 3;
  else if (mapped !== -1) current = mapped;
  else if (snapshot.phase === 'boot') current = -1;
  else current = MAPPED_PHASES.indexOf(ui.lastMappedPhase ?? '');
  return RAIL_STEPS.map((id, index) => {
    const label = COPY.phaseLabels[index];
    const state = current === -1 ? 'pending' : index < current ? 'complete' : index === current ? 'current' : 'pending';
    return { id, label, state, description: COPY.phaseState(label, state) };
  });
}

const entryHint = (ui) => (ui.entryHint === 'keyboard' ? S.ready.desktop_hint : ui.entryHint === 'touch' ? S.ready.mobile_hint : null);

function note(mode, snapshot, ui) {
  const stacked = ui.layout === 'stacked';
  if (ui.entry === 'failed') return { text: S.entering.entry_error, tone: 'error' };
  if (snapshot.lightVersionError) return { text: S.light_version_request.failed, tone: 'error' };
  if (snapshot.preferenceError) return { text: S.preference_error.message, tone: 'error' };
  switch (mode) {
    case 'failed':
      return { text: stacked ? `${SCREEN_COPY.choicesKept}.` : S.retrying.body, tone: 'quiet' };
    // The stall copy already says the choices are kept; it is not said twice.
    case 'stalled':
    case 'retrying':
    case 'light-landing':
      return null;
    default: break;
  }
  // The compact screens (M01 to M04) carry no hint line: the rail and the
  // selected pills say the same thing, and a line that comes and goes would
  // move the controls under a thumb.
  if (stacked) return null;
  if (ui.transientNote) return { text: ui.transientNote, tone: 'quiet' };
  // D05: the chosen room's description stays while the host prepares it.
  if (mode === 'loading' && snapshot.phase === 'preparing-room' && snapshot.destinationRequestId > 0) {
    return { text: DESTINATIONS[snapshot.preferences.destinationId].description, tone: 'quiet' };
  }
  // One input hint, and only the one the host environment has confirmed.
  if (mode === 'ready' && entryHint(ui)) return { text: entryHint(ui), tone: 'quiet' };
  if (mode === 'slow' && snapshot.lightVersionAvailable) return { text: SCREEN_COPY.slowLightVersionNote, tone: 'quiet' };
  if (mode === 'loading' && snapshot.phase === 'details') return { text: S.details.hint, tone: 'quiet' };
  return null;
}

/**
 * @param {object} snapshot  controller.getSnapshot()
 * @param {object} ui        local interface state (layout, graphics, entry, …)
 */
export function present(snapshot, ui = {}) {
  const mode = resolveMode(snapshot, ui);
  const [heading, body] = headingAndBody(mode, snapshot, ui);
  const destinationId = snapshot.preferences.destinationId;
  const progressModel = progress(mode, snapshot);
  const choosing = mode === 'loading' || mode === 'slow' || mode === 'ready' || mode === 'stalled-waiting';
  const recovering = mode === 'failed' || mode === 'stalled' || mode === 'retrying';
  const reducedMotion = snapshot.preferences.reducedMotion;
  const still = ui.graphics !== '3d';
  const entryBusy = ui.entry === 'pending';
  const rooms = Object.values(DESTINATIONS).filter((item) => (ui.destinations ?? Object.keys(DESTINATIONS)).includes(item.id));

  return {
    mode,
    heading,
    // Wrapping hint only: the lines drawn in the approved screens.
    headingLines: headingLines(ui.layout === 'stacked' ? 'stacked' : 'desktop', heading),
    body,
    note: note(mode, snapshot, ui),
    destination: {
      // With a single permitted room there is nothing to choose.
      visible: choosing && rooms.length > 1,
      value: destinationId,
      options: rooms,
    },
    light: {
      // In the header from first paint (2026-11 revision). A control the site
      // cannot honour is not shown at all.
      // On a phone the recovery screens (M07, M08, a stall) need the room for
      // their actions: the light control steps aside until loading resumes.
      visible: ui.lightAvailable !== false && mode !== 'light-landing' && !(recovering && ui.layout === 'stacked'),
      value: snapshot.preferences.lightMode,
      options: Object.values(LIGHTS),
    },
    version: {
      // Immersive is the experience on screen; Lite opens the host's lighter
      // route. Offered from first paint whenever the host has one.
      visible: choosing && snapshot.lightVersionAvailable,
      busy: snapshot.lightVersionRequested,
    },
    links: {
      studies: mode !== 'light-landing' && mode !== 'retrying',
      lightVersion: choosing && snapshot.lightVersionAvailable,
      lightVersionBusy: snapshot.lightVersionRequested,
    },
    recovery: {
      visible: recovering,
      retry: (mode === 'retrying' || snapshot.canRetry)
        ? { busy: mode === 'retrying', label: mode === 'retrying' ? COPY.variant.M08.busy_action : S.failed.retry }
        : null,
      lightVersion: snapshot.lightVersionAvailable ? { busy: snapshot.lightVersionRequested, label: SCREEN_COPY.useLite } : null,
      keepWaiting: mode === 'stalled' ? { label: S.suspected_stall.continue_waiting } : null,
    },
    landing: mode === 'light-landing'
      ? {
        action: S.light_version_landing.action,
        secondary: S.light_version_landing.secondary,
        kept: SCREEN_COPY.lightLandingKept,
        panelTitle: SCREEN_COPY.lightLandingPanelTitle,
        panelBody: SCREEN_COPY.lightLandingPanelBody,
      }
      : null,
    status: {
      label: statusLabel(mode, snapshot, ui),
      supporting: supporting(mode, snapshot, ui, progressModel),
      progress: progressModel,
      phases: phaseRail(mode, snapshot, ui),
      phasesVisible: mode !== 'ready' && mode !== 'light-landing',
      ready: mode === 'ready' ? { title: SCREEN_COPY.readyTitle, supporting: SCREEN_COPY.readySupporting } : null,
      recoveryReopen: mode === 'stalled-waiting',
    },
    enter: mode === 'ready'
      ? {
        label: DESTINATIONS[destinationId].enter,
        busy: entryBusy,
        hint: entryHint(ui),
      }
      : null,
    // D10, D11, M07: no turn buttons while the page is about recovery.
    rotation: { visible: !still && !reducedMotion && mode !== 'light-landing' && mode !== 'failed' && mode !== 'retrying' },
    toggles: {
      sound: ui.soundAvailable === false ? null : { pressed: snapshot.preferences.soundEnabled, label: snapshot.preferences.soundEnabled ? COPY.soundOn : COPY.soundOff },
    },
    busy: mode !== 'ready' && mode !== 'failed' && mode !== 'light-landing',
  };
}
