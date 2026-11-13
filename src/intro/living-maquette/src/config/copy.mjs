/**
 * Visible copy for the Living Maquette intro.
 *
 * Authority, in order:
 *  1. COPY_DECK: the kit's copy_deck.json, verbatim (shared defaults and the
 *     listed rendered_screen_variants for compact views).
 *  2. SCREEN_COPY: strings that appear in the approved editable screens
 *     (01_ui_package/screens/svg) but have no key in the deck. Each entry names
 *     the screen it was read from.
 * Nothing else is invented here. Where a deck sentence names an action that the
 * host does not offer, the sentence is split at its full stop and only the
 * true part is shown (see recoveryBody).
 */
import { COPY_DECK as KIT_COPY_DECK } from './copy-deck.mjs';
import { HEADING_LINES } from './heading-lines.mjs';

/**
 * 2026-11 revision: the lighter route is called the "Lite Version" on screen
 * (the version choice reads "Immersive Version / Lite Version"), so every deck
 * string that says "light version" says "Lite Version" instead. Nothing else
 * in the deck changes.
 */
export const renameLite = (value) => {
  if (typeof value === 'string') return value.replace(/\b[Ll]ight version\b/g, 'Lite Version');
  if (Array.isArray(value)) return Object.freeze(value.map(renameLite));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameLite(item)])));
  return value;
};
export { KIT_COPY_DECK };
/** The deck as shown: the kit's deck with the Lite Version rename. */
export const COPY_DECK = renameLite(KIT_COPY_DECK);

const { global: G, states: S, phase_rail: RAIL, progress_patterns: PROGRESS, rendered_screen_variants: VARIANT } = COPY_DECK;

export const SCREEN_COPY = Object.freeze({
  working: 'Working in the background', // D01, D05, D06, D07, D09, D12, D13, M08
  choicesKept: 'Your choices are kept', // D10 rail, M02, M04, M05
  sceneDownload: 'Scene download', // D02, D03, D04, M01, C02
  readyTitle: 'Your room is ready', // D08 rail
  readySupporting: 'Your first stop and light are set.', // D08 rail
  rotateCaption: 'Drag or use arrows to turn', // D02 to D10 rotation pod
  studiesFooter: 'Keep exploring. Loading continues in the background.', // D07
  slowLightVersionNote: 'Switch to the Lite Version whenever you prefer.', // D09, renamed in the 2026-11 revision
  lightLandingKept: 'Your destination is kept.', // D11
  lightLandingPanelTitle: 'The studio, in a lighter form.', // D11
  lightLandingPanelBody: 'Work and studio information remain accessible. Your choices stay with you.', // D11
  // 2026-11 revision (desktop reference): the version choice replaces the
  // light-version link, and the light control moves into the header.
  versionLabel: 'Choose your version',
  versionImmersive: 'Immersive Version',
  versionLite: 'Lite Version',
  useLite: 'Use Lite Version',
  arrivalSupporting: 'Your {light} light and first stop are set.', // T01: "Your warm light and first stop are set."
  arrivalAction: 'Explore the room', // T01
});

export const DESTINATIONS = Object.freeze({
  lounge: Object.freeze({
    id: 'lounge',
    label: G.destination_lounge, // "The lounge"
    inline: 'the lounge', // as written in "Enter the lounge", "Welcome to the lounge."
    description: S.destination.lounge_description,
    readyHeading: S.ready.heading_lounge,
    enter: S.ready.enter_lounge,
  }),
  'motion-floor': Object.freeze({
    id: 'motion-floor',
    label: G.destination_motion_floor, // "Motion floor"
    inline: 'the Motion floor', // as written in "Enter the Motion floor"
    description: S.destination.motion_floor_description,
    readyHeading: S.ready.heading_motion_floor,
    enter: S.ready.enter_motion_floor,
  }),
});

export const LIGHTS = Object.freeze({
  warm: Object.freeze({ id: 'warm', label: G.light_warm, description: S.light_choice.warm_description }),
  soft: Object.freeze({ id: 'soft', label: G.light_soft, description: S.light_choice.soft_description }),
});

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
const firstSentence = (text) => text.slice(0, text.indexOf('.') + 1);
const lastSentence = (text) => text.slice(text.lastIndexOf('. ', text.length - 2) + 2);

