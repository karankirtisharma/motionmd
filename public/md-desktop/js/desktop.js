// Desktop shell: dock, menu bar and a small macOS-style window manager.
import { h, $, appIcon, icons, showMenu, closeMenu, reduceMotion, EASE_MAC, EASE_OUT, EASE_IN_OUT } from './ui.js';

const SVG_X = '<svg viewBox="0 0 8 8" stroke="currentColor" stroke-width="1.3"><path d="M1.5 1.5l5 5M6.5 1.5l-5 5"/></svg>';
const SVG_MIN = '<svg viewBox="0 0 8 8" stroke="currentColor" stroke-width="1.3"><path d="M1 4h6"/></svg>';
const SVG_FULL = '<svg viewBox="0 0 8 8" fill="currentColor"><path d="M1.5 1.5h3.5L1.5 5zM6.5 6.5H3L6.5 3z"/></svg>';

export function createDesktop(apps) {
  const layer = $('#windows'), dock = $('#dock'), mb = $('#menubar');
  const wins = new Map();          // id -> { app, win, api, minimized, full, rect }
  let focused = null, z = 10;

  /* ---------------- dock ---------------- */
  apps.forEach(app => {
    const item = h(`<div class="item" data-id="${app.id}" role="button" tabindex="0" aria-label="Open ${app.name}"><span class="label glass">${app.name}</span>${appIcon(app.icon, 56)}</div>`);
    item.addEventListener('click', () => launch(app.id));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(app.id); } });
    dock.append(item);
  });
  magnify(dock);
  const dockItem = id => dock.querySelector(`.item[data-id="${id}"] .aicon`);

  // The dock always stays visible; windows are sized to stop above it, so nothing ever sits underneath it.
  const syncDock = () => dock.querySelectorAll('.item').forEach(it => it.classList.toggle('running', wins.has(it.dataset.id)));

  /* ---------------- geometry ---------------- */
  const GAP = 8;
  const usable = () => ({ W: layer.clientWidth, H: layer.clientHeight - (dock.offsetHeight + 2 * GAP + 4) }); // space above the dock
  const fullRect = () => { const { W, H } = usable(); return { x: GAP, y: GAP, w: W - 2 * GAP, h: H - GAP }; };
  const windowRect = () => { const { W, H } = usable(); return { x: Math.round(W * .06), y: Math.round(H * .05), w: Math.round(W * .88), h: Math.round(H * .88) }; };
  const setRect = (win, r) => {
    Object.assign(win.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    win.style.setProperty('--window-x', r.x + 'px');
    win.style.setProperty('--window-y', r.y + 'px');
  };
  addEventListener('resize', () => wins.forEach(s => { if (s.full) setRect(s.win, fullRect()); }));

  // FLIP: animate an element from a screen rect to where it is now
  function flipFrom(el, from, duration, easing, fade) {
    const to = el.getBoundingClientRect();
    const t = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    const kf = fade
      ? [{ transformOrigin: '0 0', transform: t, opacity: 0 }, { opacity: 1, offset: .35 }, { transformOrigin: '0 0', transform: 'none', opacity: 1 }]
      : [{ transformOrigin: '0 0', transform: t }, { transformOrigin: '0 0', transform: 'none' }];
    return el.animate(kf, { duration, easing });
  }
  function flipTo(el, to, duration, easing) {
    const from = el.getBoundingClientRect();
    const t = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
    return el.animate([{ transformOrigin: '0 0', transform: 'none', opacity: 1 }, { opacity: 1, offset: .65 }, { transformOrigin: '0 0', transform: t, opacity: 0 }], { duration, easing, fill: 'forwards' });
  }

  /* ---------------- window lifecycle ---------------- */
  function launch(id) {
    const s = wins.get(id);
    if (!s) return open(id);
    if (s.minimized) return restore(id);
    focus(id);
  }

  function open(id) {
    const app = apps.find(a => a.id === id);
    const win = h(`<div class="win full" data-app="${id}" role="dialog" aria-label="${app.name}">
      <div class="drag-strip"></div>
      <div class="lights"><button aria-label="Close">${SVG_X}</button><button aria-label="Minimise">${SVG_MIN}</button><button aria-label="Full screen">${SVG_FULL}</button></div>
      <div class="app"></div></div>`);
    layer.append(win);
    setRect(win, fullRect());
    const s = { app, win, minimized: false, full: true };
    wins.set(id, s);
    const [bClose, bMin, bFull] = win.querySelectorAll('.lights button');
    bClose.addEventListener('click', () => close(id));
    bMin.addEventListener('click', () => minimize(id));
    bFull.addEventListener('click', () => toggleFull(id));
    win.addEventListener('pointerdown', () => focus(id), true);
    makeDraggable(s);
    s.api = app.mount(win.querySelector('.app'), { close: () => close(id), refreshMenus: () => renderMenubar() }) || {};
    icons(win);
    focus(id);
    if (reduceMotion) win.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
    else flipFrom(win, dockItem(id).getBoundingClientRect(), 420, EASE_MAC, true);
  }

  function close(id) {
    const s = wins.get(id); if (!s) return;
    wins.delete(id);
    s.api.unmount?.();
    const a = s.win.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 200, easing: EASE_OUT, fill: 'forwards' });
    a.finished.then(() => s.win.remove());
    if (focused === id) focusTop();
    syncDock();
  }

  function minimize(id) {
    const s = wins.get(id); if (!s || s.minimized) return;
    s.minimized = true;
    s.api.onHide?.();
    const done = () => { s.win.classList.add('minimized'); s.win.getAnimations().forEach(a => a.cancel()); };
    if (reduceMotion) done();
    else flipTo(s.win, dockItem(id).getBoundingClientRect(), 380, EASE_MAC).finished.then(done);
    if (focused === id) focusTop();
    syncDock();
  }

  function restore(id) {
    const s = wins.get(id); if (!s) return;
    s.minimized = false;
    s.win.classList.remove('minimized');
    if (s.full) setRect(s.win, fullRect());
    focus(id);
    s.api.onShow?.();
    if (reduceMotion) s.win.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
    else flipFrom(s.win, dockItem(id).getBoundingClientRect(), 420, EASE_MAC, true);
  }

  function toggleFull(id) {
    const s = wins.get(id); if (!s) return;
    const before = s.win.getBoundingClientRect();
    s.full = !s.full;
    s.win.classList.toggle('full', s.full);
    setRect(s.win, s.full ? fullRect() : (s.rect || windowRect()));
    if (!reduceMotion) flipFrom(s.win, before, 320, EASE_IN_OUT, false);
    s.api.onResize?.();
    syncDock();
  }

  function focus(id) {
    const s = wins.get(id); if (!s) return;
    if (focused === id) return; // clicks inside the focused window change nothing (no menu-bar rebuild per click)
    s.win.style.zIndex = ++z;
    focused = id;
    wins.forEach((w, k) => w.win.classList.toggle('focused', k === id));
    renderMenubar(); syncDock();
  }
  function focusTop() {
    let best = null, bz = -1;
    wins.forEach((s, k) => { if (!s.minimized && +s.win.style.zIndex > bz) { bz = +s.win.style.zIndex; best = k; } });
    focused = null;
    if (best) focus(best); else { wins.forEach(w => w.win.classList.remove('focused')); renderMenubar(); syncDock(); }
  }

  // windowed mode: drag by the top strip or any [data-drag] bar inside the app
  function makeDraggable(s) {
    let sx, sy, ox, oy, dragging = false;
    s.win.addEventListener('pointerdown', e => {
      if (s.full || e.button !== 0) return;
      const bar = e.target.closest('.drag-strip, [data-drag]');
      if (!bar || e.target.closest('button, input, textarea, .seg, .menu-trigger')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = s.win.offsetLeft; oy = s.win.offsetTop;
      s.win.setPointerCapture(e.pointerId);
    });
    s.win.addEventListener('pointermove', e => {
      if (!dragging) return;
      const r = { x: ox + e.clientX - sx, y: Math.max(0, oy + e.clientY - sy), w: s.win.offsetWidth, h: s.win.offsetHeight };
      s.rect = r; setRect(s.win, r);
    });
    s.win.addEventListener('pointerup', () => { dragging = false; });
  }

  /* ---------------- menu bar ---------------- */
  function renderMenubar() {
    closeMenu();
    const s = wins.get(focused);
    const appMenus = s?.api.menus?.() || {};
    const name = s ? s.app.name : 'Finder';
    mb.replaceChildren();
    const add = (label, cls, items) => {
      const b = h(`<button class="mb ${cls || ''}">${label}</button>`);
      b.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        if (b.classList.contains('open')) return closeMenu();
        b.classList.add('open');
        showMenu(b, items(), { onClose: () => b.classList.remove('open') });
      });
      mb.append(b);
    };
    add('md<i>.</i>', 'logo', () => [
      { label: 'About md. desktop', action: () => import('./ui.js').then(m => m.toast('md. desktop · amber glass edition')) },
      'sep',
      { label: 'Show Desktop', kbd: 'F11', action: () => [...wins.keys()].forEach(minimize) },
      { label: 'Close All Apps', action: () => [...wins.keys()].forEach(close) },
    ]);
    add(name, 'appname', () => s ? [
      { label: `About ${s.app.name}`, action: () => import('./ui.js').then(m => m.toast(`${s.app.name} · md. edition`)) },
      'sep',
      { label: `Hide ${s.app.name}`, kbd: '⌘H', action: () => minimize(focused) },
      { label: `Quit ${s.app.name}`, kbd: '⌘Q', action: () => close(focused) },
    ] : apps.map(a => ({ label: `Open ${a.name}`, action: () => launch(a.id) })));
    Object.entries(appMenus).forEach(([label, items]) => add(label, '', () => items));
    add('Window', '', () => s ? [
      { label: 'Minimise', kbd: '⌘M', action: () => minimize(focused) },
      { label: s.full ? 'Exit Full Screen' : 'Enter Full Screen', kbd: '⌃⌘F', action: () => toggleFull(focused) },
      'sep',
      ...apps.map(a => ({ label: a.name, action: () => launch(a.id) })),
    ] : apps.map(a => ({ label: a.name, action: () => launch(a.id) })));
    const right = h(`<div class="right"><i data-lucide="wifi"></i><i data-lucide="battery-full"></i><span id="clock"></span></div>`);
    mb.append(right);
    icons(right);
    tick();
  }
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); };
  setInterval(tick, 15000);

  /* ---------------- keyboard: routed to the focused app (no animation on key actions) ---------------- */
  addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    // a keyboard-focused button handles its own Space/Enter; don't also fire the app shortcut (that double-toggled play/pause)
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, [role="button"]')) return;
    const s = wins.get(focused);
    if (e.key === 'F11') { e.preventDefault(); [...wins.keys()].forEach(minimize); return; }
    if (s && !s.minimized) s.api.onKey?.(e);
  });

  renderMenubar(); syncDock();
  return { launch };
}

