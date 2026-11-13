/**
 * Explore studies: one sheet, a list of three original material previews and
 * a single still detail. Loading, preferences and readiness carry on beneath.
 *
 * Focus rules (ux_specification.json, study_interaction):
 *  - opening a detail focuses its heading and remembers the card and scroll
 *  - Back to studies or Escape from a detail restores that card and scroll
 *  - Back to the model or Escape from the list restores "Explore studies"
 *  - readiness never moves focus or closes the sheet
 */
import { COPY, SCREEN_COPY } from '../config/copy.mjs';
import { STUDY_CATALOG } from '../config/study-catalog.mjs';
import { icon } from './icons.mjs';

const S = COPY.state;

/** Catalog entries mapped to the files shipped with this build. */
export function studyAssets(assetBase) {
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  return STUDY_CATALOG.studies.map((study) => ({
    id: study.id,
    title: study.title,
    badge: STUDY_CATALOG.card_badge,
    cardDescription: study.card_description,
    detailDescription: study.detail_description,
    alt: study.image_alt,
    thumbnail: `${base}images/studies/${study.id}-thumb.webp`,
    // The kit's own WebP, by its catalog name.
    image: `${base}images/studies/${study.detail_web_image.split('/').pop()}`,
  }));
}

export function createStudies({ view, assetBase, onChange }) {
  const { refs, root } = view;
  const studies = studyAssets(assetBase);
  const state = { open: false, view: 'list', studyId: null };
  let built = false;
  let opener = null;
  let originCard = null;
  let listScroll = 0;
  let pageScroll = 0;

  const stacked = () => root.dataset.layout === 'stacked';
  const scroller = () => (stacked() ? document.scrollingElement ?? document.documentElement : refs.sheet);

  function buildList() {
    if (built) return;
    built = true;
    for (const study of studies) {
      const item = document.createElement('li');
      item.className = 'lm-study-card';
      item.innerHTML = `
        <p class="lm-study-badge">${study.badge}</p>
        <img class="lm-study-thumb" alt="" loading="lazy" decoding="async" width="520" height="440">
        <h3 class="lm-study-name">${study.title}</h3>
        <p class="lm-study-desc">${study.cardDescription}</p>
        <button class="lm-button" type="button" data-study="${study.id}" aria-label="${COPY.studyActionName(study.title)}">${S.selected_work.action}</button>`;
      const image = item.querySelector('img');
      image.addEventListener('error', () => { image.style.visibility = 'hidden'; }, { once: true });
      image.src = study.thumbnail;
      const button = item.querySelector('button');
      button.addEventListener('click', () => showDetail(study.id, button));
      refs['study-list'].append(item);
    }
    setHiddenAll();
  }

  function setHiddenAll() {
    const detail = state.view === 'detail';
    const narrow = stacked();
    refs.sheet.dataset.view = state.view;
    refs['study-list'].hidden = detail || studies.length === 0;
    refs['study-empty'].hidden = detail || studies.length > 0;
    refs['study-detail'].hidden = !detail;
    refs['sheet-foot-text'].hidden = detail;
    // Header action: back to the model from the list, back to studies from a detail.
    refs['sheet-head-action'].innerHTML = detail
      ? `<span>${S.study_detail.back_to_studies}</span>`
      : `${icon('left')}<span>${COPY.backToModel}</span>`;
    refs['sheet-back-studies'].hidden = !(detail && narrow);
    refs['sheet-back-model'].hidden = !(detail || narrow);
    if (detail) {
      const study = studies.find((item) => item.id === state.studyId);
      refs['sheet-title'].textContent = study.title;
      refs['sheet-sub'].textContent = S.study_detail.badge;
      refs['study-caption'].textContent = study.detailDescription;
    } else {
      refs['sheet-title'].textContent = S.selected_work.heading;
      refs['sheet-sub'].textContent = narrow ? COPY.variant.M05.body : S.selected_work.body;
    }
  }

  function showDetail(studyId, card) {
    const study = studies.find((item) => item.id === studyId);
    if (!study) return;
    originCard = card ?? originCard;
    listScroll = scroller().scrollTop;
    state.view = 'detail';
    state.studyId = studyId;
    // Fetch only the selected still. Title, text and Back stay if it fails.
    const image = refs['study-image'];
    refs['study-figure'].hidden = false;
    refs['study-missing'].hidden = true;
    image.onerror = () => {
      refs['study-figure'].hidden = true;
      refs['study-missing'].hidden = false;
    };
    image.alt = study.alt;
    if (image.getAttribute('src') !== study.image) image.src = study.image;
    setHiddenAll();
    scroller().scrollTop = stacked() ? 0 : 0;
    refs['sheet-title'].focus({ preventScroll: true });
    onChange?.({ ...state });
  }

  function backToStudies() {
    if (state.view !== 'detail') return;
    state.view = 'list';
    state.studyId = null;
    setHiddenAll();
    scroller().scrollTop = listScroll;
    (originCard ?? refs['sheet-title']).focus({ preventScroll: true });
    onChange?.({ ...state });
  }

  function open(from) {
    if (state.open) return;
    buildList();
    opener = from ?? refs.studies;
    state.open = true;
    state.view = 'list';
    state.studyId = null;
    pageScroll = (document.scrollingElement ?? document.documentElement).scrollTop;
    root.dataset.sheet = 'open';
    refs.sheet.hidden = false;
    refs.main.inert = true;
    setHiddenAll();
    if (stacked()) (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    refs['sheet-title'].focus({ preventScroll: true });
    onChange?.({ ...state });
  }

  function close({ restoreFocus = true } = {}) {
    if (!state.open) return;
    state.open = false;
    state.view = 'list';
    state.studyId = null;
    root.dataset.sheet = 'closed';
    refs.sheet.hidden = true;
    refs.main.inert = false;
    if (stacked()) (document.scrollingElement ?? document.documentElement).scrollTop = pageScroll;
    if (restoreFocus) (opener && !opener.hidden ? opener : refs.studies).focus({ preventScroll: true });
    onChange?.({ ...state });
  }

  refs['sheet-head-action'].addEventListener('click', () => (state.view === 'detail' ? backToStudies() : close()));
  refs['sheet-back-studies'].addEventListener('click', backToStudies);
  refs['sheet-back-model'].addEventListener('click', () => close());
  refs.sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (state.view === 'detail') backToStudies();
    else close();
  });

  return {
    state,
    open,
    close,
    backToStudies,
    showDetail,
    refreshLayout: () => { if (state.open) setHiddenAll(); },
    footerNote: SCREEN_COPY.studiesFooter,
  };
}
