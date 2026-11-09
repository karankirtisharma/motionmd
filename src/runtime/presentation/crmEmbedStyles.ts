/** Host-only adaptation for the measured, wide Founder display. The supplied CRM
 * build stays byte-for-byte intact; no resize polling or extra render loop. */
export function installCrmEmbedStyles(document: Document) {
  if (document.querySelector('style[data-md-host-responsive]')) return;
  const style = document.createElement('style');
  style.dataset.mdHostResponsive = '';
  style.textContent = `
    .command-grid > .win { min-width: 0; }
    .command-grid > .win > .win-body {
      min-width: 0;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(155, 120, 56, .35) transparent;
    }
    .command-grid .roadmap-grid { flex-shrink: 0; }
    .command-grid .roadmap-row > * { min-width: 0; }
    .command-grid .ms-pill {
      min-height: 26px;
      height: auto;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .command-grid [data-win="allocation"] .alloc-surface,
    .command-grid [data-win="allocation"] .win-body > .row { flex-shrink: 0; }
    .command-grid .release-row { min-height: 130px; }
    .command-grid .atlas { min-height: 134px; }
    .command-grid .global-stats { flex-shrink: 0; flex-wrap: wrap; }
    /* Card content establishes its own height; the library, not the text,
       scrolls when the screen cannot fit both rows. */
    .ai-lib { min-width: 0; }
    .ai-lib-grid {
      overflow: auto;
      align-items: start;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      padding: 3px;
    }
    .ai-lib-col { grid-template-rows: auto auto auto; }
    .ai-tcard { min-height: 250px; min-width: 0; }
    .ai-tcard > .row, .ai-tcard-foot { flex-shrink: 0; }
    .ai-tcard > .ai-cv { flex: 0 0 72px; height: 72px; min-height: 72px; max-height: 72px; }
    .ai-tcard > .row:has(> .ai-tag) {
      flex-wrap: wrap !important;
      overflow: visible !important;
    }
    .ai-tcard .ai-tag {
      min-width: 0;
      max-width: 100%;
      min-height: 22px;
      height: auto;
      white-space: normal;
      overflow-wrap: anywhere;
      overflow: visible !important;
    }
    .ai-tcard-foot { flex-wrap: wrap; }
    .ai-lib-bar { flex-wrap: wrap; }
    .ai-runs-strip {
      grid-template-columns: auto repeat(5, minmax(140px, 1fr));
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    /* Keep all people and drop targets inside the Resource calendar. */
    .studio-alloc .studio-grid {
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    .studio-alloc .studio-grid-head { flex-shrink: 0; }
    .studio-alloc .studio-legend { flex-wrap: wrap; row-gap: 6px; }
    .studio-alloc .studio-tray > .win-body {
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    .studio-alloc .studio-tray-row { grid-auto-columns: minmax(190px, 1fr); }
    @media (max-height: 820px) {
      .command-grid { gap: 12px; }
      .command-grid > .win { padding: 12px 16px; }
      .command-grid .win-head { margin-bottom: 8px; }
      .command-grid .roadmap-row > * { padding: 5px 0; }
      .command-grid .roadmap-grid > div:not(.roadmap-row) { padding-bottom: 5px; }
      .command-grid .alloc-row { height: 40px; }
      .command-grid .alloc-kpis { gap: 12px; padding-block: 6px; }
      .command-grid .global-stats { padding: 6px 8px; }
    }
  `;
  document.head.append(style);
}

