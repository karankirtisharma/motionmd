(function () {
  const CATS = window.MD_CATEGORIES;
  const ALL = window.MD_PROJECTS;
  const poster = window.MD_POSTER;
  const MEDIA = window.MD_MEDIA;
  const sfx = window.MD_SOUND;
  const gsap = window.gsap;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mod = (a, n) => ((a % n) + n) % n;

  const os = $('#os');
  const topbar = $('.topbar');
  const home = $('#home');
  const library = $('#library');
  const stage = $('#stage');
  const carousel = $('#carousel');
  const capText = $('.caption__text');
  const quick = $('#quick');
  const cinema = $('#cinema');
  const cinemaVideo = $('#cinemaVideo');
  const layers = $$('.backdrop__layer');
  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => os.classList.contains('reduce-motion');
  const D = (t) => (reduced() ? 0 : t);                              // GSAP durations collapse under reduced motion
  const U = () => Math.min(innerWidth * 0.01, innerHeight * 0.024);  // 1u in px, same as the CSS --u

  const hosted = new URLSearchParams(location.search).has('host'); // embedded in a host scene (iframe)
  const state = { cat: 'all', list: ALL, view: 'home', backdropId: null, layer: 0, returnFocus: null, repeat: false, playSrc: null };
  const byId = Object.fromEntries(ALL.map((p) => [p.id, p]));
  const inCat = (cat) => (cat === 'all' ? ALL : ALL.filter((p) => p.category === cat));

  // ---------- Rendering ----------
  function renderCats() {
    $('#cats').innerHTML = CATS.map((c) =>
      `<button class="cat" data-nav data-cat="${c.id}" aria-pressed="${c.id === state.cat}"><span class="cat__label">${c.label}</span></button>`).join('') +
      `<i class="cats__led" aria-hidden="true"></i>`;
  }
  function renderCarousel() {
    carousel.innerHTML = state.list.map((p, i) =>
      `<button class="cover" data-index="${i}" tabindex="-1" aria-label="${esc(p.title)}, ${esc(p.niche)}">${poster(p, { eager: true })}</button>`).join('');
    covers = $$('.cover', carousel);
  }
  function renderGrid() {
    $('#grid').innerHTML = CATS.filter((c) => c.id !== 'all').flatMap((c) => inCat(c.id)).map((p) =>
      `<button class="card" data-nav data-id="${p.id}">
        <span class="card__art">${poster(p)}</span>
        <span class="card__title">${esc(p.title)}</span>
        <span class="card__niche">${esc(p.niche)}</span>
      </button>`).join('');
  }

  // ---------- Carousel engine ----------
  // One continuous position drives every card (offset, depth, tilt, brightness, stacking),
  // so stepping, scrubbing, fanning out and re-targeting mid-flight are all the same motion.
  // The list loops: neighbours are measured on the shortest way round.
  const SCALES = [1, 0.7, 0.54, 0.44, 0.38];
  const car = { pos: 0, target: 0, spread: 1 };
  let covers = [];
  let W = 0, XS = [0];
  let lastCentre = null;

  function measure() {
    W = covers[0] ? covers[0].offsetWidth : 0;
    home.style.setProperty('--cw', W + 'px');
    const gap = W * 0.025;
    XS = [0];
    for (let k = 1; k < SCALES.length; k++) XS[k] = XS[k - 1] + (W * (SCALES[k - 1] + SCALES[k])) / 2 + gap;
  }
  // piecewise-linear lookup that keeps extrapolating past the last stop
  const lerpArr = (arr, a) => {
    const k = Math.min(Math.floor(a), arr.length - 2);
    return arr[k] + (arr[k + 1] - arr[k]) * (a - k);
  };

  function render() {
    if (!W) measure();
    const n = covers.length, flat = reduced();
    let centreEl = null, best = Infinity;
    for (let i = 0; i < n; i++) {
      let d = mod(i - car.pos, n);
      if (d > n / 2) d -= n;
      const a = Math.abs(d), dir = Math.sign(d);
      const s = car.spread;
      const x = dir * lerpArr(XS, a) * s;
      const sc = Math.max(0.3, lerpArr(SCALES, Math.min(a, SCALES.length - 1))) * (0.92 + 0.08 * s);
      const rot = flat ? 0 : -dir * Math.min(a, 1) * 30 * s;
      const z = flat ? 0 : -Math.min(a, 4) * W * 0.2 - (1 - s) * W * 0.5;
      const fade = a > 3.2 ? Math.max(0, 1 - (a - 3.2) * 1.6) : 1;
      const c = covers[i];
      c.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(1)}px) rotateY(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      c.style.opacity = (a < 0.5 ? 1 : fade * (0.25 + 0.75 * s)).toFixed(3);
      c.style.zIndex = String(1000 - Math.round(a * 100));
      c.style.setProperty('--dim', (1 - Math.min(a, 1) * 0.62).toFixed(3));
      c.style.pointerEvents = fade > 0.05 ? '' : 'none';
      if (a < best) { best = a; centreEl = c; }
    }
    if (centreEl && centreEl !== lastCentre) {
      const hadFocus = lastCentre && document.activeElement === lastCentre;
      if (lastCentre) { lastCentre.classList.remove('is-center'); lastCentre.removeAttribute('data-nav'); lastCentre.tabIndex = -1; }
      centreEl.classList.add('is-center'); centreEl.setAttribute('data-nav', ''); centreEl.tabIndex = 0;
      lastCentre = centreEl;
      if (hadFocus) centreEl.focus({ preventScroll: true });
    }
  }
  const index = () => mod(Math.round(car.target), state.list.length);
  const centre = () => lastCentre;
  const currentProject = () => state.list[index()];

  let stepTween = null;
  function goTo(target, { duration, ease } = {}) {
    car.target = target;
    coverPreview.stop();
    const held = state.repeat;
    if (stepTween) stepTween.kill();
    stepTween = gsap.to(car, {
      pos: target,
      duration: D(duration ?? (held ? 0.2 : 0.5)),
      ease: ease ?? (held ? 'power2.out' : 'power3.out'),
      onUpdate: render,
      onComplete: () => { render(); if (state.view === 'home' && cinema.hidden) coverPreview.arm($('.poster', centre())); },
    });
    if (!stepTween.duration()) render();
    selected(held);
  }
  function step(dir) {
    if (state.list.length < 2) { sfx.play('edge'); return; }
    sfx.play('move', dir < 0 ? 'left' : 'right');
    nudgeSheen(dir);
    goTo(car.target + dir);
  }

  // What the focused project drives: caption, backdrop, scene bridge
  let bdTimer = 0;
  function selected(held) {
    const p = currentProject();
    swapCaption(p, held);
    clearTimeout(bdTimer);
    if (held) bdTimer = setTimeout(() => setBackdrop(p), 160); else setBackdrop(p);
  }

  let capTl = null, capId = null;
  function swapCaption(p, instant) {
    if (capId === p.id && !instant) return;
    capId = p.id;
    const lines = [...capText.children];
    const fill = () => { $('#capNiche').textContent = p.niche; $('#capTitle').textContent = p.title; $('#capPurpose').textContent = p.purpose; };
    if (capTl) capTl.kill();
    if (instant || reduced()) { gsap.set(lines, { clearProps: 'transform,opacity' }); fill(); return; }
    const u = U();
    capTl = gsap.timeline()
      .to(lines, { y: -u * 0.4, opacity: 0, duration: 0.14, ease: 'power2.out', stagger: 0.02 })
      .add(fill)
      .fromTo(lines, { y: u * 0.5, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, ease: 'power3.out', stagger: 0.045 });
  }

  function setBackdrop(p) {
    if (state.backdropId === p.id) return;
    state.backdropId = p.id;
    state.layer = 1 - state.layer;
    const on = layers[state.layer], off = layers[1 - state.layer];
    on.innerHTML = poster(p, { eager: true });
    on.classList.add('is-on');
    off.classList.remove('is-on');
    setTimeout(() => { if (!off.classList.contains('is-on')) off.innerHTML = ''; }, 700);
    emit('select', { id: p.id, title: p.title, niche: p.niche, poster: new URL(MEDIA.poster(p), location.href).href });
  }

  // Glass highlights lean the way you move, then settle
  let sheenTl = null;
  function nudgeSheen(dir) {
    if (reduced()) return;
    if (sheenTl) sheenTl.kill();
    sheenTl = gsap.timeline()
      .to(os, { '--sheen': dir * 10, duration: 0.3, ease: 'power2.out' })
      .to(os, { '--sheen': 0, duration: 1.4, ease: 'power2.inOut' });
  }

  // ---------- Category chips ----------
  function placeLed(animate) {
    const t = $('.cat[aria-pressed="true"]'), led = $('.cats__led');
    if (!t || !led) return;
    const x = t.offsetLeft + t.offsetWidth / 2 - led.offsetWidth / 2;
    gsap.to(led, { x, duration: animate ? D(0.5) : 0, ease: 'expo.inOut' });
  }

  let catTl = null;
  function setCategory(cat) {
    if (cat === state.cat) return;
    state.cat = cat;
    $$('.cat').forEach((t) => t.setAttribute('aria-pressed', t.dataset.cat === cat));
    placeLed(true);
    sfx.play('tab');
    coverPreview.stop();
    if (catTl) catTl.progress(1).kill();
    // collapse the current set into the centre, swap, then fan the new set out
    catTl = gsap.timeline()
      .to(car, { spread: 0, duration: D(0.26), ease: 'power2.in', onUpdate: render })
      .to(carousel, { autoAlpha: 0, duration: D(0.16), ease: 'power2.out' }, '-=0.12')
      .add(() => {
        state.list = inCat(cat);
        renderCarousel(); lastCentre = null; W = 0;
        car.pos = car.target = 0;
        render(); selected(false);
      })
      .set(carousel, { autoAlpha: 1 })
      .to(car, { spread: 1, duration: D(0.7), ease: 'expo.out', onUpdate: render, onComplete: () => coverPreview.arm($('.poster', centre())) });
  }

  // ---------- Video previews (one at a time) ----------
  function previewSlot(delay) {
    let timer = 0, live = null;
    const stop = () => {
      clearTimeout(timer);
      if (!live) return;
      const v = $('video', live);
      live.classList.remove('is-playing');
      if (v) v.pause();
      live = null;
    };
    const arm = (posterEl) => {
      if (live === posterEl) return;
      stop();
      if (!posterEl || reduced()) return;
      timer = setTimeout(() => {
        const v = $('video', posterEl);
        if (!v) return;
        if (!v.src) v.src = v.dataset.src;
        live = posterEl;
        v.currentTime = 0;
        v.addEventListener('playing', () => posterEl.classList.add('is-playing'), { once: true });
        v.play().catch(() => {});
      }, delay);
    };
    return { arm, stop };
  }
  const coverPreview = previewSlot(420);
  const cardPreview = previewSlot(380);

  // ---------- Views ----------
  let viewTl = null;
  function setView(view) {
    if (view === state.view) { focusDefault(); return; }
    const from = state.view === 'home' ? home : library;
    const to = view === 'home' ? home : library;
    state.view = view;
    os.dataset.view = view;
    $$('[data-view-btn]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.viewBtn === view));
    placeThumb();
    sfx.play('tab');
    coverPreview.stop(); cardPreview.stop();
    if (viewTl) viewTl.progress(1).kill();
    const u = U();
    viewTl = gsap.timeline()
      .to(from, { autoAlpha: 0, scale: view === 'library' ? 0.96 : 1, y: view === 'home' ? u : 0, duration: D(0.24), ease: 'power2.out' })
      .add(() => {
        from.hidden = true; gsap.set(from, { clearProps: 'all' });
        to.hidden = false;
        if (view === 'home') { W = 0; render(); }
      })
      .fromTo(to, { autoAlpha: 0, scale: view === 'home' ? 1.03 : 1 }, { autoAlpha: 1, scale: 1, duration: D(0.45), ease: 'expo.out', clearProps: 'all' });
    if (view === 'library') {
      viewTl.add(() => {
        const cards = $$('.card', library);
        const fromIdx = Math.max(0, cards.findIndex((c) => c.dataset.id === state.backdropId));
        gsap.fromTo(cards, { y: u * 2.5, opacity: 0 }, { y: 0, opacity: 1, duration: D(0.5), ease: 'power3.out', stagger: { each: 0.025, grid: 'auto', from: fromIdx }, clearProps: 'transform,opacity' });
        (cards[fromIdx] || cards[0]).focus({ preventScroll: true });
      }, '<');
    } else {
      viewTl.add(() => {
        gsap.fromTo(car, { spread: 0.6 }, { spread: 1, duration: D(0.7), ease: 'expo.out', onUpdate: render });
        state.backdropId = null; setBackdrop(currentProject());
        focusDefault();
        coverPreview.arm($('.poster', centre()));
      }, '<');
    }
  }

  function placeThumb() {
    const group = $('.views'), on = $('[aria-pressed="true"]', group);
    if (!on) return;
    group.style.setProperty('--tx', on.offsetLeft + 'px');
    group.style.setProperty('--tw', on.offsetWidth + 'px');
  }

  function focusDefault() {
    const el = state.view === 'home' ? centre() : ($('.card:focus') || $('.card'));
    if (el) el.focus({ preventScroll: true });
  }

  // ---------- Sheets (quick menu) ----------
  function sheetIn(el) {
    el.hidden = false;
    el.classList.remove('is-closing');
    el.classList.add('is-entering');
    void el.firstElementChild.offsetWidth; // commit the off-screen start state, then slide in
    el.classList.remove('is-entering');
  }
  function sheetOut(el, done) {
    el.classList.add('is-entering', 'is-closing');
    let finished = false;
    const end = () => { if (finished) return; finished = true; el.hidden = true; el.classList.remove('is-closing'); if (done) done(); };
    el.firstElementChild.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 300);
  }
  const restoreFocus = () => (state.returnFocus && document.contains(state.returnFocus) && !state.returnFocus.closest('[hidden]') && state.returnFocus.hasAttribute('data-nav')
    ? state.returnFocus.focus({ preventScroll: true }) : focusDefault());

  function openQuick() {
    state.returnFocus = document.activeElement;
    coverPreview.stop(); cardPreview.stop();
    sfx.play('open'); sheetIn(quick);
    $('.quick__item', quick).focus({ preventScroll: true });
    gsap.fromTo($$('.quick__item', quick), { y: U() * 0.4, opacity: 0 }, { y: 0, opacity: 1, duration: D(0.3), ease: 'power3.out', stagger: 0.03, clearProps: 'transform,opacity' });
  }
  function closeQuick(then) {
    sfx.play('close');
    sheetOut(quick, () => {
      if (then) then(); else restoreFocus();
      if (state.view === 'home') coverPreview.arm($('.poster', centre()));
    });
  }

  // ---------- Player: opens out of the card, closes back into it ----------
  const insetOf = (el) => {
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return 'inset(30% 30% 30% 30% round 24px)';
    const rad = U() * 1.3;
    return `inset(${r.top.toFixed(1)}px ${(innerWidth - r.right).toFixed(1)}px ${(innerHeight - r.bottom).toFixed(1)}px ${r.left.toFixed(1)}px round ${rad.toFixed(1)}px)`;
  };
  const FULL = 'inset(0px 0px 0px 0px round 0px)';
  const sourceFor = (p) => (state.view === 'library' ? $(`.card[data-id="${p.id}"] .card__art`) : $('.poster', centre()));
  const behind = () => [topbar, state.view === 'home' ? home : library];

  let idleTimer = 0, playTl = null;
  function wakeChrome() {
    cinema.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => cinema.classList.add('is-idle'), 3200);
  }
  function play(p) {
    if (!p) return;
    stopAttract();
    state.returnFocus = document.activeElement;
    state.playSrc = sourceFor(p);
    coverPreview.stop(); cardPreview.stop();
    setBackdrop(p);
    sfx.play('select');
    $('#cinemaNiche').textContent = p.niche;
    $('#cinemaTitle').textContent = p.title;
    $('#cinemaMeta').textContent = [p.style, p.software.join(' + '), p.duration].join('  ·  ');
    $('#cinemaProgress').style.setProperty('--p', 0);
    $('#cinemaFill').src = $('#cinemaStill').src = MEDIA.poster(p);
    cinema.classList.remove('is-playing', 'is-paused');
    cinemaVideo.src = `${MEDIA.full(p)}#t=${p.media.start || 0}`;
    cinemaVideo.muted = false;
    cinema.hidden = false;
    os.classList.add('is-cinema');
    $('#cinemaExit').focus({ preventScroll: true });
    wakeChrome();
    const chrome = [...$$('.cinema__info > *', cinema), $('.cinema__controls', cinema)];
    if (playTl) playTl.kill();
    playTl = gsap.timeline()
      .fromTo(cinema, { clipPath: insetOf(state.playSrc) }, { clipPath: FULL, duration: D(0.7), ease: 'expo.inOut' })
      .fromTo([cinemaVideo, $('#cinemaStill')], { scale: 1.06 }, { scale: 1, duration: D(1.1), ease: 'expo.out' }, 0)
      .to(behind(), { scale: 0.96, duration: D(0.6), ease: 'expo.inOut' }, 0)
      .fromTo(chrome, { y: U() * 0.8, opacity: 0 }, { y: 0, opacity: 1, duration: D(0.5), ease: 'power3.out', stagger: 0.06, clearProps: 'transform,opacity' }, D(0.45));
    cinemaVideo.play().catch(() => { cinemaVideo.muted = true; cinemaVideo.play().catch(() => {}); });
  }
  function exitPlay() {
    sfx.play('back');
    clearTimeout(idleTimer);
    cinemaVideo.pause();
    cinema.classList.remove('is-idle');
    const target = state.playSrc && document.contains(state.playSrc) && !state.playSrc.closest('[hidden]') ? state.playSrc : $('.poster', centre());
    if (playTl) playTl.kill();
    playTl = gsap.timeline({
      onComplete: () => {
        cinema.hidden = true;
        gsap.set(cinema, { clearProps: 'clipPath' });
        cinemaVideo.removeAttribute('src'); cinemaVideo.load();
        os.classList.remove('is-cinema');
        restoreFocus(); // after the player is hidden, so the dialog focus trap doesn't pull it back
        if (state.view === 'home') coverPreview.arm($('.poster', centre()));
        armAttract();
      },
    })
      .to(cinema, { clipPath: insetOf(target), duration: D(0.5), ease: 'expo.inOut' })
      .to(behind(), { scale: 1, duration: D(0.5), ease: 'expo.inOut', clearProps: 'transform' }, 0);
  }
  function togglePause() {
    if (cinemaVideo.paused) cinemaVideo.play().catch(() => {}); else cinemaVideo.pause();
    wakeChrome();
  }
  cinemaVideo.addEventListener('playing', () => cinema.classList.add('is-playing'));
  cinemaVideo.addEventListener('pause', () => { cinema.classList.add('is-paused'); $('#cinemaToggle').setAttribute('aria-label', 'Play'); });
  cinemaVideo.addEventListener('play', () => { cinema.classList.remove('is-paused'); $('#cinemaToggle').setAttribute('aria-label', 'Pause'); });
  cinemaVideo.addEventListener('timeupdate', () => {
    const d = cinemaVideo.duration;
    if (d) $('#cinemaProgress').style.setProperty('--p', (cinemaVideo.currentTime / d).toFixed(4));
  });
  cinemaVideo.addEventListener('ended', exitPlay);
  cinema.addEventListener('pointermove', wakeChrome);
  cinemaVideo.addEventListener('click', togglePause);

  // ---------- Idle attract mode: the wall keeps moving when nobody is browsing ----------
  let attractWait = 0, attractLoop = 0;
  function stopAttract() { clearTimeout(attractWait); clearInterval(attractLoop); }
  function armAttract() {
    stopAttract();
    if (reduced()) return;
    attractWait = setTimeout(() => {
      attractLoop = setInterval(() => {
        if (state.view !== 'home' || !cinema.hidden || !quick.hidden) return;
        state.repeat = false;
        nudgeSheen(1);
        goTo(car.target + 1, { duration: 1.2, ease: 'expo.inOut' });
      }, 8000);
    }, 45000);
  }

  // ---------- Settings ----------
  function setReduce(on) {
    os.classList.toggle('reduce-motion', on);
    $('#motionToggle').setAttribute('aria-pressed', on);
    if (on) { coverPreview.stop(); cardPreview.stop(); stopAttract(); }
    render();
  }
  function setSound(on) {
    sfx.enabled = on;
    $('#soundToggle').setAttribute('aria-pressed', on);
  }

  // ---------- Spatial navigation (D-pad / arrow keys / remote) ----------
  function scope() {
    if (!quick.hidden) return quick;
    if (!cinema.hidden) return cinema;
    return os;
  }
  const navigables = (root) => $$('[data-nav]', root).filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);

  function move(dir) {
    const from = document.activeElement;
    if (from && from.classList.contains('cover') && (dir === 'left' || dir === 'right')) { step(dir === 'left' ? -1 : 1); return; }
    const items = navigables(scope());
    if (!items.includes(from)) { (items.find((el) => el.classList.contains('is-center')) || items[0])?.focus(); return; }
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      let main, cross;
      if (dir === 'left') { if (b.right > a.left + 1) continue; main = -dx; cross = Math.abs(dy); }
      if (dir === 'right') { if (b.left < a.right - 1) continue; main = dx; cross = Math.abs(dy); }
      if (dir === 'up') { if (b.bottom > a.top + 1) continue; main = -dy; cross = Math.abs(dx); }
      if (dir === 'down') { if (b.top < a.bottom - 1) continue; main = dy; cross = Math.abs(dx); }
      const score = main + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    // Entering the chip row lands on the active category, not whichever chip is nearest
    if (best && best.classList.contains('cat') && !from.classList.contains('cat')) best = $('.cat[aria-pressed="true"]') || best;
    if (best) { best.focus({ preventScroll: true }); sfx.play('move', dir); }
    else sfx.play('edge');
  }

  function back() {
    if (!quick.hidden) return closeQuick();
    if (!cinema.hidden) return exitPlay();
    sfx.play('back');
    if (state.view === 'library') return setView('home');
    if (hosted) return emit('exit'); // Back from Home hands control back to the host scene
    focusDefault();
  }

  const current = () => (state.view === 'library' && document.activeElement?.dataset.id ? byId[document.activeElement.dataset.id] : currentProject());
  const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  function handleKey(key, { repeat = false, remote = false } = {}) {
    state.repeat = repeat;
    armAttract();
    if (DIRS[key]) { move(DIRS[key]); return true; }
    if (key === 'Escape' || key === 'Backspace') { back(); return true; }
    if (key === 'm' || key === 'M') { if (quick.hidden) openQuick(); else closeQuick(); return true; }
    if (!cinema.hidden) {
      wakeChrome();
      if (key === ' ' || key === 'k' || key === 'K') { togglePause(); return true; }
      return false;
    }
    if (!quick.hidden) return false;
    if (key === 'p' || key === 'P') { play(current()); return true; }
    if (key === 'l' || key === 'L') { setView(state.view === 'library' ? 'home' : 'library'); return true; }
    if (remote && (key === 'Enter' || key === ' ')) { document.activeElement?.click(); return true; }
    return false;
  }

  document.addEventListener('keydown', (e) => {
    sfx.wake();
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!flown) { e.preventDefault(); fly(true); return; } // first key skips the splash
    if (handleKey(e.key, { repeat: e.repeat })) e.preventDefault();
  });
  // releasing a held arrow lets the caption and backdrop catch up properly
  document.addEventListener('keyup', () => { if (state.repeat) { state.repeat = false; capId = null; selected(false); } });
  document.addEventListener('pointerdown', () => { sfx.wake(); armAttract(); if (!flown) fly(true); });

  // Keep focus inside open dialogs when tabbing
  document.addEventListener('focusin', (e) => {
    const root = !quick.hidden ? quick : !cinema.hidden ? cinema : null;
    if (root && !root.contains(e.target)) $('[data-nav], button', root)?.focus({ preventScroll: true });
  });

  // ---------- Carousel pointer: click, wheel, swipe ----------
  let swipe = null, swiped = false;
  stage.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; swiped = false; });
  stage.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; state.repeat = false; step(dx < 0 ? 1 : -1); centre()?.focus({ preventScroll: true }); }
  });
  carousel.addEventListener('click', (e) => {
    const c = e.target.closest('.cover');
    if (!c || swiped) return;
    const n = state.list.length, i = +c.dataset.index;
    let d = mod(i - index(), n);
    if (d > n / 2) d -= n;
    if (d === 0) { play(currentProject()); return; }
    state.repeat = false;
    sfx.play('move', d < 0 ? 'left' : 'right');
    nudgeSheen(Math.sign(d));
    goTo(car.target + d);
    centre()?.focus({ preventScroll: true });
  });
  let wheelAt = 0;
  stage.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 8) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 200) return;
    state.repeat = now - wheelAt < 400;
    wheelAt = now;
    armAttract();
    step(d > 0 ? 1 : -1);
  }, { passive: false });

  // ---------- Chips ----------
  $('#cats').addEventListener('click', (e) => { const t = e.target.closest('.cat'); if (t) setCategory(t.dataset.cat); });

  // ---------- Library ----------
  // Hover selects only on real mouse movement (not when content moves under a resting cursor)
  let lastPointer = { x: -1, y: -1 };
  const movedPointer = (e) => {
    if (e.pointerType !== 'mouse') return false;
    const moved = Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y) > 3;
    lastPointer = { x: e.clientX, y: e.clientY };
    return moved;
  };
  const grid = $('#grid');
  grid.addEventListener('focusin', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    setBackdrop(byId[c.dataset.id]);
    cardPreview.arm($('.poster', c));
  });
  grid.addEventListener('focusout', (e) => { if (!grid.contains(e.relatedTarget)) cardPreview.stop(); });
  grid.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) play(byId[c.dataset.id]); });
  grid.addEventListener('pointermove', (e) => {
    if (!movedPointer(e)) return;
    const c = e.target.closest('.card');
    if (c && c !== document.activeElement) { c.focus({ preventScroll: true }); sfx.play('move'); }
  });

  // ---------- Buttons ----------
  $$('[data-view-btn]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.viewBtn)));
  $('#playBtn').addEventListener('click', () => play(currentProject()));
  $('#menuBtn').addEventListener('click', openQuick);
  quick.addEventListener('click', (e) => { if (e.target === quick) closeQuick(); });
  $$('[data-go]', quick).forEach((b) => b.addEventListener('click', () => closeQuick(() => setView(b.dataset.go))));
  $('#motionToggle').addEventListener('click', () => { setReduce(!reduced()); sfx.play('tab'); });
  $('#soundToggle').addEventListener('click', () => { setSound(!sfx.enabled); sfx.play('tab'); });
  if (hosted) { $('#leaveBtn').hidden = false; $('#leaveBtn').addEventListener('click', () => closeQuick(() => emit('exit'))); }
  $('#cinemaExit').addEventListener('click', exitPlay);
  $('#cinemaToggle').addEventListener('click', togglePause);
  reduceQuery.addEventListener('change', (e) => setReduce(e.matches));
  // The card size follows the stage height (container units), so re-measure whenever the stage resizes
  new ResizeObserver(() => { W = 0; render(); placeThumb(); placeLed(false); }).observe(stage);

  // ---------- Scene bridge ----------
  // Parent page (e.g. the Three.js scene hosting this in an iframe) can drive it:
  //   iframe.contentWindow.postMessage({ type: 'md-os:key', key: 'ArrowRight' }, '*')
  // and listen for { type: 'md-os:select', id, title, niche, poster } coming back.
  // Opened with ?host=<name>, Back from Home and the quick menu emit { type: 'md-os:exit' };
  // 'md-os:suspend' / 'md-os:resume' stop and restart playback while the host hides the frame.
  function emit(name, data) {
    if (window.parent !== window) window.parent.postMessage({ type: 'md-os:' + name, ...data }, '*');
  }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'md-os:suspend') { cinemaVideo.pause(); coverPreview.stop(); cardPreview.stop(); stopAttract(); return; }
    if (d && d.type === 'md-os:resume') { if (flown && state.view === 'home' && cinema.hidden) coverPreview.arm($('.poster', centre())); armAttract(); return; }
    if (!(d && d.type === 'md-os:key' && typeof d.key === 'string')) return;
    sfx.wake();
    if (!flown) fly(true); else handleKey(d.key, { remote: true });
  });
  window.mdOS = { key: (k) => handleKey(k, { remote: true }), play: (id) => byId[id] && play(byId[id]), setView };

  // ---------- Boot ----------
  // The serif mark sweeps, then flies into the top-left logo while Home assembles around it:
  // carousel rises and fans out, caption and chips stagger in, the LED draws on.
  const boot = $('#boot');
  let flown = false;
  function fly(withSound) {
    if (flown) return;
    flown = true;
    if (withSound) sfx.play('fly');
    const u = U();
    const mark = $('#bootMark'), brand = $('#brandMark');
    const m = mark.getBoundingClientRect(), b = brand.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(brand).fontSize) / parseFloat(getComputedStyle(mark).fontSize);
    const dx = b.left + b.width / 2 - (m.left + m.width / 2), dy = b.top + b.height / 2 - (m.top + m.height / 2);
    const enters = $$('.enter', os);
    gsap.set(carousel, { autoAlpha: 0, y: u * 5 });
    car.spread = 0; render();

    // If frames are throttled (hidden or offscreen frame), finish the boot anyway so Home is never stuck hidden
    const safety = setTimeout(() => bootTl.progress(1), 3500);
    const bootTl = gsap.timeline({
      onComplete: () => {
        clearTimeout(safety);
        boot.hidden = true;
        os.classList.remove('is-booting');
        gsap.set([brand, ...enters], { clearProps: 'opacity,transform,visibility' });
        focusDefault();
        coverPreview.arm($('.poster', centre()));
        armAttract();
      },
    })
      .to(mark, { x: dx, y: dy, scale, duration: D(0.9), ease: 'expo.inOut' })
      .to(boot, { backgroundColor: 'rgba(7,5,4,0)', duration: D(0.7), ease: 'power2.out' }, D(0.1))
      .set(brand, { opacity: 1 }, D(0.9))
      .set(mark, { opacity: 0 }, D(0.9))
      .to(carousel, { autoAlpha: 1, y: 0, duration: D(1), ease: 'power3.out' }, D(0.25))
      .to(car, { spread: 1, duration: D(1.2), ease: 'expo.out', onUpdate: render }, D(0.45))
      .fromTo(enters, { opacity: 0, y: u * 1.2 }, { opacity: 1, y: 0, duration: D(0.7), ease: 'power3.out', stagger: 0.08 }, D(0.6))
      .fromTo($$('.cat', os), { opacity: 0, y: u * 0.8 }, { opacity: 1, y: 0, duration: D(0.5), ease: 'power3.out', stagger: { each: 0.04, from: 'center' }, clearProps: 'transform,opacity' }, D(0.8))
      .fromTo('.cats__led', { scaleX: 0 }, { scaleX: 1, duration: D(0.5), ease: 'power2.out' }, D(1.25));
  }

  setReduce(reduceQuery.matches);
  setSound(sfx.enabled);
  renderCats(); renderCarousel(); renderGrid();
  render(); selected(false);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { W = 0; render(); placeThumb(); placeLed(false); });
  placeLed(false);
  setTimeout(() => fly(false), reduced() ? 200 : 1700);
})();
