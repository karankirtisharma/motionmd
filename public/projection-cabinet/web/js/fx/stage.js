// The stage: one WebGL canvas under the interface. It draws the cabinet ground, the projected artwork
// ("plates") and the liquid glass ("slabs"), each tied to a DOM element that keeps the layout, text and input.
// Passes run back to front: ground and backdrop plates, then glass that refracts them, then glass on that glass.
// The finished picture is kept, so while nothing changes a frame costs one copy and the dust.

import * as THREE from '../../vendor/three.module.min.js';
import { QUAD_VS, COPY_FS, GROUND_FS, PLATE_FS, GLASS_FS, DUST_VS, DUST_FS } from './shaders.js';

const gsap = window.gsap;
const lerp = (a, b, t) => a + (b - a) * t;
const mixRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
const near = (a, b, px) => Math.abs(a.x - b.x) < px && Math.abs(a.y - b.y) < px && Math.abs(a.w - b.w) < px && Math.abs(a.h - b.h) < px;
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
// A damped spring in small fixed steps, so it behaves the same at any frame rate.
function spring(value, velocity, target, dt, stiffness, damping) {
  const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
  for (let i = 0; i < steps; i++) { velocity += ((target - value) * stiffness - velocity * damping) * h; value += velocity * h; }
  return [value, velocity];
}

// Artwork the stage projects. `box` is the element whose rectangle the plate fills. Level 0 sits behind all
// glass, level 1 sits inside a glass card. The shade values repeat the gradients the stylesheet lays over the
// same picture, because DOM overlays would also cover the glass. `narrow` replaces them on a phone layout.
const OV = { fadeL: 0, shB: 0, shH: .4, shE: 1, shD: 0, opacity: 1, sat: 1, par: 0, zoom: 1 };
const PLATES = {
  hero: { sel: '.launchimage img', box: el => el.parentElement, level: 0, single: true, fadeL: .22, shB: .69, shH: .38, par: .008, zoom: 1.035, narrow: { fadeL: 0, shB: 1, shH: .6 } },
  play: { sel: '.playart img', box: el => el.parentElement, level: 0, single: true, shB: .96, shH: .6, shE: 1.6, shD: .66, par: .005, zoom: 1.03 },
  banner: { sel: '.watchbanner img', box: el => el.closest('.watchbanner'), level: 0, single: true, par: .006, zoom: 1.03 },
  back: { sel: '.backstrip img', box: el => el, level: 0, opacity: .36, sat: .8 },
  still: { sel: '.foliostill > img', box: el => el, level: 1, single: true, par: .004, zoom: 1.02 },
  thumb: { sel: '.launchdock .dockframe img', box: el => el.parentElement, level: 1 }
};

// Glass materials; the first whose selector matches an element claims it. Two kinds:
//   framed  glass seated in a frame: the panels, dock, player bar, search sheet and film frame. Their brass or
//           gold border stays exactly as designed. The glass fills the inside; its curved edge runs on under the
//           frame, so no second outline appears inside the border. Flat and clear, with a gentle crown.
//   free    the pieces that sit on the page or on a framed panel: tiles, dark buttons, chips, the active step,
//           the search field, caption pills. These are whole slabs of glass, as in zerowing's liquid-glass:
//           the glass edge is their outline (their hairline border steps aside), they cast a soft shadow, lean
//           toward the pointer and swell a little when pressed.
// Metal calls to action (.act), cream marble and paper surfaces are never in this list.
//   tint   colour of the glass and how strongly it shows (mixed in linear light)
//   frost  0 clear to 1 frosted
//   press  free glass only: how far it swells under a press; hover is 45% of that
//   depth, dome  multiples of the slab's natural thickness and crown
// A pane seated in a frame is close to flat: a strong crown would bend light from beyond the frame into a band.
const FRAMED = { single: true, framed: true, dome: .12 };
const GLASS = [
  { role: 'chipOn', sel: '.chip.on', tint: ['#c98a3e', .34], frost: .1, press: 1.04 },
  { role: 'stepOn', sel: '.step.active', tint: ['#c98a3e', .26], frost: .1, press: 1.02 },
  { role: 'button', sel: '.glassbtn, .tool, .chip', tint: ['#fff4e0', 0], frost: .03, press: 1.04 },
  { role: 'label', sel: '.artcaption', tint: ['#1a120c', .3], frost: .35, press: 1 },
  { role: 'field', sel: '.searchbar', tint: ['#fff4e0', 0], frost: .03, press: 1 },
  { role: 'tile', sel: '.tile', test: el => !el.closest('.marbletray'), tint: ['#fff4e0', 0], frost: .03, press: 1.02 },
  { role: 'dock', sel: '.launchdock', ...FRAMED, tint: ['#3b2d1e', .3], frost: .1 },
  { role: 'transport', sel: '.transport', ...FRAMED, tint: ['#211a15', .4], frost: .14 },
  { role: 'sheet', sel: '.searchsheet', ...FRAMED, tint: ['#1f1b18', .5], frost: .3 },
  { role: 'frame', sel: '.foliostill, .siblingrail', ...FRAMED, tint: ['#211a14', .24], frost: .12 },
  { role: 'panel', sel: '.collection, .processboard, .contactindex', ...FRAMED, test: (el, cs) => !el.matches('.collection') || parseFloat(cs.borderTopWidth) >= 1.5, tint: ['#26201b', .2], frost: .1 }
];

