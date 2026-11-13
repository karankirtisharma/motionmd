/**
 * Semantic DOM for the intro: built once, then patched from the presentation
 * model. It never reads the renderer and the renderer never reads it; both are
 * driven by the application (src/index.mjs).
 *
 * Document order is the keyboard order: sound and light in the header, then
 * destination, version, rotation, studies, entry (2026-11 revision).
 */
import { COPY, DESTINATIONS, LIGHTS, SCREEN_COPY } from '../config/copy.mjs';
import { icon } from './icons.mjs';

const S = COPY.state;

function template({ headingLevel, brandHref }) {
  const h = `h${headingLevel}`;
  const sub = `h${Math.min(6, headingLevel + 1)}`;
  const brand = brandHref
    ? `<a class="lm-brand" href="${brandHref}">${COPY.brand}</a>`
    : `<p class="lm-brand">${COPY.brand}</p>`;
  const radios = (name, items, extra) => Object.values(items).map((item) => `
        <input class="lm-radio" type="radio" name="lm-${name}" id="lm-${name}-${item.id}" value="${item.id}">
        <label class="lm-button lm-pill" for="lm-${name}-${item.id}"${extra ?? ''}>${item.label}</label>`).join('');
  return `
  <span class="lm-scale-probe" data-lm="scale-probe" aria-hidden="true"></span>
  <canvas class="lm-canvas" data-lm="canvas" aria-hidden="true"></canvas>
  <img class="lm-poster" data-lm="poster" alt="" aria-hidden="true" decoding="async">
  <div class="lm-veil" data-lm="veil"></div>

  <header class="lm-header" data-lm="header">
    ${brand}
    <div class="lm-toggles">
      <button class="lm-button lm-toggle" type="button" data-lm="sound" aria-pressed="false">${icon('sound-off')}<span class="lm-toggle-label"></span></button>
      <div class="lm-header-light" data-lm="light" role="group" aria-labelledby="lm-light-label" hidden>
        <span class="lm-eyebrow" id="lm-light-label">${COPY.lightLabel}</span>
        <div class="lm-segment lm-segment--light">${radios('light', LIGHTS)}
        </div>
      </div>
    </div>
  </header>

  <div class="lm-popover lm-confirm lm-glass" data-lm="confirm" aria-hidden="true" hidden>
    <${sub}>${S.soft_preference_confirmation.heading}</${sub}>
    <p>${S.soft_preference_confirmation.body}</p>
    <div class="lm-confirm-status">${icon('sun')}<span>${S.soft_preference_confirmation.status}</span></div>
  </div>

  <div class="lm-main" data-lm="main">
    <${h} class="lm-title" id="lm-heading" data-lm="heading" tabindex="-1"></${h}>
    <p class="lm-body" data-lm="body"></p>

    <fieldset class="lm-field lm-field--destination" data-lm="destination">
      <legend class="lm-sr">${COPY.destinationLabel}</legend>
      <div class="lm-segment lm-segment--destination">${radios('destination', DESTINATIONS)}
      </div>
    </fieldset>

    <div class="lm-recovery" data-lm="recovery" hidden>
      <button class="lm-button lm-button--primary" type="button" data-lm="retry">${icon('retry')}<span data-lm="retry-label"></span></button>
      <button class="lm-button" type="button" data-lm="recovery-light">${SCREEN_COPY.useLite}</button>
      <button class="lm-button" type="button" data-lm="keep-waiting">${S.suspected_stall.continue_waiting}</button>
    </div>

    <div class="lm-landing-actions" data-lm="landing-actions" hidden>
      <p class="lm-landing-kept">${SCREEN_COPY.lightLandingKept}</p>
      <button class="lm-button lm-button--primary" type="button" data-lm="landing-enter">${S.light_version_landing.action}</button>
      <button class="lm-link" type="button" data-lm="landing-back">${S.light_version_landing.secondary}</button>
    </div>

    <div class="lm-version-row" data-lm="version-row">
      <fieldset class="lm-field lm-field--version" data-lm="version" hidden>
        <legend class="lm-eyebrow">${SCREEN_COPY.versionLabel}</legend>
        <div class="lm-segment lm-segment--version">
          <button class="lm-button lm-pill" type="button" data-lm="version-immersive" aria-pressed="true">${SCREEN_COPY.versionImmersive}</button>
          <button class="lm-button lm-pill" type="button" data-lm="version-lite" aria-pressed="false">${SCREEN_COPY.versionLite}</button>
        </div>
      </fieldset>
      <p class="lm-note" data-lm="note"></p>
    </div>

    <div class="lm-stage-slot">
      <div class="lm-stage" data-lm="stage">
        <p class="lm-sr">A miniature of the studio: travertine floors, bronze glazing and a curved stair on an oval bronze plinth.</p>
        <div class="lm-rotate lm-glass" data-lm="rotate" role="group" aria-label="${S.structure.accessible_hint}" hidden>
          <div class="lm-rotate-buttons">
            <button class="lm-button lm-button--icon" type="button" data-lm="rotate-left" aria-label="${COPY.rotateLeft}">${icon('left')}</button>
            <button class="lm-button lm-button--icon" type="button" data-lm="rotate-right" aria-label="${COPY.rotateRight}">${icon('right')}</button>
          </div>
          <p class="lm-rotate-caption" aria-hidden="true">${SCREEN_COPY.rotateCaption}</p>
        </div>
      </div>
    </div>

    <div class="lm-links" data-lm="links">
      <button class="lm-link" type="button" data-lm="studies" aria-haspopup="dialog">${COPY.studiesLink}</button>
    </div>
  </div>

  <div class="lm-sheet lm-glass" data-lm="sheet" role="dialog" aria-labelledby="lm-sheet-title" data-view="list" hidden>
    <div class="lm-sheet-head">
      <div>
        <${sub} class="lm-sheet-title" id="lm-sheet-title" data-lm="sheet-title" tabindex="-1"></${sub}>
        <p class="lm-sheet-sub" data-lm="sheet-sub"></p>
      </div>
      <button class="lm-button" type="button" data-lm="sheet-head-action"></button>
    </div>
    <ul class="lm-study-list" data-lm="study-list"></ul>
    <div class="lm-study-detail" data-lm="study-detail" hidden>
      <figure class="lm-study-figure" data-lm="study-figure"><img class="lm-study-image" data-lm="study-image" alt=""></figure>
      <p class="lm-study-missing" data-lm="study-missing" hidden>${S.study_detail.image_unavailable}</p>
      <p class="lm-study-caption" data-lm="study-caption"></p>
    </div>
    <p class="lm-study-missing" data-lm="study-empty" hidden><strong>${S.selected_work.empty_heading}</strong> ${S.selected_work.empty_body}</p>
    <div class="lm-sheet-foot">
      <p data-lm="sheet-foot-text">${SCREEN_COPY.studiesFooter}</p>
      <div class="lm-sheet-actions">
        <button class="lm-button" type="button" data-lm="sheet-back-studies">${S.study_detail.back_to_studies}</button>
        <button class="lm-button" type="button" data-lm="sheet-back-model">${icon('left')}<span>${COPY.backToModel}</span></button>
        <button class="lm-button" type="button" data-lm="sheet-light-version" hidden>${SCREEN_COPY.useLite}</button>
      </div>
    </div>
    <div class="lm-sheet-ready" data-lm="sheet-ready" hidden>
      <p>${S.selected_work.ready_notice}</p>
      <button class="lm-button lm-button--primary" type="button" data-lm="sheet-enter"></button>
    </div>
  </div>

  <section class="lm-status lm-glass" data-lm="status" aria-label="${S.boot.status}">
    <p class="lm-status-label" data-lm="status-label"></p>
    <div class="lm-progress" data-lm="progress" data-kind="idle">
      <div class="lm-progress-meta"><span data-lm="progress-label" id="lm-progress-label"></span></div>
      <div class="lm-progress-track" data-lm="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-labelledby="lm-progress-label"><div class="lm-progress-fill" data-lm="progress-fill"></div></div>
    </div>
    <p class="lm-status-value" data-lm="status-value" aria-hidden="true"></p>
    <p class="lm-status-note" data-lm="status-note" aria-hidden="true"></p>
    <ol class="lm-phases" data-lm="phases" aria-label="Preparation phases">${COPY.phaseLabels.map((label) => `
      <li class="lm-phase" data-state="pending"><span aria-hidden="true">${label}</span><span class="lm-sr"></span></li>`).join('')}
    </ol>
    <div class="lm-ready" data-lm="ready" hidden>
      <div class="lm-ready-text">${icon('check')}<p class="lm-ready-title" data-lm="ready-title"></p><p class="lm-ready-supporting" data-lm="ready-supporting"></p></div>
      <button class="lm-button lm-button--primary lm-button--large lm-enter" type="button" data-lm="enter" aria-describedby="lm-enter-hint"></button>
      <p class="lm-enter-hint" id="lm-enter-hint" data-lm="enter-hint" hidden></p>
    </div>
    <div class="lm-landing-panel" data-lm="landing-panel" hidden>
      <${sub} data-lm="landing-title"></${sub}>
      <p data-lm="landing-body"></p>
    </div>
    <button class="lm-button lm-button--small lm-status-action" type="button" data-lm="recovery-reopen" hidden>${S.suspected_stall.retry}</button>
  </section>

  <div class="lm-sr" data-lm="live-polite" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="lm-sr" data-lm="live-assertive" role="alert" aria-live="assertive" aria-atomic="true"></div>`;
}