export const COPY = Object.freeze({
  brand: G.brand,
  soundOff: G.sound_off,
  soundOn: G.sound_on,
  reduceMotion: G.reduce_motion,
  motionReduced: G.motion_reduced,
  studiesLink: G.work_link,
  lightVersion: G.light_version,
  backToModel: G.back_to_model,
  close: G.close,
  rotateLeft: G.rotate_left,
  rotateRight: G.rotate_right,
  destinationLabel: G.destination_label,
  lightLabel: G.light_label,

  state: S,
  phaseLabels: RAIL.labels, // Structure, Light, Details, Welcome
  variant: VARIANT,

  /** "Preparing Motion floor" (D05, M02) / "Preparing the lounge". */
  preparingDestination(destinationId) {
    const destination = DESTINATIONS[destinationId];
    // The deck pattern is "Preparing {destination}"; the approved screen writes
    // the room name as it reads in a sentence.
    const name = destinationId === 'lounge' ? destination.inline : destination.label;
    return fill(S.destination.loading_after_change, { destination: name });
  },
  destinationAnnouncement: (destinationId) => fill(S.destination.selection_announcement, { destination: DESTINATIONS[destinationId].label }),
  lightAnnouncement: (lightId) => fill(S.light_choice.selection_announcement, { light: LIGHTS[lightId].label }),
  enteringStatus: (destinationId) => fill(S.entering.status, { destination: DESTINATIONS[destinationId].inline }),
  welcomeHeading: (destinationId) => fill(S.entering.heading, { destination: DESTINATIONS[destinationId].inline }),
  arrivalSupporting: (lightId) => fill(SCREEN_COPY.arrivalSupporting, { light: LIGHTS[lightId].label.toLowerCase() }),
  studyActionName: (title) => fill(S.selected_work.action_accessible_name, { study_title: title }),
  phaseState(label, state) {
    const pattern = state === 'complete' ? RAIL.completed : state === 'current' ? RAIL.current : RAIL.pending;
    return fill(pattern, { phase: label });
  },
  percentText: (percent) => fill(PROGRESS.accessible_known_bytes, { percent: String(percent) }),

  /** D09: the slow body and its supporting sentence, as one paragraph. */
  slowBody: `${S.slow.body} ${S.slow.supporting}`,
  /** M04 draws the first sentence of the slow body, then the supporting sentence. */
  slowBodyCompact: `${firstSentence(S.slow.body)} ${S.slow.supporting}`,

  /**
   * Failure body. The deck sentence pair is "We could not finish preparing the
   * studio. Try again, or use the light version." The second sentence is shown
   * only when the host offers both actions.
   */
  failedBody({ canRetry, lightVersion }) {
    const full = S.failed.body;
    return canRetry && lightVersion ? full : firstSentence(full);
  },
  /**
   * Stall body: "You can keep waiting or use the light version. Your choices
   * are kept." Without a light version only the kept-choices sentence is true.
   */
  stalledBody({ lightVersion }) {
    const full = S.suspected_stall.body;
    return lightVersion ? full : lastSentence(full);
  },
});

/**
 * Line breaks for a headline as drawn in the approved screens, or null when
 * that headline was never drawn (the browser then balances the lines). The
 * Motion floor ready headline borrows the lounge's drawn pattern: room name,
 * "is ready", "for you.".
 */
export function headingLines(layout, heading) {
  const drawn = HEADING_LINES[layout]?.[heading];
  if (drawn) return drawn;
  if (layout === 'desktop' && heading === S.ready.heading_motion_floor) {
    const pattern = HEADING_LINES.desktop[S.ready.heading_lounge];
    const room = S.ready.heading_lounge.slice(0, S.ready.heading_lounge.indexOf(' is ready'));
    const other = heading.slice(0, heading.indexOf(' is ready'));
    if (pattern && pattern[0] === room) return [other, ...pattern.slice(1)];
  }
  return null;
}

export { HEADING_LINES };