class Textures {
  constructor(renderer) {
    this.map = new Map();
    this.loader = new THREE.TextureLoader();
    this.aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }
  entry(url) {
    let e = this.map.get(url);
    if (!e) {
      e = { tex: null, w: 1, h: 1, ready: false, failed: false, waiters: [] };
      this.map.set(url, e);
      const done = () => e.waiters.splice(0).forEach(f => f(e));
      e.tex = this.loader.load(url, t => { e.w = t.image.width; e.h = t.image.height; e.ready = true; done(); }, undefined, () => { e.failed = true; done(); });
      e.tex.anisotropy = this.aniso;
    }
    return e;
  }
  when(url) {
    const e = this.entry(url);
    return e.ready || e.failed ? Promise.resolve(e) : new Promise(r => e.waiters.push(r));
  }
  dispose() {
    for (const e of this.map.values()) e.tex.dispose();
    this.map.clear();
  }
}

class Plate {
  constructor(stage, role, el) {
    this.s = stage; this.role = role; this.cfg = PLATES[role]; this.el = el; this.box = this.cfg.box(el) || el;
    this.ov = { ...OV, ...this.pick() };
    this.alpha = 1; this.mix = 0; this.flip = 1; this.from = null; this.dir = 1; this.hov = 0; this.gone = false;
    this.rect = stage.rel(this.box); this.drawn = this.rect;
    this.url = ''; this.token = 0; this.a = null; this.b = null; this.origin = [.6, .45]; this.pos = [.5, .5]; this.radius = 0; this.level = -1;
    const b = stage.blank, V2 = THREE.Vector2, V4 = THREE.Vector4;
    this.u = {
      uTexA: { value: b }, uTexB: { value: b }, uCropA: { value: new V4(1, 1, .5, .5) }, uCropB: { value: new V4(1, 1, .5, .5) },
      uHasA: { value: 0 }, uMix: { value: 0 }, uOrigin: { value: new V2(.5, .5) }, uSize: { value: new V2(1, 1) }, uRadius: { value: 0 },
      uDpr: { value: 1 }, uAlpha: { value: 0 }, uSat: { value: 1 }, uFadeL: { value: 0 }, uShadeB: { value: new THREE.Vector3(0, .4, 1) },
      uShadeD: { value: 0 }, uPar: { value: new V2() }, uZoom: { value: 1 }, uBlur: { value: 0 }, uSweep: { value: -1 }, uGrain: { value: 0 },
      uGain: { value: 1 }, uTime: { value: 0 }, uLiquid: { value: 1 }, uRaw: { value: 0 }
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: PLATE_FS, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(stage.quad, this.mat);
    this.mesh.frustumCulled = false;
    el.addEventListener('load', () => { stage.dirty = true; stage.wake(300); });
    this.read();
    this.setLevel(this.cfg.level);
  }
  pick() {
    const cfg = this.s.w <= 760 && this.cfg.narrow ? { ...this.cfg, ...this.cfg.narrow } : this.cfg, o = {};
    for (const k in OV) if (k in cfg) o[k] = cfg[k];
    return o;
  }
  read() {
    const cs = getComputedStyle(this.el), m = cs.objectPosition.match(/([\d.]+)%\s+([\d.]+)%/);
    this.pos = m ? [m[1] / 100, m[2] / 100] : [.5, .5];
    this.radius = parseFloat(getComputedStyle(this.box).borderTopLeftRadius) || parseFloat(getComputedStyle(this.box.parentElement).borderTopLeftRadius) || 0;
  }
  setLevel(level) {
    if (level !== this.level) { this.level = level; this.s.scenes[level].add(this.mesh); }
  }
  // The same artwork, or the same slot, continues in a new element: fly from the last drawn rectangle.
  adopt(role, el) {
    const s = this.s;
    this.from = { ...this.drawn }; this.flip = 0;
    this.role = role; this.cfg = PLATES[role]; this.el = el; this.box = this.cfg.box(el) || el;
    this.rect = s.rel(this.box); this.dir = this.rect.x + this.rect.w / 2 < this.from.x + this.from.w / 2 ? -1 : 1;
    el.addEventListener('load', () => { s.dirty = true; s.wake(300); });
    this.read(); this.setLevel(this.cfg.level);
    const d = s.reduced ? .2 : .8;
    gsap.to(this.ov, { ...OV, ...this.pick(), duration: d, ease: 'power2.out', overwrite: true });
    // A value set while an older tween on it still runs is overwritten by that tween on the next frame, so
    // every restart here kills the older tween first and states its start value.
    gsap.killTweensOf(this, 'flip');
    gsap.fromTo(this, { flip: 0 }, { flip: 1, duration: d, ease: s.reduced ? 'none' : 'drawer' });
    s.wake(d * 1000 + 300);
  }
  // Change the projected image. A change that lands mid-transition starts from a frozen copy of the blend.
  show(url, ctx = {}) {
    if (url === this.url) return;
    this.url = url;
    const token = ++this.token, s = this.s;
    s.tex.when(url).then(e => {
      if (token !== this.token || this.gone || !s.ok) return;
      if (e.failed) { this.failed = true; this.el.classList.remove('fx-plate'); return; }
      const mid = this.b && this.a && this.mix > 0 && this.mix < 1;
      this.a = mid ? s.snapshot(this) : this.b;
      this.b = e; this.mix = 0;
      const r = this.drawn;
      this.origin = ctx.origin && r.w ? [(ctx.origin.x - r.x) / r.w, 1 - (ctx.origin.y - r.y) / r.h] : [.6, .45];
      const liquid = this.cfg.single && !s.reduced;
      const d = !liquid ? .3 : ctx.keyboard ? .4 : !this.a ? (ctx.mode === 'first' ? 1.35 : .8) : .95;
      gsap.killTweensOf(this, 'mix');
      gsap.fromTo(this, { mix: 0 }, { mix: 1, duration: d, delay: !this.a && ctx.mode === 'first' ? .15 : 0, ease: liquid ? 'power2.out' : 'none', onComplete: () => { this.a = null; } });
      s.wake(d * 1000 + 500);
    });
  }
  exit() {
    this.gone = true;
    gsap.to(this, { alpha: 0, duration: .22, ease: 'power1.out', overwrite: true, onComplete: () => this.dispose() });
    this.s.wake(400);
  }
  crop(v, e, ar) {
    if (!e) return;
    const ai = e.w / e.h, wide = ar > ai;
    v.set(wide ? 1 : ar / ai, wide ? ai / ar : 1, e.snap ? .5 : this.pos[0], e.snap ? .5 : 1 - this.pos[1]);
  }
  update(t) {
    const s = this.s, u = this.u, o = this.ov;
    if (this.el.isConnected) { const m = s.rel(this.box); if (m.w > 0 && m.h > 0) this.rect = m; }
    const flying = this.flip < 1 && this.from;
    const d = this.drawn = flying ? mixRect(this.from, this.rect, this.flip) : this.rect;
    // In flight the plate dips back and turns a little, so the move reads as depth.
    const arc = flying && !s.reduced ? Math.sin(Math.PI * this.flip) : 0;
    this.mesh.position.set(d.x + d.w / 2, s.h - (d.y + d.h / 2), -arc * s.w * .05);
    this.mesh.rotation.set(-arc * .04, arc * .13 * this.dir, 0);
    this.mesh.scale.set(d.w, d.h, 1);
    u.uTexA.value = this.a ? this.a.tex : s.blank; u.uTexB.value = this.b ? this.b.tex : s.blank;
    u.uHasA.value = this.a ? 1 : 0; u.uMix.value = this.b ? this.mix : 0;
    const ar = d.w / Math.max(d.h, 1);
    this.crop(u.uCropA.value, this.a, ar); this.crop(u.uCropB.value, this.b, ar);
    u.uOrigin.value.set(this.origin[0], this.origin[1]);
    u.uSize.value.set(d.w, d.h); u.uRadius.value = this.radius; u.uDpr.value = s.k;
    u.uAlpha.value = this.alpha * o.opacity; u.uSat.value = o.sat; u.uFadeL.value = o.fadeL;
    u.uShadeB.value.set(o.shB, o.shH, o.shE); u.uShadeD.value = o.shD;
    // Under the pointer a picture comes a little closer and brighter.
    u.uPar.value.set(s.par[0] * o.par, s.par[1] * o.par); u.uZoom.value = o.zoom + (s.reduced ? 0 : this.hov * .06);
    u.uTime.value = t; u.uLiquid.value = this.cfg.single && !s.reduced ? 1 : 0;
    // The motion preview is a function of the playhead, so scrubbing shows the same frame every time.
    const sh = s.shot;
    if (this.role === 'play' && sh && !s.reduced) {
      const local = sh.reel ? sh.t % 4 : sh.t, k = local / (sh.reel ? 4 : sh.total), ez = .5 - .5 * Math.cos(Math.PI * k);
      const x = Math.min(1, local), pull = x < .15 ? x / .15 : 1 - (x - .15) / .85;
      u.uZoom.value = o.zoom + .1 * ez; u.uPar.value.x -= .012 * ez;
      u.uBlur.value = 3 * pull * pull;
      u.uSweep.value = local > .35 && local < 2.6 ? -.1 + (local - .35) / 2.25 * 1.3 : -1;
      u.uGrain.value = sh.playing ? 1 : .3;
      u.uGain.value = 1 - .1 * Math.sin(Math.PI * Math.min(1, local / 1.2));
    } else { u.uBlur.value = 0; u.uSweep.value = -1; u.uGrain.value = 0; u.uGain.value = 1 + this.hov * .14; }
  }
  dispose() {
    gsap.killTweensOf(this); gsap.killTweensOf(this.ov);
    this.mesh.removeFromParent(); this.mat.dispose();
    for (const rt of this.snaps || []) rt?.dispose();
    const i = this.s.plates.indexOf(this);
    if (i >= 0) this.s.plates.splice(i, 1);
  }
}

class Slab {
  constructor(stage, cfg, el) {
    this.s = stage; this.el = el; this.group = cfg.group ? cfg.group(el) : null;
    this.alpha = 0; this.grow = 0; this.flip = 1; this.from = null; this.gone = false; this.level = -1; this.radius = 0;
    this.scale = 1; this.scaleV = 0; this.glow = 0; this.glowV = 0; this.hovered = false; this.down = false;
    this.rect = stage.rel(el); this.drawn = this.rect;
    this.m = {};
    const V4 = THREE.Vector4;
    this.u = {
      uBack: { value: stage.blank }, uRes: { value: stage.buf }, uStage: { value: stage.size }, uDpr: { value: 1 },
      uRect: { value: new V4() }, uLook: { value: new V4() }, uTint: { value: new V4() }, uProfile: { value: new V4() }, uExtra: { value: new V4() },
      uLight: { value: stage.lamp }, uPointer: { value: stage.finger }, uClip: { value: new THREE.Vector3() }, uEnv: { value: 1 }
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: GLASS_FS, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(stage.quad, this.mat);
    this.mesh.frustumCulled = false;
    this.material(cfg, true);
  }
  // The element changed state (an option chosen, a step made active): the glass changes colour, it is not replaced.
  material(cfg, instant) {
    if (cfg === this.cfg) return;
    this.cfg = cfg;
    const [r, g, b] = rgb(cfg.tint[0]), to = { r, g, b, a: cfg.tint[1], frost: cfg.frost || 0, inner: cfg.inner || 0 };
    if (instant) Object.assign(this.m, to);
    else { gsap.to(this.m, { ...to, duration: .28, ease: 'power2.out', overwrite: true }); this.s.wake(500); }
  }
  setLevel(level) {
    if (level !== this.level) { this.level = level; this.s.scenes[level].add(this.mesh); }
  }
  // Glass arrives by filling out: flat and clear at first, then its full depth.
  enter(ctx, i) {
    const s = this.s, quick = s.reduced || ctx.keyboard;
    gsap.fromTo(this, { alpha: 0, grow: quick ? 1 : .15 }, { alpha: 1, grow: 1, duration: quick ? .18 : .6, delay: quick ? 0 : (ctx.mode === 'first' ? .4 : .04) + Math.min(i, 8) * .03, ease: 'power3.out' });
    s.wake(1400);
  }
  // Hand over to another element: slide there, stretching on the way like a drop under tension.
  adopt(el, quiet, ctx = {}) {
    if (!quiet) {
      const s = this.s;
      this.from = { ...this.drawn }; this.flip = 0;
      gsap.killTweensOf(this, 'flip,alpha,grow');
      gsap.fromTo(this, { flip: 0 }, { flip: 1, alpha: 1, grow: 1, duration: s.reduced ? .01 : ctx.keyboard ? .16 : .55, ease: 'drawer' });
      s.wake(900);
    }
    this.el = el;
  }
  exit() {
    this.gone = true;
    gsap.to(this, { alpha: 0, grow: .3, duration: .16, ease: 'power1.out', overwrite: true, onComplete: () => this.dispose() });
    this.s.wake(400);
  }
  update(dt) {
    const s = this.s, cfg = this.cfg, u = this.u, m = this.m;
    if (this.el.isConnected) { const r = s.rel(this.el); if (r.w > 0 && r.h > 0) this.rect = r; }
    // Framed glass fills the padding box; free glass is the whole element.
    const framed = !!cfg.framed, [bt, br, bb, bl] = framed && this.inset || [0, 0, 0, 0];
    let d = { x: this.rect.x + bl, y: this.rect.y + bt, w: Math.max(1, this.rect.w - bl - br), h: Math.max(1, this.rect.h - bt - bb) };
    if (this.flip < 1 && this.from) {
      d = mixRect(this.from, d, this.flip);
      if (this.group && !s.reduced) {
        const st = Math.sin(Math.PI * this.flip), w = d.w * (1 + .3 * st), h = d.h * (1 - .07 * st);
        d = { x: d.x + (d.w - w) / 2, y: d.y + (d.h - h) / 2, w, h };
      }
    }
    this.drawn = d;
    // Free glass swells a little under a press and overshoots as it settles; hover is a lighter press. Framed
    // glass stays inside its frame. Either kind lights up under the pointer.
    const press = framed ? 1 : cfg.press || 1, rest = this.down ? press : this.hovered ? 1 + (press - 1) * .45 : 1, lit = this.down ? 1 : this.hovered ? .35 : 0;
    if (s.reduced) { this.scale = 1; this.glow = lit; this.scaleV = this.glowV = 0; }
    else {
      [this.scale, this.scaleV] = spring(this.scale, this.scaleV, rest, dt, 520, 14);
      [this.glow, this.glowV] = spring(this.glow, this.glowV, lit, dt, 260, 22);
      if (Math.abs(this.scaleV) + Math.abs(this.glowV) > .002) s.wake(160);
    }
    const hw = d.w / 2 * this.scale, hh = d.h / 2 * this.scale, half = Math.min(hw, hh), cx = d.x + d.w / 2, cy = s.h - (d.y + d.h / 2);
    // Thickness follows the size of the slab, with a floor so small buttons still read as solid glass.
    // Free glass is cut thicker than the library default, so its edge visibly bends the grain behind it.
    const depth = Math.min(60, Math.max(half * .36, Math.min(half * .7, 14)) * (cfg.depth || (framed ? 1 : 1.45))) * this.grow;
    const rounding = Math.min(depth * .73, half * .9), r = Math.min(this.radius, half);
    u.uDpr.value = s.k;
    if (framed) {
      // The solid runs on past the visible pane by its rounded edge, which the frame covers.
      const e = rounding + 4;
      u.uRect.value.set(cx, cy, hw + e, hh + e);
      u.uLook.value.set(r + e, m.frost, cfg.chroma ?? .008, 0);
      u.uClip.value.set(hw, hh, r);
      u.uEnv.value = .3;
    } else {
      u.uRect.value.set(cx, cy, hw, hh);
      u.uLook.value.set(r, m.frost, cfg.chroma ?? .008, Math.min(6, half * .25) * s.touch);
      u.uClip.value.set(0, 0, 0);
      u.uEnv.value = 1;
    }
    u.uProfile.value.set(depth, rounding, depth * .48 * (cfg.dome ?? 1), cfg.ior || (framed ? 1.38 : 1.48));
    u.uTint.value.set(m.r, m.g, m.b, m.a);
    u.uExtra.value.set(framed ? 0 : 1, this.glow, this.alpha, m.inner);
    this.mesh.position.set(cx, cy, 0);
    this.mesh.scale.set(hw * 2 + (framed ? 8 : 112), hh * 2 + (framed ? 8 : 112), 1);
  }
  dispose() {
    gsap.killTweensOf(this); gsap.killTweensOf(this.m);
    this.mesh.removeFromParent(); this.mat.dispose();
    const i = this.s.slabs.indexOf(this);
    if (i >= 0) this.s.slabs.splice(i, 1);
  }
}

export class Stage {
  constructor(images) {
    this.images = images;
    this.plates = []; this.slabs = []; this.slabOf = new WeakMap(); this.plateOf = new WeakMap(); this.hot = new Set(); this.held = new Set();
    this.ptr = { x: .3, y: -.2, vx: 0, vy: 0, tx: .5, ty: .5, on: 0, at: -1e9, inside: false };
    this.lampS = { x: 0, y: 0, vx: 0, vy: 0 }; this.fingerS = { x: 0, y: 0, vx: 0, vy: 0 }; this.touch = 0;
    this.light = [0, 0]; this.par = [0, 0];
    this.theme = { w: 1, p: 0, i: 0 }; this.themeKey = '1,0,0'; this.warm = 1; this.dust = 1; this.barH = 0;
    this.reduced = false; this.dirty = false; this.busy = 0; this.shot = null; this.ok = false;
    this.w = 1; this.h = 1; this.k = 1; this.maxDpr = 1.5; this.slow = 0; this.t0 = performance.now(); this.last = 0;
    this.tick = this.tick.bind(this);
  }

