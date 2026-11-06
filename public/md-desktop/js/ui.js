// Shared UI helpers used by the desktop shell and every app.

export const EASE_MAC = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

const params = new URLSearchParams(location.search);
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('motion');

/** Build DOM from an HTML string. Returns the first element. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Render lucide icons inside root. Only fresh <i data-lucide> placeholders are converted; existing SVGs are never
 *  touched. (lucide.createIcons re-renders every icon on the page each call, which swapped buttons' SVGs mid-click
 *  and made clicks get lost, e.g. play/pause.) */
const pascal = n => n.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
export function icons(root = document) {
  const L = window.lucide; if (!L) return;
  root.querySelectorAll('i[data-lucide]').forEach(el => {
    const name = el.getAttribute('data-lucide'), node = L.icons[pascal(name)];
    if (!node) return;
    const svg = L.createElement(node);
    svg.setAttribute('class', `lucide lucide-${name} ${el.getAttribute('class') || ''}`.trim());
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('aria-hidden', 'true');
    el.replaceWith(svg);
  });
}
export const ic = (name, extra = '') => `<i data-lucide="${name}" ${extra}></i>`;

/* ---------- app icons: the official logos (assets/icons) on macOS-style tiles ---------- */
const ICON_SRC = { ae: 'assets/icons/after-effects.svg', bl: 'assets/icons/blender.svg', cf: 'assets/icons/comfyui.svg' };
export function appIcon(id, size = 56) {
  return `<div class="aicon aicon-${id}" style="--s:${size}px"><img src="${ICON_SRC[id]}" alt="" draggable="false"></div>`;
}

/* ---------- segmented control / tabs with sliding indicator ---------- */
export function seg(el, onChange) {
  let ind = el.querySelector('.ind');
  if (!ind) { ind = h('<span class="ind"></span>'); el.prepend(ind); }
  const btns = $$('button', el);
  const place = (b, instant) => {
    if (!b || !b.offsetWidth) return;
    if (instant) ind.style.transition = 'none';
    ind.style.width = b.offsetWidth + 'px';
    ind.style.transform = `translateX(${b.offsetLeft - 3}px)`;
    if (instant) { ind.offsetWidth; ind.style.transition = ''; }
  };
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.setAttribute('aria-selected', x === b));
    place(b);
    onChange?.(b.dataset.v ?? b.textContent.trim(), b);
  }));
  const sync = () => place(btns.find(b => b.getAttribute('aria-selected') === 'true'), true);
  new ResizeObserver(sync).observe(el);
  requestAnimationFrame(sync);
  return { select(v) { const b = btns.find(x => (x.dataset.v ?? x.textContent.trim()) === v); if (b) { btns.forEach(x => x.setAttribute('aria-selected', x === b)); place(b); } } };
}

/** Vertical nav with a sliding highlight. */
export function nav(el, onChange) {
  const ind = h('<span class="ind"></span>'); el.prepend(ind);
  const btns = $$('button', el);
  const place = (b, instant) => {
    if (!b) return;
    if (instant) ind.style.transition = 'none';
    ind.style.height = b.offsetHeight + 'px';
    ind.style.transform = `translateY(${b.offsetTop}px)`;
    if (instant) { ind.offsetWidth; ind.style.transition = ''; }
  };
  const select = (b, fire = true) => {
    btns.forEach(x => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'page');
    place(b);
    if (fire) onChange?.(b.dataset.v, b);
  };
  btns.forEach(b => b.addEventListener('click', () => select(b)));
  requestAnimationFrame(() => place(btns.find(b => b.hasAttribute('aria-current')), true));
  return { select: v => { const b = btns.find(x => x.dataset.v === v); if (b) select(b, false); } };
}

/* ---------- scrub number field: drag sideways, double-click to type ---------- */
export function scrub(el, { get, set, step = 1, digits = 1, suffix = '' }) {
  const out = el.querySelector('b');
  const render = () => { out.textContent = get().toFixed(digits) + suffix; };
  let sx = 0, sv = 0, moved = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || el.querySelector('input')) return;
    el.setPointerCapture(e.pointerId); sx = e.clientX; sv = get(); moved = false;
  });
  el.addEventListener('pointermove', e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - sx; if (Math.abs(dx) > 2) moved = true;
    set(sv + dx * step * (e.shiftKey ? 0.1 : 1)); render();
  });
  el.addEventListener('dblclick', () => {
    const inp = h(`<input value="${get().toFixed(digits)}">`);
    out.replaceWith(inp); inp.focus(); inp.select();
    const done = ok => { if (ok) { const v = parseFloat(inp.value); if (!isNaN(v)) set(v); } inp.replaceWith(out); render(); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true), { once: true });
  });
  render();
  return { render };
}

/* ---------- dropdown menus ---------- */
let openMenu = null;
export function closeMenu() {
  if (!openMenu) return;
  const m = openMenu; openMenu = null;
  m.el.classList.add('out'); m.onClose?.();
  setTimeout(() => m.el.remove(), 130);
}
/** items: [{label, kbd, action, disabled}] or 'sep' */
export function showMenu(anchor, items, { align = 'left', onClose } = {}) {
  closeMenu();
  const el = h('<div class="menu" role="menu"></div>');
  items.forEach(it => {
    if (it === 'sep') return el.append(h('<hr>'));
    const b = h(`<button role="menuitem" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`);
    b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); it.action?.(); });
    el.append(b);
  });
  document.body.append(el);
  const r = anchor.getBoundingClientRect(), mw = el.offsetWidth, mh = el.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left, y = r.bottom + 4, oy = 'top';
  if (y + mh > innerHeight - 8) { y = r.top - mh - 4; oy = 'bottom'; }
  x = Math.max(6, Math.min(x, innerWidth - mw - 6));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.setProperty('--origin', `${align === 'right' ? 'right' : 'left'} ${oy}`);
  openMenu = { el, onClose };
  return el;
}
addEventListener('pointerdown', e => { if (openMenu && !openMenu.el.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
// Like macOS: clicking a button with the mouse doesn't leave keyboard focus on it,
// so Space keeps meaning "play/pause" instead of re-clicking the last button pressed.
addEventListener('mousedown', e => { if (e.button === 0 && e.target.closest?.('button, [role="button"]')) e.preventDefault(); }, true);

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h(`<div class="toast glass">${esc(msg)}</div>`);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.transition = 'opacity 200ms ease'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, 1800);
}

/** Swap the content of a container with a soft enter animation. */
export function swap(container, el) {
  container.replaceChildren(el);
  el.classList.add('view');
  if (!reduceMotion) el.classList.add('view-enter');
  icons(el);
  return el;
}

/** Shared launcher layout for all three apps. */
export function launcher({ id, name, nav: items, status, onNav, body }) {
  const el = h(`<div class="launcher">
    <aside class="side">
      <div class="brand">${appIcon(id, 44)}<b>${esc(name)}</b></div>
      <nav class="nav">${items.map((it, i) => it === 'sep' ? '<hr>' : `<button data-v="${it.v}" title="${esc(it.label)}" ${i === 0 ? 'aria-current="page"' : ''}>${ic(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</nav>
      <div class="status">${status}</div>
    </aside>
    <section class="main"></section>
  </div>`);
  const main = el.querySelector('.main');
  const navApi = nav(el.querySelector('.nav'), v => onNav?.(v));
  if (body) main.append(body);
  return { el, main, nav: navApi };
}