/* Dock magnification: icons swell toward the cursor and push neighbours aside. Exponential ease, never overshoots. */
function magnify(dock) {
  const MAX = 0.45, RANGE = 140;
  let mx = null, raf = 0;
  const items = () => [...dock.querySelectorAll('.item')];
  const st = new Map();
  dock.addEventListener('pointermove', e => { mx = e.clientX; kick(); });
  dock.addEventListener('pointerleave', () => { mx = null; kick(); });
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  function tick() {
    raf = 0; let moving = false;
    const list = items();
    const centers = list.map(it => { const r = it.getBoundingClientRect(); return r.left + r.width / 2 - (+it.dataset.tx || 0); });
    list.forEach((it, i) => {
      const s = st.get(it) ?? 1;
      let target = 1;
      if (mx !== null) { const d = Math.abs(mx - centers[i]); target = 1 + MAX * Math.max(0, Math.cos(Math.min(d / RANGE, 1) * Math.PI / 2)); }
      const n = s + (target - s) * 0.22;
      st.set(it, Math.abs(target - n) < 0.001 ? target : n);
      if (Math.abs(target - n) >= 0.001) moving = true;
    });
    list.forEach((it, i) => {
      let tx = 0;
      list.forEach((o, j) => { if (j !== i) tx += Math.sign(i - j) * ((st.get(o) ?? 1) - 1) * o.offsetWidth / 2; });
      it.dataset.tx = tx;
      const sc = st.get(it);
      it.style.transform = sc === 1 && tx === 0 ? '' : `translateX(${tx}px) scale(${sc})`; // no transform at rest
    });
    if (moving) kick();
  }
}