  mount(el) {
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-fx-keep', '');
    let r;
    try { r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }); }
    catch { return false; }
    this.canvas = canvas; this.r = r;
    r.autoClear = false;
    r.setClearColor(0x140f0d, 1);
    this.tex = new Textures(r);
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.cam = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    this.buf = new THREE.Vector2(1, 1); this.size = new THREE.Vector2(1, 1);
    this.lamp = new THREE.Vector2(); this.finger = new THREE.Vector2();
    // Four layers: the ground and backdrop artwork, then up to three depths of glass.
    this.scenes = [0, 1, 2, 3].map(() => new THREE.Scene());
    const rt = mips => new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, generateMipmaps: mips, minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rts = [rt(true), rt(true), rt(true)];
    this.final = rt(false);
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;

    const flat = (fs, uniforms) => {
      const m = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false }));
      m.frustumCulled = false;
      return m;
    };
    const images = this.images, grain = this.tex.entry(images.walnut), paper = this.tex.entry(images['ivory-calcite']);
    grain.tex.wrapS = THREE.RepeatWrapping;
    this.groundU = {
      uGrain: { value: grain.tex }, uPaper: { value: paper.tex }, uRes: { value: this.buf }, uPaperSize: { value: new THREE.Vector2(1, 1) },
      uTheme: { value: new THREE.Vector3(1, 0, 0) }, uLight: { value: new THREE.Vector3() }, uWarm: { value: 1 }, uBar: { value: 0 }, uTime: { value: 0 }
    };
    this.tex.when(images.walnut).then(() => this.wake(300));
    this.tex.when(images['ivory-calcite']).then(e => { this.groundU.uPaperSize.value.set(e.w, e.h); this.wake(300); });
    this.full = [flat(GROUND_FS, this.groundU)];
    this.scenes[0].add(this.full[0]);
    const copy = () => { const m = flat(COPY_FS, { uTex: { value: this.blank }, uRes: { value: this.buf } }); this.full.push(m); return m; };
    for (const sc of this.scenes.slice(1)) { sc.userData.copy = copy(); sc.add(sc.userData.copy); }
    this.screen = new THREE.Scene();
    this.screen.add(copy());
    this.screen.children[0].material.uniforms.uTex.value = this.final.texture;

    const N = 70, seed = new Float32Array(N * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geo = this.dustGeo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustU = { uStage: { value: this.size }, uPar: { value: new THREE.Vector2() }, uTime: { value: 0 }, uDpr: { value: 1 }, uAlpha: { value: 1 } };
    const motes = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, uniforms: this.dustU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false;
    this.dustScene = new THREE.Scene();
    this.dustScene.add(motes);

    this.snapScene = new THREE.Scene();
    this.snapCam = new THREE.OrthographicCamera(-.5, .5, .5, -.5, -1, 1);
    this.snapMesh = new THREE.Mesh(this.quad);
    this.snapScene.add(this.snapMesh);

    this.ro = new ResizeObserver(() => this.resize());
    this.io = new IntersectionObserver(es => { this.offscreen = !es[es.length - 1].isIntersecting; });
    this.mo = new MutationObserver(() => { this.dirty = true; this.wake(300); });
    // Every slab on, or inside, the link or button under the pointer answers it: a tile, a dock card, a
    // switch's thumb and track. Glass that is not a control (a panel, a tray) stays still.
    const slabsFor = target => {
      const hit = target?.closest?.('a, button'), out = new Set();
      if (!hit || !this.el.contains(hit)) return out;
      for (const n of [hit, ...hit.querySelectorAll('.fx-glass')]) {
        const s = n.classList.contains('fx-glass') && this.slabOf.get(n);
        if (s && !s.gone) out.add(s);
      }
      return out;
    };
    const setHot = next => {
      for (const s of this.hot) if (!next.has(s)) s.hovered = false;
      for (const s of next) s.hovered = true;
      this.hot = next;
      this.wake(900);
    };
    const release = () => {
      for (const s of this.held) s.down = false;
      this.held = new Set();
      this.wake(900);
    };
    // Dock cards are buttons in the DOM; their pictures are plates here, so the stage answers their hover.
    const cardAt = e => { const n = e.target.closest?.('.dockframe'); return n && this.plateOf.get(n); };
    this.on = [
      [window, 'pointermove', e => {
        const sr = this.sr, p = this.ptr;
        if (!sr) return;
        p.tx = (e.clientX - sr.left) / sr.width; p.ty = (e.clientY - sr.top) / sr.height;
        p.inside = p.tx >= 0 && p.tx <= 1 && p.ty >= 0 && p.ty <= 1;
        p.at = performance.now(); this.wake(1600);
      }],
      [document, 'pointerover', e => {
        if (e.pointerType !== 'mouse') return;
        const p = cardAt(e);
        setHot(slabsFor(e.target));
        if (p && !p.hovered) { p.hovered = true; gsap.to(p, { hov: 1, duration: .35, ease: 'power3.out', overwrite: 'auto' }); this.wake(700); }
      }],
      [document, 'pointerout', e => {
        const p = cardAt(e);
        if (!e.relatedTarget) setHot(new Set());   // the pointer left the window
        if (p && p.hovered && !p.box.contains(e.relatedTarget)) { p.hovered = false; gsap.to(p, { hov: 0, duration: .5, ease: 'power3.out', overwrite: 'auto' }); this.wake(900); }
      }],
      [document, 'pointerdown', e => {
        release();
        this.held = slabsFor(e.target);
        for (const s of this.held) s.down = true;
        this.wake(900);
      }],
      [window, 'pointerup', release],
      [window, 'pointercancel', release]
    ];
    for (const [node, type, fn] of this.on) node.addEventListener(type, fn, { passive: true });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.onLost?.(); });

    this.ok = true;
    this.attach(el);
    gsap.ticker.add(this.tick);
    return true;
  }

  attach(el) {
    if (this.el === el || !el) return;
    this.ro.disconnect(); this.io.disconnect(); this.mo.disconnect();
    this.el = el;
    el.prepend(this.canvas);
    this.ro.observe(el); this.io.observe(el);
    this.mo.observe(el, { childList: true, subtree: true });
    this.resize();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr, 4096 / Math.max(w, h)));
    this.r.setSize(w, h, false);
    this.r.getDrawingBufferSize(this.buf);
    this.w = w; this.h = h; this.k = this.buf.x / w;
    this.size.set(w, h);
    for (const rt of [...this.rts, this.final]) rt.setSize(this.buf.x, this.buf.y);
    // The camera sees z = 0 at one unit per css px, so plates and glass land exactly on their elements.
    const dist = Math.max(w, h) * 1.2, c = this.cam;
    c.fov = 2 * Math.atan(h / 2 / dist) * 180 / Math.PI; c.aspect = w / h; c.near = dist * .2; c.far = dist * 3;
    c.position.set(w / 2, h / 2, dist); c.lookAt(w / 2, h / 2, 0); c.updateProjectionMatrix();
    for (const m of this.full) { m.position.set(w / 2, h / 2, 0); m.scale.set(w + 2, h + 2, 1); }
    for (const p of this.plates) Object.assign(p.ov, OV, p.pick());
    this.lampS.x = w * .18; this.lampS.y = -h * .25;
    this.dirty = true;
    this.wake(500);
  }

  // Something is changing: keep drawing the glass for this long.
  wake(ms) { this.busy = Math.max(this.busy, performance.now() + ms); }
  rel(el) {
    const r = el.getBoundingClientRect(), s = this.sr;
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  }
  // Glass can only show where nothing opaque sits between its element and the canvas.
  occluded(el, ui) {
    for (let a = el.parentElement; a && a !== ui; a = a.parentElement) {
      if (a.classList.contains('fx-glass')) continue;
      const cs = getComputedStyle(a), c = cs.backgroundColor.match(/[\d.]+/g);
      if (cs.backgroundImage !== 'none' || (c && (c.length < 4 ? 1 : +c[3]) > .04)) return true;
      if (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) return true;
    }
    return false;
  }

  // Match stage actors to the current DOM: keep, hand over, create or retire.
  sync(ui, ctx = {}) {
    if (!this.ok || !ui?.isConnected) return;
    const sec = ui.querySelector(':scope > section:not(.fx-ghost)'), bar = ui.querySelector(':scope > .bar');
    if (!sec) return;
    this.ui = ui; this.dirty = false;
    this.sr = this.el.getBoundingClientRect();
    this.barH = bar ? bar.offsetHeight : 0;
    if (ctx.origin) ctx = { ...ctx, origin: { x: ctx.origin.x - this.sr.left, y: ctx.origin.y - this.sr.top } };

    const kind = ui.dataset.kind, th = kind === 'brief' ? [0, 1, 0] : kind === 'view' || kind === 'reel' ? [0, 0, 1] : [1, 0, 0];
    if (th.join() !== this.themeKey) {
      this.themeKey = th.join();
      gsap.to(this.theme, { w: th[0], p: th[1], i: th[2], duration: this.reduced ? .2 : .6, ease: 'power2.out', overwrite: true });
      gsap.to(this, { dust: th[1] ? 0 : 1, duration: .6, overwrite: 'auto' });
      this.wake(900);
    }

    const take = (list, fn) => { const i = list.findIndex(fn); return i < 0 ? null : list.splice(i, 1)[0]; };
    const want = [];
    for (const role in PLATES) for (const el of sec.querySelectorAll(PLATES[role].sel)) {
      // currentSrc lags a src change until the browser has fetched it, so only a <picture> needs it.
      const url = el.closest('picture') ? el.currentSrc || el.src : el.src;
      if (url) want.push({ role, el, url });
    }
    const free = this.plates.filter(p => !p.gone);
    for (const w of want) w.p = take(free, p => p.el === w.el);
    for (const w of want) if (!w.p) w.p = take(free, p => !p.el.isConnected && p.url === w.url);
    for (const w of want) if (!w.p && PLATES[w.role].single) w.p = take(free, p => !p.el.isConnected && p.role === w.role);
    for (const w of want) {
      let p = w.p;
      if (!p) { p = new Plate(this, w.role, w.el); this.plates.push(p); }
      else if (p.el !== w.el) p.adopt(w.role, w.el);
      if (!p.failed) w.el.classList.add('fx-plate');
      p.show(w.url, ctx);
      this.plateOf.set(p.box, p);
    }
    for (const p of free) p.exit();

    // The header and the page, in document order so a card is decided before the glass that sits on it.
    const found = [], claimed = new Set();
    for (const cfg of GLASS) for (const root of [bar, sec]) {
      if (!root) continue;
      for (const el of [...(root.matches(cfg.sel) ? [root] : []), ...root.querySelectorAll(cfg.sel)]) {
        if (!claimed.has(el)) { claimed.add(el); found.push({ cfg, el }); }
      }
    }
    found.sort((a, b) => a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1);
    for (const w of found) {
      const cs = getComputedStyle(w.el), r = this.rel(w.el);
      w.ok = cs.display !== 'none' && r.w > 1 && r.h > 1 && (!w.cfg.test || w.cfg.test(w.el, cs)) && !this.occluded(w.el, ui);
      w.inset = ['Top', 'Right', 'Bottom', 'Left'].map(k => parseFloat(cs['border' + k + 'Width']) || 0);
      w.el.classList.toggle('fx-glass', w.ok);
      w.el.classList.toggle('fx-free', w.ok && !w.cfg.framed);
      if (!w.ok) continue;
      // css/glass.css redraws a brass rim at this width once the dark fill is gone.
      if (w.cfg.framed) w.el.style.setProperty('--fx-bw', cs.borderTopWidth);
      // A computed radius can be px or %; cap it at a full pill, as CSS does. Framed glass takes the inner radius.
      const first = cs.borderTopLeftRadius.split(' ')[0], short = Math.min(r.w, r.h);
      const outer = Math.min(first.endsWith('%') ? parseFloat(first) / 100 * short : parseFloat(first) || 0, short / 2);
      w.radius = w.cfg.framed ? Math.max(0, outer - Math.max(w.inset[0], w.inset[3])) : outer;
      w.rect = r; w.level = 1;
      for (let a = w.el.parentElement; a && a !== ui; a = a.parentElement) if (a.classList.contains('fx-glass')) w.level++;
      w.level = Math.min(w.level, 3);
      w.group = w.cfg.group ? w.cfg.group(w.el) : null;
    }
    const live = found.filter(w => w.ok), spare = this.slabs.filter(s => !s.gone);
    // An element that stopped being glass (a card no longer selected) gets its own styling back.
    for (const el of ui.querySelectorAll('.fx-glass')) if (!claimed.has(el) && !el.closest('.fx-ghost')) el.classList.remove('fx-glass', 'fx-free');
    for (const w of live) w.s = take(spare, s => s.el === w.el);
    for (const w of live) if (!w.s && w.group) { w.s = take(spare, s => s.group === w.group && s.cfg.role === w.cfg.role); w.glide = !!w.s; }
    for (const w of live) if (!w.s) { w.s = take(spare, s => !s.el.isConnected && s.cfg === w.cfg && near(s.rect, w.rect, 6)); w.quiet = !!w.s; }
    for (const w of live) if (!w.s && w.cfg.single) w.s = take(spare, s => !s.el.isConnected && s.cfg.role === w.cfg.role);
    let fresh = 0;
    for (const w of live) {
      let s = w.s;
      if (!s) { s = new Slab(this, w.cfg, w.el); this.slabs.push(s); s.enter(ctx, fresh++); }
      else if (s.el !== w.el) s.adopt(w.el, w.quiet, ctx);
      s.material(w.cfg); s.radius = w.radius; s.inset = w.inset; s.group = w.group; s.setLevel(w.level);
      this.slabOf.set(w.el, s);
    }
    for (const s of spare) s.exit();

    // Paint in document order: a card before the picture inside it, a track before its thumb.
    const actors = [...this.plates, ...this.slabs].filter(a => a.el.isConnected);
    actors.sort((a, b) => a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1);
    actors.forEach((a, i) => { a.mesh.renderOrder = 10 + i; });
    this.wake(700);
  }

  // Freeze a plate's current blend into a texture.
  snapshot(p) {
    const w = Math.max(2, Math.round(p.drawn.w * this.k)), h = Math.max(2, Math.round(p.drawn.h * this.k));
    p.snaps = p.snaps || [];
    const ix = p.snapIx = p.snapIx ? 0 : 1;
    const rt = p.snaps[ix] || (p.snaps[ix] = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }));
    rt.setSize(w, h);
    p.u.uRaw.value = 1;
    this.snapMesh.material = p.mat;
    this.r.setRenderTarget(rt); this.r.clear(); this.r.render(this.snapScene, this.snapCam); this.r.setRenderTarget(null);
    p.u.uRaw.value = 0;
    return { tex: rt.texture, w, h, snap: true };
  }

  intro() {
    if (this.reduced) return;
    this.warm = 0;
    gsap.killTweensOf(this, 'warm');
    gsap.fromTo(this, { warm: 0 }, { warm: 1, duration: 1.3, ease: 'power2.out' });
    this.wake(1800);
  }

  // Start loading pictures the visitor is likely to open next.
  preload(urls) {
    for (const url of urls) if (url) this.tex.entry(url);
  }

  // One frame by hand, whatever the browser's frame clock is doing. Used by FX.settle().
  step(dt) {
    if (!this.ok) return;
    if (this.el.clientWidth !== this.w || this.el.clientHeight !== this.h) this.resize();
    if (this.dirty && this.ui) this.sync(this.ui, { mode: 'state' });
    const t = (performance.now() - this.t0) / 1000;
    this.update(dt, t);
    this.render(true, t);
  }

  tick() {
    if (!this.ok || document.hidden || this.offscreen) return;
    const now = performance.now(), active = now < this.busy, gap = now - this.last;
    if (!active && gap < 32) return;   // only the dust is moving: half rate is enough
    const dt = Math.min(1 / 15, gap / 1000);
    this.last = now;
    if (active) {   // step the resolution down once frames run long; a throttled tab (long gaps) does not count
      this.slow = gap > 28 && gap < 120 ? this.slow + 1 : Math.max(0, this.slow - 1);
      if (this.slow > 50 && this.maxDpr > 1) { this.maxDpr = Math.max(1, this.maxDpr - .25); this.slow = 0; this.resize(); }
      if (this.dirty && this.ui) this.sync(this.ui, { mode: 'state' });
      this.update(dt, (now - this.t0) / 1000);
    }
    this.render(active, (now - this.t0) / 1000);
  }

  update(dt, t) {
    this.sr = this.el.getBoundingClientRect();
    const p = this.ptr, k = this.k, now = performance.now(), live = !this.reduced && p.inside && now - p.at < 2500;
    p.on += ((live ? 1 : 0) - p.on) * Math.min(1, dt * 3);
    // The ground light follows the pointer on a damped spring and rests above the title.
    const gx = lerp(.28, p.tx, p.on), gy = lerp(-.25, p.ty, p.on);
    p.vx += ((gx - p.x) * 90 - p.vx * 16) * dt; p.vy += ((gy - p.y) * 90 - p.vy * 16) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    this.light = [p.x * this.w * k, (1 - p.y) * this.h * k];
    this.par = [(p.x - .5) * p.on, -(p.y - .5) * p.on];
    // The glass lamp drifts toward the pointer and rests above the top-left when it leaves;
    // the liquid edge follows a softer, lagging copy of the pointer.
    const L = this.lampS, F = this.fingerS, px = p.tx * this.w, py = p.ty * this.h;
    [L.x, L.vx] = spring(L.x, L.vx, live ? px - 100 : this.w * .18, dt, 330, 24);
    [L.y, L.vy] = spring(L.y, L.vy, live ? py - 160 : -this.h * .25, dt, 330, 24);
    if (live) { [F.x, F.vx] = spring(F.x, F.vx, px, dt, 140, 9); [F.y, F.vy] = spring(F.y, F.vy, py, dt, 140, 9); }
    this.touch += ((live ? 1 : 0) - this.touch) * Math.min(1, dt * 6);
    this.lamp.set(L.x, this.h - L.y); this.finger.set(F.x, this.h - F.y);
    if (Math.abs(L.vx) + Math.abs(L.vy) + Math.abs(F.vx) + Math.abs(F.vy) + Math.abs(p.vx) * 400 > .5 || (this.touch > .01 && this.touch < .99)) this.wake(160);
    const g = this.groundU;
    g.uTheme.value.set(this.theme.w, this.theme.p, this.theme.i);
    g.uLight.value.set(this.light[0], this.light[1], this.reduced ? .5 : .55 + .45 * p.on);
    g.uWarm.value = this.warm; g.uTime.value = t; g.uBar.value = this.barH * k;
    for (const a of this.plates) a.update(t);
    for (const a of this.slabs) a.update(dt);
  }

  render(active, t) {
    const r = this.r;
    if (active) {
      const chain = this.scenes.filter((sc, i) => !i || sc.children.length > 1);
      chain.forEach((sc, i) => {
        if (i) {
          const src = this.rts[i - 1].texture;
          sc.userData.copy.material.uniforms.uTex.value = src;
          for (const m of sc.children) if (m.material.uniforms.uBack) m.material.uniforms.uBack.value = src;
        }
        r.setRenderTarget(i < chain.length - 1 ? this.rts[i] : this.final);
        r.clear();
        r.render(sc, this.cam);
      });
    }
    const d = this.dustU;
    d.uPar.value.set(this.par[0] * .012, this.par[1] * .012);
    d.uTime.value = t; d.uDpr.value = this.k; d.uAlpha.value = this.reduced ? 0 : this.dust * this.warm;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.screen, this.cam);
    r.render(this.dustScene, this.cam);
  }

  destroy() {
    this.ok = false;
    gsap.ticker.remove(this.tick);
    for (const [node, type, fn] of this.on) node.removeEventListener(type, fn);
    this.ro.disconnect(); this.io.disconnect(); this.mo.disconnect();
    for (const a of [...this.plates, ...this.slabs]) a.dispose();
    gsap.killTweensOf(this); gsap.killTweensOf(this.theme);
    this.tex.dispose(); this.blank.dispose();
    for (const rt of [...this.rts, this.final]) rt.dispose();
    for (const m of this.full) m.material.dispose();
    this.dustScene.children[0].material.dispose(); this.dustGeo.dispose(); this.quad.dispose();
    this.r.dispose();
    this.canvas.remove();
    for (const el of document.querySelectorAll('.fx-glass, .fx-plate')) el.classList.remove('fx-glass', 'fx-free', 'fx-plate');
  }
}
