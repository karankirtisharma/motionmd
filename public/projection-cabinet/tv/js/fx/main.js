// The motion layer. cabinet.js still builds every page and owns all state and input. This module decides
// how a new render reaches the screen: it keeps the shell alive, morphs or replaces the content, drives the
// stage canvas (js/fx/stage.js) and plays the choreography (js/fx/motion.js).
// If this file never loads, or the visitor chooses Lite, cabinet.js renders exactly as it did before.

/* global app, proof, settings, routes, activeRoute, images, steps, films, selected, keyFor */
import { morph } from './morph.js';
import { Motion } from './motion.js';
import { Stage } from './stage.js';

const root = document.documentElement;
const prefersLess = matchMedia('(prefers-reduced-motion: reduce)');
// off: Lite or proof capture. reduced: glass and fades, no movement. full: everything.
const level = () => proof || settings.lite ? 'off' : settings.motion || prefersLess.matches ? 'reduced' : 'full';

let lastDown = { t: -1e9, x: 0, y: 0 }, lastKey = -1e9;
addEventListener('pointerdown', e => { lastDown = { t: performance.now(), x: e.clientX, y: e.clientY }; }, true);
addEventListener('keydown', () => { lastKey = performance.now(); }, true);

const FX = window.FX = {
  level: 'off', last: null, pending: null, stage: null, noGL: false,
  motion: new Motion(app),

  apply(next) {
    if (next === this.level) return;
    this.level = this.motion.level = next;
    root.classList.toggle('fx', next !== 'off');
    root.classList.toggle('fx-reduced', next === 'reduced');
    if (next === 'off') { this.motion.settle(true); this.dropStage(); }
    else if (this.stage) this.stage.reduced = next === 'reduced';
  },
  dropStage() {
    this.stage?.destroy();
    this.stage = null;
    root.classList.remove('fx-gl');
  },
  // The canvas mounts on first use and re-attaches if the shell was rebuilt.
  ensureStage() {
    const el = app.querySelector('.stage');
    if (!el || this.noGL) return;
    if (this.stage) { this.stage.attach(el); return; }
    const stage = new Stage(images);
    stage.reduced = this.level === 'reduced';
    stage.onLost = () => { this.noGL = true; this.dropStage(); };
    if (!stage.mount(el)) { this.noGL = true; return; }
    this.stage = stage;
    root.classList.add('fx-gl');
  },

  // Where the change came from: the pointer if it was just pressed, otherwise the focused control.
  origin() {
    const now = performance.now();
    if (now - lastDown.t < 700 && lastDown.t > lastKey) return { x: lastDown.x, y: lastDown.y };
    const el = document.activeElement;
    if (el && el !== document.body && app.contains(el) && el.id !== 'content') {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  },

  // Called by view() with the markup of the next render. Returns false to let cabinet.js render the old way.
  swap(r, html) {
    this.apply(level());
    const ui = app.querySelector('.ui');
    if (this.level === 'off' || !ui) return false;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const next = tpl.content.firstElementChild, bar = ui.querySelector(':scope > .bar'), sec = ui.querySelector(':scope > section:not(.fx-ghost)');
    const [nextBar, nextSec] = next.children;
    if (!bar || !sec || !nextBar || !nextSec) return false;

    const prev = this.last;
    // state: the same page with new content. step: the next step of the brief, which keeps its form in place.
    // route: any other page, so every page arrives the same way however it was reached.
    const mode = prev?.id === r.id ? 'state' : prev?.kind === r.kind && r.kind === 'brief' ? 'step' : 'route';
    const keyboard = lastKey > lastDown.t && performance.now() - lastKey < 700;
    this.motion.settle(mode === 'route');
    ui.className = next.className;
    ui.dataset.kind = r.kind;
    morph(bar, nextBar);
    const changes = { text: new Set(), src: [], add: [] }, ghosted = new Set();
    if (mode === 'route') {
      if (!keyboard) this.motion.ghost(ui, sec);
      sec.replaceWith(nextSec);
    } else {
      const quiet = keyboard || this.level !== 'full';
      morph(sec, nextSec, {
        text: el => {
          changes.text.add(el);
          const h = el?.closest('h1');
          if (h && !quiet && !ghosted.has(h)) { ghosted.add(h); this.motion.overlay(h, { y: -8, filter: 'blur(6px)', duration: .16 }); }
        },
        src: img => {
          changes.src.push(img);
          if (!quiet && !img.classList.contains('fx-plate')) this.motion.overlay(img);
        },
        add: node => changes.add.push(node)
      });
    }
    const dir = r.kind === 'brief' && prev ? Math.sign(steps.indexOf(r.item) - steps.indexOf(routes[prev.id]?.item)) : 0;
    this.pending = { mode, changes, keyboard, dir };
    return true;
  },

  // After every render, however it was produced.
  onView({ id, kind }) {
    const p = this.pending || { mode: this.last ? 'route' : 'first' };
    this.pending = null;
    this.last = { id, kind };
    const ui = app.querySelector('.ui');
    if (this.level === 'off' || !ui) return;
    const ctx = { mode: p.mode, kind, keyboard: !!p.keyboard, dir: p.dir, origin: this.origin() };
    this.ensureStage();
    if (ctx.mode === 'first') this.stage?.intro();
    this.stage?.sync(ui, ctx);
    // Fetch the pictures one click away, so a transition starts on the click instead of after a download.
    if (kind === 'home') this.stage?.preload(selected.map(f => images[f === films[3] ? 'coastal' : 'hero-' + f.industryId]));
    if (kind === 'film') this.stage?.preload(films.filter(f => f.formatId === routes[id].item.formatId).map(f => images[keyFor(f)]));
    this.motion.play(ui, ctx, p.changes);
    // Opening a film is the one arrival that is heard: a soft pass of air as the picture fills the stage.
    if (ctx.mode === 'route' && (kind === 'view' || kind === 'reel') && !ctx.keyboard) window.tickSound?.('whoosh');
    // Keep the glass following its elements for as long as the page is still arriving.
    this.stage?.wake(ctx.mode === 'state' ? 900 : 2200);
  },

  playhead(t, total, playing, reel) {
    if (!this.stage) return;
    this.stage.shot = { t, total, playing, reel };
    // The reel changes its picture without a render, so the stage has to look again when it does.
    const src = reel && app.querySelector('.playart img')?.src;
    if (src !== this.reelSrc) { this.reelSrc = src; this.stage.dirty = true; }
    this.stage.wake(400);
  },
  inspect() {
    this.motion.inspect();
    if (this.stage) { this.stage.dirty = true; this.stage.wake(400); }
  },
  // For captures and checks in a background tab, where the browser hands out no animation frames:
  // finish every tween where it stands (the animation clock itself is left alone), then let the
  // springs run out and draw.
  settle(seconds = 2) {
    for (let pass = 0; pass < 6; pass++) {
      const live = gsap.globalTimeline.getChildren(false, true, true).filter(a => a.progress() < 1 && a.repeat() !== -1);
      if (!live.length) break;
      for (const a of live) a.progress(1);
    }
    for (let i = 0; i < seconds * 30; i++) this.stage?.step(1 / 30);
    return 'settled';
  }
};

addEventListener('cabinet:view', e => FX.onView(e.detail));
prefersLess.addEventListener('change', () => {
  FX.apply(level());
  if (FX.level === 'off') return;
  FX.ensureStage();
  FX.stage?.sync(app.querySelector('.ui'), { mode: 'state' });
});

// cabinet.js has already rendered the first page by the time this module runs. Take it over once the
// display fonts are in, so split headings measure their final lines.
Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 900))]).then(() => {
  FX.apply(level());
  FX.last = null;
  const r = routes[activeRoute];
  if (r && app.querySelector('.ui')) FX.onView({ id: r.id, kind: r.kind });
}).finally(() => root.classList.remove('fx-boot'));
