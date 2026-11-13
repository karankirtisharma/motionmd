/**
 * The kit's monoline icons (01_ui_package/components/icons), inlined so they
 * inherit currentColor and need no requests. Decorative: every control that
 * uses one has a text label or an accessible name.
 */
const PATHS = Object.freeze({
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  motion: '<path d="M3 9q3-5 6 0t6 0 6 0M3 15q3-5 6 0t6 0 6 0"/>',
  retry: '<path d="M19 8a8 8 0 1 0 1 8M19 3v6h-6"/>',
  'sound-off': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6m0-6-5 6"/>',
  'sound-on': '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8q5 4 0 8m3-11q7 7 0 14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
});

export function icon(name) {
  const path = PATHS[name];
  if (!path) throw new RangeError(`Unknown icon: ${name}`);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
