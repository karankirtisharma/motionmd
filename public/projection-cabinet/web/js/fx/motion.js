// Interface motion, owned by GSAP. One rule set decides every tween here:
//   - things enter quickly on a strong ease-out, and leave faster than they arrive
//   - nothing grows from nothing: surfaces start a few pixels low and transparent, never at scale 0
//   - staggers stay at 30-45 ms and are capped so a full grid still lands in about a third of a second
//   - a change made from the keyboard skips decorative motion; reduced motion keeps fades and drops movement
//   - text comes into focus (blur to sharp) the way a projector lens finds its image

const gsap = window.gsap;

const KICKERS = '.crumb, .tagline, .eyebrow, .smallcap, .samplehead, .sectionbar > p';
const COPY = '.desc, .bodytext, .launchtitle > p, .facts, .pills, .lineprogress, .cuecaption';
const SURFACES = '.collection, .processboard, .matrixwrap, .matrixbase, .searchsheet, .controlconsole, .formbody, .briefplate, .foliostill, .siblingrail, .studyimg, .frameTabs, .stripmount, .launchdock, .transport, .filmvisual, .marbletray, .playtop > .glassbtn';
const ITEMS = '.tile, .resultstrip > a, .dockframe, .choice, .step, .reviewlist > div, .field, .siblingrail > a, .shotstrip > .chip';
const STILLS = '.tilepic img, .filmvisual img, .studyimg > img, .processboard img';
// Blocks whose text may change in place and should refocus when it does.
const BLOCKS = 'h1, h2, .desc, .bodytext, .facts dd, .tagline, .eyebrow, .smallcap, .samplehead, .crumb, .launchtitle > p, .tileinfo, .briefplate p, .reviewlist dd';
const CLEAR = 'opacity,transform,filter';

export class Motion {
  constructor(app) {
    this.app = app; this.level = 'full'; this.running = new Set(); this.titles = new Set();
    gsap.registerPlugin(window.CustomEase, window.SplitText);
    window.CustomEase.create('out', '0.23,1,0.32,1');
    window.CustomEase.create('inOut', '0.77,0,0.175,1');
    window.CustomEase.create('drawer', '0.32,0.72,0,1');
    this.hover();
    // Layout-bound decorations follow a resize without animating.
    addEventListener('resize', () => {
      const ui = this.app.querySelector('.ui'), sec = ui?.querySelector(':scope > section:not(.fx-ghost)');
      if (!sec || this.level === 'off') return;
      this.nav(ui, true); this.segments(sec); this.lens(sec, { instant: true });
    });
  }
  get reduced() { return this.level === 'reduced'; }

  timeline(set, delay = 0) {
    const tl = gsap.timeline({ defaults: { ease: 'out', duration: .5 }, delay });
    tl.fx = { splits: [], done: [] };
    set.add(tl);
    tl.eventCallback('onComplete', () => this.finish(tl, set));
    return tl;
  }
  finish(tl, set) {
    if (!set.delete(tl)) return;
    for (const s of tl.fx.splits) s.revert();
    for (const f of tl.fx.done) f();
  }
  // Called before the DOM changes. Split headings must be whole again before their text is replaced.
  settle(everything) {
    for (const set of everything ? [this.titles, this.running] : [this.titles]) {
      for (const tl of [...set]) { tl.progress(1); tl.kill(); this.finish(tl, set); }
    }
  }

  // A heading focuses line by line; the featured title on home, letter by letter.
  title(h, hero, at = 0, fast = false) {
    const tl = this.timeline(this.titles, at);
    const split = window.SplitText.create(h, hero ? { type: 'words,chars' } : { type: 'lines' });
    tl.fx.splits.push(split);
    tl.from(hero ? split.chars : split.lines, {
      opacity: 0, yPercent: hero ? 38 : 26, filter: 'blur(' + (hero ? 12 : 9) + 'px)',
      duration: fast ? .45 : hero ? .7 : .6, stagger: hero ? (fast ? .022 : .035) : .07
    }, 0);
  }