function setText(element, text) {
  const value = text ?? '';
  if (element.textContent !== value) element.textContent = value;
}

/**
 * Headline text with optional line hints. The text content is always the one
 * string; the hints only decide where it wraps while there is room.
 */
function setHeading(element, text, lines) {
  const signature = lines ? lines.join('\n') : text;
  if (element.dataset.signature === signature) return;
  element.dataset.signature = signature;
  delete element.dataset.wrap;
  if (!lines) {
    delete element.dataset.lines;
    element.textContent = text;
    return;
  }
  element.dataset.lines = String(lines.length);
  element.textContent = '';
  lines.forEach((line, index) => {
    if (index) element.append(' ');
    const span = document.createElement('span');
    span.className = 'lm-title-line';
    span.textContent = line;
    element.append(span);
  });
  fitHeading(element);
}

/**
 * The drawn line breaks hold while every drawn line fits on one line. Where
 * one does not (a narrow screen, larger text), the headline wraps freely
 * instead of breaking twice.
 */
function fitHeading(element) {
  const lines = element.querySelectorAll('.lm-title-line');
  if (!lines.length) return;
  delete element.dataset.wrap; // measure with the drawn lines in force
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
  if (!(lineHeight > 0)) return;
  for (const line of lines) {
    if (line.getBoundingClientRect().height > lineHeight * 1.5) {
      element.dataset.wrap = 'free';
      return;
    }
  }
}