  // The outgoing page stays for a moment as a copy that fades, so the new page can start arriving at once.
  ghost(ui, sec) {
    if (this.reduced || sec.querySelector('video')) return;
    const g = sec.cloneNode(true);
    g.classList.add('fx-ghost');
    g.setAttribute('data-fx-keep', '');
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
    Object.assign(g.style, { position: 'absolute', left: sec.offsetLeft + 'px', top: sec.offsetTop + 'px', width: sec.offsetWidth + 'px', height: sec.offsetHeight + 'px', margin: 0 });
    ui.appendChild(g);
    gsap.to(g, { opacity: 0, duration: .18, ease: 'power1.out', onComplete: () => g.remove() });
  }
  // A still copy of an element, laid exactly over it, that fades away while the new content settles underneath.
  overlay(el, vars) {
    if (this.level !== 'full' || !el.offsetParent) return;
    const g = el.cloneNode(true), cs = getComputedStyle(el);
    g.setAttribute('data-fx-keep', '');
    g.setAttribute('aria-hidden', 'true');
    g.removeAttribute('id');
    Object.assign(g.style, {
      position: 'absolute', left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px',
      margin: 0, pointerEvents: 'none', zIndex: 3, borderRadius: cs.borderRadius, objectFit: cs.objectFit, objectPosition: cs.objectPosition
    });
    el.after(g);   // a sibling, so the same style rules still reach it
    gsap.to(g, { opacity: 0, duration: .28, ease: 'power1.out', ...vars, onComplete: () => g.remove() });
  }

  play(ui, ctx, changes) {
    const sec = ui.querySelector(':scope > section:not(.fx-ghost)');
    this.nav(ui, ctx.mode === 'first');
    if (!sec) return;
    this.segments(sec);
    this.lens(sec, ctx);
    if (ctx.mode === 'first') gsap.from(ui.querySelector(':scope > .bar'), { opacity: 0, y: -8, duration: this.reduced ? .2 : .6, ease: 'out', clearProps: CLEAR });
    if (ctx.mode === 'first' || ctx.mode === 'route') this.enter(sec, ctx);
    else this.update(sec, ctx, changes);
  }

  enter(sec, ctx) {
    if (this.reduced || ctx.keyboard) {
      gsap.fromTo(sec, { opacity: 0 }, { opacity: 1, duration: this.reduced ? .2 : .12, ease: 'none', clearProps: 'opacity', overwrite: true });
      return;
    }
    const first = ctx.mode === 'first', lead = first ? .3 : 0;
    const $ = sel => [...sec.querySelectorAll(sel)];
    const tl = this.timeline(this.running, lead);
    const from = (targets, vars, at) => { if (targets.length) tl.from(targets, { ...vars, clearProps: CLEAR }, at); };
    // CSS transitions on the same properties would chase every frame GSAP writes. Hold them until the page has landed.
    sec.classList.add('fx-entering');
    tl.fx.done.push(() => sec.classList.remove('fx-entering'));
    from($(KICKERS), { opacity: 0, x: -8, duration: .4, stagger: .04 }, 0);
    for (const h of $('h1, h2')) this.title(h, h.matches('.launchtitle h1'), lead + .04);
    from($(COPY), { opacity: 0, y: 8, duration: .45, stagger: .05 }, .12);
    from($('.actions > *'), { opacity: 0, y: 6, duration: .4, stagger: .045 }, .18);
    from($(SURFACES), { opacity: 0, y: 14, duration: .55, stagger: .06 }, .06);
    const items = $(ITEMS);
    from(items, { opacity: 0, y: 10, duration: .45, stagger: Math.min(.04, .32 / Math.max(items.length, 1)) }, .14);
    from($('.mcell'), { opacity: 0, scale: .94, duration: .35, stagger: { amount: .35, grid: [5, 10], from: 'start' } }, .12);
    from($(STILLS), { scale: 1.07, duration: 1.1 }, .1);
  }

  // The same page with new content: refocus what changed, leave the rest alone.
  // Each tween here replaces any still running on the same element (overwrite: true). Two tweens on one
  // element fight, and the older one clearing its properties as it ends makes the newer one flash.
  update(sec, ctx, ch) {
    if (!ch || ctx.keyboard) return;
    const blocks = new Set();
    for (const el of ch.text) {
      const b = el?.closest?.(BLOCKS);
      if (b && sec.contains(b)) blocks.add(b);
    }
    const list = [...blocks].filter(b => ![...blocks].some(o => o !== b && o.contains(b)));
    if (this.reduced) {
      if (list.length) gsap.fromTo(list, { opacity: 0 }, { opacity: 1, duration: .15, ease: 'none', clearProps: 'opacity', overwrite: true });
      return;
    }
    const hero = list.find(b => b.matches('.launchtitle h1'));
    if (hero) this.title(hero, true, 0, true);
    const rest = list.filter(b => b !== hero);
    if (rest.length) gsap.fromTo(rest, { opacity: 0, y: 6, filter: 'blur(5px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .38, stagger: .03, ease: 'out', clearProps: CLEAR, overwrite: true });
    const imgs = ch.src.filter(i => i.isConnected && !i.classList.contains('fx-plate'));
    if (imgs.length) gsap.fromTo(imgs, { scale: 1.05 }, { scale: 1, duration: .7, ease: 'out', clearProps: 'transform', overwrite: true });
    const added = ch.add.filter(n => n.nodeType === 1 && n.isConnected && !n.closest(BLOCKS));
    const wipe = added.find(n => n.classList.contains('wipe'));
    if (wipe) {
      // Opening the comparison sweeps the storyboard in, which also shows that the divider can be dragged.
      gsap.fromTo(wipe, { '--split': '0%' }, { '--split': wipe.style.getPropertyValue('--split') || '50%', duration: .6, ease: 'inOut', overwrite: true });
    }
    const soft = added.filter(n => n !== wipe && !n.matches('input'));
    if (soft.length) gsap.from(soft, { opacity: 0, y: 6, duration: .3, ease: 'out', clearProps: CLEAR });
    if (ctx.mode === 'step' && ctx.kind === 'brief') {
      const body = sec.querySelector('.formbody > :first-child');
      if (body) gsap.fromTo(body, { opacity: 0, x: 18 * (ctx.dir || 1) }, { opacity: 1, x: 0, duration: .34, ease: 'out', clearProps: CLEAR, overwrite: true });
    }
  }

  // The film index is clicked through quickly, so its inspection row only refocuses, briefly.
  inspect() {
    const row = this.app.querySelector('#inspectentry');
    if (row && this.level === 'full') gsap.fromTo(row.children, { opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)', duration: .22, ease: 'out', clearProps: CLEAR, overwrite: true });
  }

  // The gold ring that marks the featured dock card is its own element: it slides to the chosen card and
  // stretches a little on the way, and at rest it is the same outline the design draws.
  lens(sec, ctx = {}) {
    const dock = sec.querySelector('.launchdock'), on = dock?.querySelector('.dockframe.on');
    if (!dock || !on) return;
    let lens = dock.querySelector('.fx-docklens');
    const fresh = !lens;
    if (fresh) {
      lens = document.createElement('i');
      lens.className = 'fx-docklens';
      lens.setAttribute('data-fx-keep', '');
      lens.setAttribute('aria-hidden', 'true');
      dock.appendChild(lens);
    }
    // Placed in percentages of the dock, so the ring stays on its card however the dock is resized.
    const W = dock.clientWidth || 1, H = dock.clientHeight || 1, pct = v => v * 100 + '%';
    const left = on.offsetLeft / W, top = on.offsetTop / H;
    lens.style.width = pct(on.offsetWidth / W);
    lens.style.height = pct(on.offsetHeight / H);
    if (fresh || this.level !== 'full' || ctx.keyboard || ctx.instant) {
      gsap.killTweensOf(lens);
      gsap.set(lens, { left: pct(left), top: pct(top), scaleX: 1 });
      return;
    }
    if (Math.abs(parseFloat(lens.style.left) - left * 100) < .1) return;
    gsap.to(lens, { left: pct(left), top: pct(top), duration: .55, ease: 'drawer', overwrite: 'auto' });
    gsap.killTweensOf(lens, 'scaleX');
    gsap.fromTo(lens, { scaleX: 1 }, { scaleX: 1.08, duration: .27, ease: 'power2.out', yoyo: true, repeat: 1 });
  }

  // One underline slides between the main sections instead of each item drawing its own.
  nav(ui, instant) {
    const group = ui.querySelector('.navgroup');
    if (!group) return;
    let line = group.querySelector('.fx-navline');
    if (!line) {
      line = document.createElement('i');
      line.className = 'fx-navline';
      line.setAttribute('data-fx-keep', '');
      line.setAttribute('aria-hidden', 'true');
      group.appendChild(line);
      instant = true;
    }
    const on = group.querySelector('.navitem.active');
    if (instant) line.style.transition = 'none';
    line.style.opacity = on ? 1 : 0;
    if (on) line.style.transform = 'translate(' + on.offsetLeft + 'px,' + (on.offsetTop + on.offsetHeight) + 'px) scaleX(' + on.offsetWidth + ')';
    if (instant) { line.offsetWidth; line.style.transition = ''; }
  }

  // Control Center switches: a second, "chosen" copy of each switch is clipped to the active option,
  // so the metal thumb and its dark label slide together.
  segments(sec) {
    for (const sel of sec.querySelectorAll('.selector')) {
      let seg = sel.querySelector('.fx-seg');
      const fresh = !seg;
      if (fresh) {
        seg = document.createElement('span');
        seg.className = 'fx-seg';
        seg.setAttribute('data-fx-keep', '');
        seg.setAttribute('aria-hidden', 'true');
        for (const i of sel.querySelectorAll(':scope > i')) seg.appendChild(i.cloneNode(true));
        sel.appendChild(seg);
      }
      const on = sel.querySelector(':scope > i.chosen');
      if (!on) continue;
      if (fresh) seg.style.transition = 'none';
      seg.style.setProperty('--l', on.offsetLeft + 'px');
      seg.style.setProperty('--r', (sel.clientWidth - on.offsetLeft - on.offsetWidth) + 'px');
      if (fresh) { seg.offsetWidth; seg.style.transition = ''; }
    }
  }

  // Tiles tilt toward the pointer and catch a glint. GSAP owns their transform.
  // A tile with glass inside lifts without turning, so the glass stays square to its border.
  hover() {
    const app = this.app, tile = e => e.target.closest?.('.tile');
    app.addEventListener('pointermove', e => {
      const el = e.pointerType === 'mouse' && this.level === 'full' && tile(e);
      if (!el || el.closest('.fx-entering')) return;
      const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
      el.style.setProperty('--pointer-x', (50 + x * 100) + '%');
      el.style.setProperty('--pointer-y', (50 + y * 100) + '%');
      el.classList.add('reflect');
      const flat = el.classList.contains('fx-glass');
      gsap.to(el, { rotationX: flat ? 0 : -y * 2.2, rotationY: flat ? 0 : x * 3, y: -3, transformPerspective: 900, duration: .5, ease: 'out', overwrite: 'auto' });
    });
    app.addEventListener('pointerout', e => {
      const el = tile(e);
      if (!el || el.contains(e.relatedTarget) || !el.classList.contains('reflect')) return;
      el.classList.remove('reflect');
      gsap.to(el, { rotationX: 0, rotationY: 0, y: 0, scale: 1, duration: .6, ease: 'out', overwrite: 'auto', clearProps: 'transform' });
    });
    app.addEventListener('pointerdown', e => {
      const el = this.level === 'full' && tile(e);
      if (el) gsap.to(el, { scale: .985, duration: .12, ease: 'out', overwrite: 'auto' });
    });
    app.addEventListener('pointerup', e => {
      const el = this.level === 'full' && tile(e);
      if (el) gsap.to(el, { scale: 1, duration: .3, ease: 'out', overwrite: 'auto' });
    });
  }
}