/**
 * Body copy. With more than one sentence, the first sentence and the rest are
 * kept whole where there is room, as drawn in D09, D10, M03 and M07.
 */
function setBody(element, text) {
  const value = text ?? '';
  if (element.dataset.signature === value) return;
  element.dataset.signature = value;
  const split = value.indexOf('. ');
  element.dataset.sentences = split === -1 ? '1' : '2';
  if (split === -1) {
    element.textContent = value;
    return;
  }
  element.textContent = '';
  [value.slice(0, split + 1), value.slice(split + 2)].forEach((part, index) => {
    if (index) element.append(' ');
    const span = document.createElement('span');
    span.className = 'lm-sentence';
    span.textContent = part;
    element.append(span);
  });
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function setAttr(element, name, value) {
  if (value === null || value === undefined || value === false) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
}

export function createView(container, { headingLevel = 1, brandHref = null, brand = null } = {}) {
  const root = document.createElement('div');
  root.className = 'lm-root';
  root.dataset.layout = 'desktop';
  root.dataset.motion = 'full';
  root.dataset.graphics = 'pending';
  root.dataset.sheet = 'closed';
  root.innerHTML = template({ headingLevel, brandHref });
  // The header carries the plain-text name from the copy deck unless the site
  // supplies its own: other text, or an element such as the logo.
  if (brand != null) {
    const slot = root.querySelector('.lm-brand');
    if (typeof brand === 'string') slot.textContent = brand;
    else slot.replaceChildren(brand);
  }
  container.append(root);

  const refs = {};
  for (const element of root.querySelectorAll('[data-lm]')) refs[element.dataset.lm] = element;
  const radios = {
    destination: [...root.querySelectorAll('input[name="lm-destination"]')],
    light: [...root.querySelectorAll('input[name="lm-light"]')],
  };
  const phaseItems = [...refs.phases.children];
  const listeners = new Map();
  const emit = (name, detail) => { for (const listener of listeners.get(name) ?? []) listener(detail); };

  const click = (ref, name, detail) => refs[ref].addEventListener('click', (event) => {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
    emit(name, typeof detail === 'function' ? detail(event) : detail);
  });
  for (const input of radios.destination) input.addEventListener('change', () => { if (input.checked) emit('destination', input.value); });
  for (const input of radios.light) input.addEventListener('change', () => { if (input.checked) emit('light', input.value); });
  click('sound', 'sound');
  // The current experience is the immersive one: pressing it again does nothing.
  click('version-lite', 'light-version');
  click('retry', 'retry');
  click('recovery-light', 'light-version');
  click('keep-waiting', 'keep-waiting');
  click('recovery-reopen', 'recovery-reopen');
  click('landing-enter', 'landing-enter');
  click('landing-back', 'landing-back');
  click('rotate-left', 'rotate', -1);
  click('rotate-right', 'rotate', 1);
  click('studies', 'studies');
  click('enter', 'enter');
  click('sheet-enter', 'enter');
  click('sheet-light-version', 'light-version');

  let lastModel = null;

  function render(model) {
    lastModel = model;
    const hadFocusInside = root.contains(document.activeElement) && document.activeElement !== document.body;
    root.dataset.mode = model.mode;

    setHeading(refs.heading, model.heading, model.headingLines);
    setBody(refs.body, model.body);

    setHidden(refs.destination, !model.destination.visible);
    for (const input of radios.destination) {
      const checked = input.value === model.destination.value;
      if (input.checked !== checked) input.checked = checked;
      const offered = model.destination.options.some((option) => option.id === input.value);
      setHidden(input, !offered);
      setHidden(input.nextElementSibling, !offered);
    }
    setHidden(refs.light, !model.light.visible);
    setHidden(refs.version, !model.version.visible);
    setAttr(refs['version-lite'], 'aria-disabled', model.version.busy ? 'true' : null);
    setAttr(refs['version-lite'], 'aria-busy', model.version.busy ? 'true' : null);
    for (const input of radios.light) {
      const checked = input.value === model.light.value;
      if (input.checked !== checked) input.checked = checked;
    }

    const recovery = model.recovery;
    setHidden(refs.recovery, !recovery.visible);
    if (recovery.visible) {
      setHidden(refs.retry, !recovery.retry);
      if (recovery.retry) {
        setText(refs['retry-label'], recovery.retry.label);
        setAttr(refs.retry, 'aria-disabled', recovery.retry.busy ? 'true' : null);
        setAttr(refs.retry, 'aria-busy', recovery.retry.busy ? 'true' : null);
        refs.retry.classList.toggle('lm-button--primary', !recovery.retry.busy);
      }
      setHidden(refs['recovery-light'], !recovery.lightVersion);
      if (recovery.lightVersion) setAttr(refs['recovery-light'], 'aria-disabled', recovery.lightVersion.busy ? 'true' : null);
      setHidden(refs['keep-waiting'], !recovery.keepWaiting);
    }

    setHidden(refs['landing-actions'], !model.landing);

    setText(refs.note, model.note?.text ?? '');
    setAttr(refs.note, 'data-tone', model.note?.tone ?? null);

    setHidden(refs.links, !model.links.studies);
    setHidden(refs.studies, !model.links.studies);

    setHidden(refs.rotate, !model.rotation.visible);

    // ---- settings
    const { sound } = model.toggles;
    setHidden(refs.sound, !sound);
    if (sound) {
      setAttr(refs.sound, 'aria-pressed', String(sound.pressed));
      const soundLabel = refs.sound.querySelector('.lm-toggle-label');
      setText(soundLabel, sound.label);
      const wanted = icon(sound.pressed ? 'sound-on' : 'sound-off');
      if (refs.sound.dataset.icon !== String(sound.pressed)) {
        refs.sound.dataset.icon = String(sound.pressed);
        refs.sound.querySelector('svg').outerHTML = wanted;
      }
    }

    // ---- status rail
    const status = model.status;
    const stacked = root.dataset.layout === 'stacked';
    setAttr(refs.status, 'aria-label', status.label);
    setAttr(refs.status, 'aria-busy', model.busy ? 'true' : 'false');
    const railShowsProgress = !status.ready && !model.landing;
    setHidden(refs['status-label'], !railShowsProgress);
    setText(refs['status-label'], status.label);
    setHidden(refs.progress, !railShowsProgress);
    setHidden(refs['status-value'], !railShowsProgress);
    setHidden(refs.phases, !status.phasesVisible);

    const progress = status.progress;
    refs.progress.dataset.kind = progress.kind;
    const determinate = progress.kind === 'determinate';
    if (determinate) {
      refs['progress-fill'].style.width = `${progress.exact.toFixed(2)}%`;
      setAttr(refs['progress-bar'], 'aria-valuenow', progress.percent);
      setAttr(refs['progress-bar'], 'aria-valuetext', COPY.percentText(progress.percent));
    } else {
      refs['progress-fill'].style.width = '';
      setAttr(refs['progress-bar'], 'aria-valuenow', null);
      setAttr(refs['progress-bar'], 'aria-valuetext', progress.kind === 'idle' ? null : status.label);
    }
    // Desktop: "Scene download" sits above the bar and the percentage or a
    // quiet note sits at the right. Stacked: label and percentage on the first
    // line, the supporting line under the bar.
    setText(refs['status-value'], determinate ? `${progress.percent}%` : '');
    setText(refs['progress-label'], stacked || determinate ? status.supporting : '');
    setText(refs['status-note'], !stacked && !determinate ? status.supporting : '');
    setHidden(refs['status-note'], !railShowsProgress);

    status.phases.forEach((phase, index) => {
      const item = phaseItems[index];
      setAttr(item, 'data-state', phase.state);
      setAttr(item, 'aria-current', phase.state === 'current' ? 'step' : null);
      setText(item.lastElementChild, phase.description);
    });

    setHidden(refs.ready, !status.ready);
    if (status.ready) {
      setText(refs['ready-title'], status.ready.title);
      setText(refs['ready-supporting'], status.ready.supporting);
    }
    // Compact layout only: the confirmed input hint sits under the Enter action
    // (on desktop it takes the hint line beside the choices).
    setText(refs['enter-hint'], model.enter?.hint ?? '');
    setHidden(refs['enter-hint'], !(model.enter?.hint && stacked));
    if (model.enter) {
      for (const button of [refs.enter, refs['sheet-enter']]) {
        setText(button, model.enter.label);
        setAttr(button, 'aria-disabled', model.enter.busy ? 'true' : null);
        setAttr(button, 'aria-busy', model.enter.busy ? 'true' : null);
      }
    }
    setHidden(refs['sheet-ready'], !model.enter);

    setHidden(refs['landing-panel'], !model.landing);
    if (model.landing) {
      setText(refs['landing-title'], stacked ? status.label : model.landing.panelTitle);
      setText(refs['landing-body'], stacked ? status.supporting : model.landing.panelBody);
    }
    setHidden(refs['recovery-reopen'], !status.recoveryReopen);
    setHidden(refs['sheet-light-version'], !(model.links.lightVersion || model.recovery.lightVersion));
    setAttr(refs['sheet-light-version'], 'aria-disabled', model.links.lightVersionBusy ? 'true' : null);

    // A control that held focus may have just been hidden; keep focus on the page.
    if (hadFocusInside && (document.activeElement === document.body || document.activeElement === null)) {
      refs.heading.focus({ preventScroll: true });
    }
  }

  return {
    root,
    refs,
    render,
    get model() { return lastModel; },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return () => listeners.get(name).delete(listener);
    },
    emit,
    announce(text, { assertive = false } = {}) {
      const region = assertive ? refs['live-assertive'] : refs['live-polite'];
      // Re-announce identical consecutive messages by clearing first.
      region.textContent = '';
      if (text) requestAnimationFrame(() => { region.textContent = text; });
    },
    setLayout(layout) {
      if (root.dataset.layout !== layout) {
        root.dataset.layout = layout;
        if (lastModel) render(lastModel);
      }
    },
    /** Re-judge the drawn headline breaks after a change of size. */
    fitHeading() { fitHeading(refs.heading); },
    destroy() {
      listeners.clear();
      root.remove();
    },
  };
}
