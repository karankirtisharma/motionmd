// After Effects (fictional): launcher, new-project sheet, workspace with assets, comp preview, properties, timeline.
import { h, $, $$, ic, icons, launcher, swap, seg, scrub, toast, esc, showMenu } from '../ui.js';

const RECENT = [
  { name: 'intro_v3.aep', when: '2 days ago', thumb: 'radial-gradient(80% 90% at 70% 30%,#ffb067,#b4470b 45%,#2e0d03)', layers: ['waves', 'logo', 'sweep'] },
  { name: 'scene_04.aep', when: '4 days ago', thumb: 'linear-gradient(170deg,#4a4a4a,#141414 60%)', layers: ['dust', 'logo'] },
  { name: 'logo_anim.aep', when: '1 week ago', thumb: 'radial-gradient(70% 80% at 60% 70%,#ffd6ad,#e8670f 40%,#4d1805)', layers: ['waves', 'dust', 'logo', 'sweep'] },
];
const LIBRARY = [
  { id: 'logo', name: 'md_logo', type: 'text', dur: 5, icon: 'type', color: '#b57bff' },
  { id: 'waves', name: 'amber_waves.mp4', type: 'gradient', dur: 10, icon: 'film', color: '#ff8a2b' },
  { id: 'sweep', name: 'light_sweep', type: 'sweep', dur: 3, icon: 'sun', color: '#ffd24a' },
  { id: 'dust', name: 'particles', type: 'particles', dur: 10, icon: 'sparkles', color: '#4aa8ff' },
];
const PRESETS = [
  { v: 'fade', label: 'Fade In', icon: 'blend' },
  { v: 'slide', label: 'Slide Up', icon: 'arrow-up-from-line' },
  { v: 'pop', label: 'Scale Pop', icon: 'maximize-2' },
  { v: null, label: 'Remove Animation', icon: 'circle-off' },
];

export const afterEffects = {
  id: 'ae', name: 'After Effects', icon: 'ae',
  mount(root, shell) {
    let state = null;          // project state when the workspace is open
    let raf = 0, last = 0;
    let workspace = null;      // workspace api

    /* ---------------- launcher ---------------- */
    function home() {
      cancelAnimationFrame(raf); workspace = null; state = null;
      const body = h(`<div class="lmain">
        <label class="search">${ic('search')}<input placeholder="Search projects, templates…" aria-label="Search projects"></label>
        <div class="hero panel">
          <div class="hero-center">
            ${ic('file-plus-2', 'class="hero-ic"')}
            <h1>Create Something Amazing</h1>
            <p>Start a new project or open an existing one to get started with After Effects.</p>
            <div class="row"><button class="btn btn-primary" data-act="new">New Project</button><button class="btn btn-secondary" data-act="open">Open Project</button></div>
          </div>
        </div>
        <div class="sec-head"><h2>Recent Projects</h2><button class="btn btn-ghost btn-sm">View All ${ic('arrow-right')}</button></div>
        <div class="cards"></div>
      </div>`);
      const cards = $('.cards', body);
      const renderCards = q => {
        cards.replaceChildren(...RECENT.filter(r => r.name.includes(q)).map(r => {
          const c = h(`<button class="card"><div class="thumb" style="background:${r.thumb}"></div><div class="meta"><b>${r.name}</b><small>${r.when}</small></div></button>`);
          c.addEventListener('click', () => openWorkspace({ name: r.name.replace('.aep', ''), w: 1920, h: 1080, fps: 24, dur: 10, bg: '#140602' }, r.layers));
          return c;
        }));
        if (!cards.children.length) cards.append(h('<p class="muted">No projects match.</p>'));
      };
      renderCards('');
      $('input', body).addEventListener('input', e => renderCards(e.target.value.trim()));
      $('[data-act="new"]', body).addEventListener('click', newProjectSheet);
      $('[data-act="open"]', body).addEventListener('click', () => openWorkspace({ name: 'intro_v3', w: 1920, h: 1080, fps: 24, dur: 10, bg: '#140602' }, RECENT[0].layers));
      const l = launcher({
        id: 'ae', name: 'After Effects',
        nav: [{ v: 'home', label: 'Home', icon: 'house' }, { v: 'new', label: 'New Project', icon: 'file-plus' }, { v: 'open', label: 'Open Project', icon: 'folder-open' }, 'sep',
          { v: 'templates', label: 'Templates', icon: 'layout-grid' }, { v: 'learn', label: 'Learn', icon: 'graduation-cap' }, { v: 'settings', label: 'Settings', icon: 'settings' }],
        status: '<span class="dot"></span>Ready',
        onNav: v => {
          if (v === 'new') { newProjectSheet(); l.nav.select('home'); }
          if (v === 'open') openWorkspace({ name: 'intro_v3', w: 1920, h: 1080, fps: 24, dur: 10, bg: '#140602' }, RECENT[0].layers);
          if (v === 'templates' || v === 'learn' || v === 'settings') toast(`${v[0].toUpperCase() + v.slice(1)} is coming soon`);
        },
        body,
      });
      swap(root, l.el);
    }

    /* ---------------- new project sheet (modal) ---------------- */
    function newProjectSheet() {
      const res = { HD: [1920, 1080], '4K': [3840, 2160], Vertical: [1080, 1920], Square: [1080, 1080] };
      const bgs = ['#140602', '#1e1e1e', '#2a1450'];
      let pick = { res: 'HD', fps: 24, dur: 10, bg: bgs[0] };
      const sheet = h(`<div class="sheet-wrap"><div class="sheet glass" role="dialog" aria-label="New project">
        <h2>New Project</h2>
        <label class="field"><span>Project name</span><input value="Untitled Project" maxlength="40"></label>
        <div class="field"><span>Resolution</span><div class="seg" data-k="res"><button aria-selected="true">HD</button><button>4K</button><button>Vertical</button><button>Square</button></div></div>
        <div class="field two"><div><span>Frame rate</span><div class="seg" data-k="fps"><button aria-selected="true">24</button><button>30</button><button>60</button></div></div>
          <div><span>Duration</span><div class="seg" data-k="dur"><button data-v="5">5s</button><button data-v="10" aria-selected="true">10s</button><button data-v="15">15s</button></div></div></div>
        <div class="field"><span>Background</span><div class="swatches">${bgs.map((c, i) => `<button style="background:${c}" aria-label="Background ${c}" ${i ? '' : 'aria-pressed="true"'} data-c="${c}"></button>`).join('')}</div></div>
        <p class="spec mono"></p>
        <div class="row end"><button class="btn btn-ghost" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="create">Create Project</button></div>
      </div></div>`);
      const spec = $('.spec', sheet);
      const upd = () => { const [w, hh] = res[pick.res]; spec.textContent = `${w} × ${hh} · ${pick.fps} fps · ${pick.dur}s · ${pick.fps * pick.dur} frames`; };
      $$('.seg', sheet).forEach(s => seg(s, v => { pick[s.dataset.k] = s.dataset.k === 'res' ? v : +v; upd(); }));
      $$('.swatches button', sheet).forEach(b => b.addEventListener('click', () => { $$('.swatches button', sheet).forEach(x => x.removeAttribute('aria-pressed')); b.setAttribute('aria-pressed', 'true'); pick.bg = b.dataset.c; }));
      const close = () => { sheet.classList.add('out'); setTimeout(() => sheet.remove(), 180); };
      const create = () => { const [w, hh] = res[pick.res]; close(); openWorkspace({ name: $('input', sheet).value.trim() || 'Untitled Project', w, h: hh, fps: pick.fps, dur: pick.dur, bg: pick.bg }, []); };
      $('[data-act="cancel"]', sheet).addEventListener('click', close);
      $('[data-act="create"]', sheet).addEventListener('click', create);
      sheet.addEventListener('pointerdown', e => { if (e.target === sheet) close(); });
      sheet.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') create(); });
      root.append(sheet); upd(); icons(sheet);
      setTimeout(() => $('input', sheet).select(), 50);
    }

    /* ---------------- workspace ---------------- */
    function openWorkspace(project, layerIds) {
      state = { p: project, assets: LIBRARY.map(a => ({ ...a })), layers: [], sel: null, t: 0, playing: false, uid: 1 };
      layerIds.forEach(id => addLayer(state.assets.find(a => a.id === id), 0, false));
      const el = h(`<div class="ae">
        <header class="topbar" data-drag>
          <div class="tb-brand">${'<span class="tb-pad"></span>'}<b>After Effects</b></div>
          <nav class="tb-menus">${['File', 'Edit', 'Composition', 'Layer', 'Effect', 'Animation', 'View', 'Window', 'Help'].map(m => `<button class="tb-m">${m}</button>`).join('')}</nav>
          <span class="tb-title">${esc(project.name)}.aep</span>
          <button class="icon-btn" data-act="home" aria-label="Back to home">${ic('house')}</button>
        </header>
        <div class="ae-grid">
          <section class="panel p-project">
            <div class="ptabs"><button aria-selected="true">Project</button><button>Assets</button><span class="uline"></span></div>
            <div class="drop" tabindex="0">${ic('download')}<b>Drag &amp; Drop Media</b><small>Images or videos from your computer</small></div>
            <div class="assets"></div>
            <button class="btn btn-secondary btn-sm import">${ic('folder')}Import Files…</button>
            <input type="file" accept="image/*,video/*" multiple hidden>
          </section>
          <section class="panel p-comp">
            <div class="ptabs"><button aria-selected="true">Composition: Comp 1</button><span class="uline"></span></div>
            <div class="stage"><canvas></canvas><div class="empty stage-empty">${ic('image')}<p>Drag an asset here to preview it</p></div></div>
            <div class="transport">
              <span class="chip mono">${project.w}×${project.h}</span>
              <div class="tp-mid"><button class="icon-btn" data-act="start" aria-label="Go to start">${ic('skip-back')}</button><button class="icon-btn play" data-act="play" aria-label="Play">${ic('play')}</button><button class="icon-btn" data-act="end" aria-label="Go to end">${ic('skip-forward')}</button></div>
              <span class="chip mono tc">0:00:00:00</span>
            </div>
          </section>
          <section class="panel p-props">
            <div class="ptabs"><button aria-selected="true" data-v="props">Properties</button><button data-v="fx">Effects &amp; Presets</button><span class="uline"></span></div>
            <div class="props-body"></div>
          </section>
          <section class="panel p-tl">
            <div class="tl-top">
              <div class="tl-time"><b class="mono tc">0:00:00:00</b><small>(${project.fps.toFixed(2)} fps)</small></div>
              <label class="search mini">${ic('search')}<input placeholder="Search layers" aria-label="Search layers"></label>
            </div>
            <div class="tl-body">
              <div class="tl-left"><div class="tl-colhead"><span>${ic('eye')}</span><span>#</span><span>Layer Name</span></div><div class="tl-rows"></div></div>
              <div class="tl-right">
                <div class="ruler"></div>
                <div class="tracks"><div class="tl-empty empty">${ic('clapperboard')}<p>Drag &amp; drop a layer here</p></div></div>
                <div class="playhead"><span></span></div>
              </div>
            </div>
          </section>
        </div>
      </div>`);
      swap(root, el);
      workspace = buildWorkspace(el);
      shell.refreshMenus();
    }

    function addLayer(asset, at = 0, select = true) {
      const L = { id: state.uid++, asset, name: asset.name, type: asset.type, color: asset.color, in: at, out: Math.min(state.p.dur, at + asset.dur), x: 0, y: 0, scale: 100, rot: 0, opacity: 100, on: true, anim: asset.type === 'text' ? 'pop' : null };
      state.layers.unshift(L);
      if (select) state.sel = L.id;
      return L;
    }

    function buildWorkspace(el) {
      const p = state.p;
      const canvas = $('canvas', el), ctx = canvas.getContext('2d');
      const stage = $('.stage', el), tracks = $('.tracks', el), rows = $('.tl-rows', el), ruler = $('.ruler', el), ph = $('.playhead', el);
      const tlRight = $('.tl-right', el), propsBody = $('.props-body', el);
      let propsTab = 'props', filter = '';

      // underline tabs
      $$('.ptabs', el).forEach(t => {
        const u = $('.uline', t), btns = $$('button', t);
        const place = b => { u.style.width = b.offsetWidth + 'px'; u.style.transform = `translateX(${b.offsetLeft}px)`; };
        btns.forEach(b => b.addEventListener('click', () => { btns.forEach(x => x.setAttribute('aria-selected', x === b)); place(b); if (t.closest('.p-props')) { propsTab = b.dataset.v; renderProps(); } if (t.closest('.p-project')) { $('.drop', el).hidden = b.textContent !== 'Project'; } }));
        new ResizeObserver(() => place(btns.find(b => b.getAttribute('aria-selected') === 'true'))).observe(t);
      });

      // menus in the app's own top bar mirror the menu bar
      $$('.tb-m', el).forEach(b => b.addEventListener('click', () => {
        const items = api.menus()[b.textContent];
        if (items) showMenu(b, items);
      }));
      $('[data-act="home"]', el).addEventListener('click', () => { home(); shell.refreshMenus(); });

      /* ---------- assets ---------- */
      const assetsEl = $('.assets', el);
      function renderAssets() {
        assetsEl.replaceChildren(...state.assets.map(a => {
          const r = h(`<div class="asset" data-id="${a.id}">${ic(a.icon)}<span>${esc(a.name)}</span><small class="mono">${a.dur}s</small></div>`);
          r.style.setProperty('--c', a.color);
          dragAsset(r, a);
          return r;
        }));
        icons(assetsEl);
      }
      const fileInput = $('input[type=file]', el);
      $('.import', el).addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => importFiles(fileInput.files));
      function importFiles(files) {
        [...files].forEach(f => {
          const url = URL.createObjectURL(f);
          const isVid = f.type.startsWith('video');
          const a = { id: 'f' + state.uid++, name: f.name, type: isVid ? 'video' : 'image', dur: 5, icon: isVid ? 'film' : 'image', color: '#34d399' };
          if (isVid) { const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.addEventListener('loadedmetadata', () => { a.dur = Math.max(1, Math.min(p.dur, Math.round(v.duration))); renderAssets(); }); a.media = v; }
          else { const img = new Image(); img.onload = () => draw(); img.src = url; a.media = img; }
          state.assets.push(a);
        });
        renderAssets(); toast(`Imported ${files.length} file${files.length > 1 ? 's' : ''}`);
      }
      // real files from the OS
      ['dragover', 'drop'].forEach(type => el.addEventListener(type, e => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        if (type === 'drop') importFiles(e.dataTransfer.files);
      }));

      // pointer-based drag of library assets onto the comp or the timeline (works inside the 3D scene too)
      function dragAsset(row, a) {
        row.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          const sx = e.clientX, sy = e.clientY; let ghost = null;
          row.setPointerCapture(e.pointerId);
          const move = ev => {
            if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            if (!ghost) { ghost = h(`<div class="ghost glass">${ic(a.icon)}${esc(a.name)}</div>`); document.body.append(ghost); icons(ghost); }
            ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
            const over = document.elementFromPoint(ev.clientX, ev.clientY);
            stage.classList.toggle('drop-hot', !!over?.closest('.stage'));
            tlRight.classList.toggle('drop-hot', !!over?.closest('.tl-right'));
          };
          const up = ev => {
            row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up);
            stage.classList.remove('drop-hot'); tlRight.classList.remove('drop-hot');
            if (!ghost) { // plain click: select the matching layer if any
              const L = state.layers.find(l => l.asset === a); if (L) { state.sel = L.id; renderAll(); }
              return;
            }
            const over = document.elementFromPoint(ev.clientX, ev.clientY);
            if (over?.closest('.stage')) { addLayer(a, state.t); renderAll(); ghost.remove(); }
            else if (over?.closest('.tl-right')) { addLayer(a, Math.max(0, Math.min(p.dur - 1, timeAt(ev.clientX)))); renderAll(); ghost.remove(); }
            else { // fly back
              const r = row.getBoundingClientRect();
              ghost.animate([{ transform: ghost.style.transform, opacity: 1 }, { transform: `translate(${r.left}px, ${r.top}px)`, opacity: 0 }], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).finished.then(() => ghost.remove());
            }
          };
          row.addEventListener('pointermove', move); row.addEventListener('pointerup', up);
        });
      }

      /* ---------- timeline ---------- */
      const fr = 1 / p.fps;
      const timeAt = x => { const r = tracks.getBoundingClientRect(); return Math.round(((x - r.left) / r.width) * p.dur / fr) * fr; };
      for (let s = 0; s <= p.dur; s += p.dur > 10 ? 3 : 2) ruler.append(h(`<span class="tick" style="left:${s / p.dur * 100}%"><i>${String(s).padStart(2, '0')}s</i></span>`));
      const tc = t => { const f = Math.round(t * p.fps), s = Math.floor(f / p.fps); return `0:00:${String(s).padStart(2, '0')}:${String(f % p.fps).padStart(2, '0')}`; };

      function renderTimeline() {
        const list = state.layers.filter(L => L.name.toLowerCase().includes(filter));
        rows.replaceChildren(...list.map((L, i) => {
          const r = h(`<div class="tl-row ${L.id === state.sel ? 'sel' : ''}"><button class="eye" aria-label="Toggle visibility" aria-pressed="${L.on}">${ic(L.on ? 'eye' : 'eye-off')}</button><span class="chip-c" style="background:${L.color}"></span><span class="mono idx">${i + 1}</span><span class="nm">${esc(L.name)}</span></div>`);
          r.addEventListener('pointerdown', e => rowDrag(e, r, L, i));
          $('.eye', r).addEventListener('click', () => { L.on = !L.on; renderAll(); });
          return r;
        }));
        $$('.bar', tracks).forEach(b => b.remove());
        list.forEach((L, i) => {
          const b = h(`<div class="bar ${L.id === state.sel ? 'sel' : ''} ${L.on ? '' : 'off'}" data-id="${L.id}" style="top:${i * 30 + 4}px;left:${L.in / p.dur * 100}%;width:${(L.out - L.in) / p.dur * 100}%;--c:${L.color}"><i class="h l"></i><span>${esc(L.name)}</span>${L.anim ? '<em>◆</em>' : ''}<i class="h r"></i></div>`);
          barDrag(b, L);
          tracks.append(b);
        });
        $('.tl-empty', el).hidden = state.layers.length > 0;
        $('.stage-empty', el).hidden = state.layers.length > 0;
        icons(rows);
      }
      // Layer order: drag a row up/down in the layer list. Higher in the list = drawn in front (like After Effects).
      const ROW_H = 30;
      function rowDrag(e, r, L, from) {
        if (e.button !== 0 || e.target.closest('.eye')) return;
        state.sel = L.id;
        $$('.tl-row', rows).forEach(x => x.classList.toggle('sel', x === r));
        $$('.bar', tracks).forEach(x => x.classList.toggle('sel', +x.dataset.id === L.id));
        renderProps(); draw();
        if (filter) return; // reorder only when the full list is showing
        const rowEls = $$('.tl-row', rows), n = rowEls.length, sy = e.clientY;
        let to = from, dragging = false;
        r.setPointerCapture(e.pointerId);
        const move = ev => {
          const dy = ev.clientY - sy;
          if (!dragging && Math.abs(dy) < 4) return;
          if (!dragging) { dragging = true; r.classList.add('lifting'); }
          const clamped = Math.max(-from * ROW_H, Math.min((n - 1 - from) * ROW_H, dy));
          to = from + Math.round(clamped / ROW_H);
          r.style.transform = `translateY(${clamped}px)`;
          rowEls.forEach((x, j) => {
            if (x === r) return;
            const s = from < to && j > from && j <= to ? -ROW_H : from > to && j < from && j >= to ? ROW_H : 0;
            x.style.transform = s ? `translateY(${s}px)` : '';
          });
        };
        const up = () => {
          r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); r.removeEventListener('pointercancel', up);
          if (!dragging) return;
          if (to !== from) { const [m] = state.layers.splice(from, 1); state.layers.splice(to, 0, m); }
          renderAll();
        };
        r.addEventListener('pointermove', move); r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
      }
      function arrange(where) {
        const i = state.layers.findIndex(l => l.id === state.sel);
        if (i < 0) return toast('Select a layer first');
        const to = { front: 0, forward: Math.max(0, i - 1), backward: Math.min(state.layers.length - 1, i + 1), back: state.layers.length - 1 }[where];
        if (to === i) return;
        const [m] = state.layers.splice(i, 1); state.layers.splice(to, 0, m);
        renderAll();
      }

      function barDrag(b, L) {
        b.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          state.sel = L.id;
          const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
          const t0 = timeAt(e.clientX), i0 = L.in, o0 = L.out;
          b.setPointerCapture(e.pointerId);
          const move = ev => {
            const dt = timeAt(ev.clientX) - t0;
            if (mode === 'm') { const len = o0 - i0; L.in = Math.max(0, Math.min(p.dur - len, i0 + dt)); L.out = L.in + len; }
            if (mode === 'l') L.in = Math.max(0, Math.min(L.out - fr * 6, i0 + dt));
            if (mode === 'r') L.out = Math.min(p.dur, Math.max(L.in + fr * 6, o0 + dt));
            b.style.left = L.in / p.dur * 100 + '%'; b.style.width = (L.out - L.in) / p.dur * 100 + '%';
            draw();
          };
          const up = () => { b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); renderAll(); };
          b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
          renderProps();
          $$('.bar', tracks).forEach(x => x.classList.toggle('sel', x === b));
        });
      }
      // scrub the playhead from the ruler (or empty track space)
      const seek = x => { state.t = Math.max(0, Math.min(p.dur - fr, timeAt(x))); syncTime(); draw(); };
      [ruler, tracks].forEach(z => z.addEventListener('pointerdown', e => {
        if (e.target.closest('.bar')) return;
        if (z === tracks) { state.sel = null; renderAll(); }
        z.setPointerCapture(e.pointerId); seek(e.clientX);
        const mv = ev => seek(ev.clientX), up = () => { z.removeEventListener('pointermove', mv); z.removeEventListener('pointerup', up); };
        z.addEventListener('pointermove', mv); z.addEventListener('pointerup', up);
      }));
      $('.tl-top input', el).addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); renderTimeline(); });

      function syncTime() {
        ph.style.transform = `translateX(${state.t / p.dur * tracks.clientWidth}px)`;
        $$('.tc', el).forEach(x => { x.textContent = tc(state.t); });
      }
      new ResizeObserver(syncTime).observe(tracks);

      /* ---------- properties ---------- */
      function renderProps() {
        const L = state.layers.find(l => l.id === state.sel);
        if (propsTab === 'fx') {
          propsBody.replaceChildren(h(`<div class="fx-list">${PRESETS.map(pr => `<button class="fx" data-v="${pr.v}" ${L ? '' : 'disabled'}>${ic(pr.icon)}<span>${pr.label}</span>${L && L.anim === pr.v ? ic('check', 'class="ok"') : ''}</button>`).join('')}${L ? '' : '<p class="muted">Select a layer to apply a preset.</p>'}</div>`));
          $$('.fx', propsBody).forEach(b => b.addEventListener('click', () => { L.anim = b.dataset.v === 'null' ? null : b.dataset.v; state.t = L.in; syncTime(); renderAll(); toast(L.anim ? `${b.textContent.trim()} applied to ${L.name}` : 'Animation removed'); }));
          icons(propsBody); return;
        }
        if (!L) {
          propsBody.replaceChildren(h(`<div class="empty fill">${ic('sliders-horizontal')}<b>No Selection</b><p>Select a layer to view and edit its properties.</p></div>`));
          icons(propsBody); return;
        }
        const f = h(`<div class="props">
          <div class="pname"><span class="chip-c" style="background:${L.color}"></span><b>${esc(L.name)}</b></div>
          <h4>Transform</h4>
          <div class="num" data-k="x">Position X <b></b></div>
          <div class="num" data-k="y">Position Y <b></b></div>
          <div class="num" data-k="scale">Scale <b></b></div>
          <div class="num" data-k="rot">Rotation <b></b></div>
          <div class="num" data-k="opacity">Opacity <b></b></div>
          <h4>Timing</h4>
          <div class="kv"><span>In</span><b class="mono">${tc(L.in)}</b></div>
          <div class="kv"><span>Out</span><b class="mono">${tc(L.out)}</b></div>
          <div class="kv"><span>Animation</span><b>${L.anim ? PRESETS.find(x => x.v === L.anim).label : 'None'}</b></div>
          <h4>Layer Order</h4>
          <div class="arrange">
            <button class="btn btn-secondary btn-sm" data-ar="forward" title="Bring Forward (Ctrl+])">${ic('arrow-up')}Forward</button>
            <button class="btn btn-secondary btn-sm" data-ar="backward" title="Send Backward (Ctrl+[)">${ic('arrow-down')}Backward</button>
          </div>
          <button class="btn btn-ghost btn-sm del">${ic('trash-2')}Delete Layer</button>
        </div>`);
        const cfg = { x: { step: 2, digits: 0, suffix: ' px' }, y: { step: 2, digits: 0, suffix: ' px' }, scale: { step: .5, digits: 1, suffix: '%' }, rot: { step: .5, digits: 1, suffix: '°' }, opacity: { step: .5, digits: 0, suffix: '%' } };
        $$('.num', f).forEach(n => { const k = n.dataset.k; scrub(n, { ...cfg[k], get: () => L[k], set: v => { L[k] = k === 'opacity' ? Math.max(0, Math.min(100, v)) : k === 'scale' ? Math.max(1, v) : v; draw(); } }); });
        $('.del', f).addEventListener('click', () => deleteSel());
        $$('[data-ar]', f).forEach(b => b.addEventListener('click', () => arrange(b.dataset.ar)));
        propsBody.replaceChildren(f); icons(f);
      }
      function deleteSel() { if (!state.sel) return; state.layers = state.layers.filter(l => l.id !== state.sel); state.sel = null; renderAll(); }

      /* ---------- composition rendering ---------- */
      function fit() {
        const r = stage.getBoundingClientRect(), a = p.w / p.h, dpr = Math.min(devicePixelRatio, 1.5);
        let w = r.width - 24, hh = w / a; if (hh > r.height - 24) { hh = r.height - 24; w = hh * a; }
        canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
        draw();
      }
      new ResizeObserver(fit).observe(stage);

      function draw() {
        const W = canvas.width, H = canvas.height, t = state.t;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
        const k = W / p.w;
        [...state.layers].reverse().forEach(L => {
          if (!L.on || t < L.in || t >= L.out) return;
          const lt = t - L.in, e = L.anim ? easeOut(Math.min(1, lt / .6)) : 1;
          let op = L.opacity / 100, sc = L.scale / 100, dy = 0;
          if (L.anim === 'fade') op *= e;
          if (L.anim === 'slide') { op *= e; dy = (1 - e) * H * .08; }
          if (L.anim === 'pop') { op *= Math.min(1, lt / .25); sc *= .7 + .3 * backOut(Math.min(1, lt / .6)); }
          ctx.save();
          ctx.globalAlpha = op;
          ctx.translate(W / 2 + L.x * k, H / 2 + L.y * k + dy);
          ctx.rotate(L.rot * Math.PI / 180); ctx.scale(sc, sc);
          paint(L, lt, W, H);
          ctx.restore();
          if (L.id === state.sel && !state.playing) { ctx.save(); ctx.strokeStyle = 'rgba(181,123,255,.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(W / 2 + L.x * k - W * .3 * sc, H / 2 + L.y * k - H * .2 * sc, W * .6 * sc, H * .4 * sc); ctx.restore(); }
        });
      }
      function paint(L, lt, W, H) {
        if (L.type === 'text') {
          ctx.font = `700 ${H * .24}px Inter, sans-serif`; ctx.textBaseline = 'middle';
          const wMd = ctx.measureText('md').width, wDot = ctx.measureText('.').width, x0 = -(wMd + wDot) / 2;
          ctx.fillStyle = '#fff8f2'; ctx.fillText('md', x0, 0);
          ctx.fillStyle = '#ffb067'; ctx.fillText('.', x0 + wMd, 0);
        } else if (L.type === 'gradient') {
          const g = ctx.createLinearGradient(-W / 2, -H / 2, W / 2, H / 2);
          g.addColorStop(0, '#4d1805'); g.addColorStop(.5, '#e8670f'); g.addColorStop(1, '#2e0d03');
          ctx.fillStyle = g; ctx.fillRect(-W / 2, -H / 2, W, H);
          for (let i = 0; i < 3; i++) {
            const bx = Math.sin(lt * .6 + i * 2.1) * W * .3, by = Math.cos(lt * .5 + i * 1.7) * H * .25, r = H * (.45 + .1 * i);
            const rg = ctx.createRadialGradient(bx, by, 0, bx, by, r); rg.addColorStop(0, i === 1 ? 'rgba(255,214,173,.55)' : 'rgba(255,138,43,.5)'); rg.addColorStop(1, 'rgba(255,138,43,0)');
            ctx.fillStyle = rg; ctx.fillRect(-W / 2, -H / 2, W, H);
          }
        } else if (L.type === 'sweep') {
          const prog = (lt / (L.out - L.in)) * 1.6 - .3, x = (prog - .5) * W * 1.4;
          ctx.globalCompositeOperation = 'lighter'; ctx.rotate(-.35);
          const g = ctx.createLinearGradient(x - W * .15, 0, x + W * .15, 0);
          g.addColorStop(0, 'rgba(255,214,173,0)'); g.addColorStop(.5, 'rgba(255,236,210,.75)'); g.addColorStop(1, 'rgba(255,214,173,0)');
          ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 2, H * 2);
        } else if (L.type === 'particles') {
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 70; i++) {
            const hx = fract(Math.sin(i * 12.9898) * 43758.5), hy = fract(Math.sin(i * 78.233) * 12543.1), sp = .03 + hx * .06;
            const x = (hx - .5) * W, y = (((hy - lt * sp) % 1 + 1) % 1 - .5) * H, r = (1 + hy * 2.5) * W / 900;
            ctx.fillStyle = `rgba(255,${190 + (i % 3) * 20},140,${.35 + hy * .5})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
          }
        } else if ((L.type === 'image' || L.type === 'video') && L.asset.media) {
          const m = L.asset.media, mw = m.videoWidth || m.naturalWidth, mh = m.videoHeight || m.naturalHeight;
          if (!mw) return;
          if (L.type === 'video') { if (state.playing) { if (m.paused) m.play().catch(() => {}); if (Math.abs(m.currentTime - lt) > .3) m.currentTime = lt; } else { m.pause(); m.currentTime = lt; } }
          const s = Math.max(W / mw, H / mh); ctx.drawImage(m, -mw * s / 2, -mh * s / 2, mw * s, mh * s);
        }
      }

      /* ---------- transport ---------- */
      function setPlaying(on) {
        state.playing = on;
        const b = $('[data-act="play"]', el); b.innerHTML = ic(on ? 'pause' : 'play'); b.setAttribute('aria-label', on ? 'Pause' : 'Play'); icons(b);
        state.layers.forEach(L => { if (L.type === 'video' && !on) L.asset.media?.pause(); });
        cancelAnimationFrame(raf);
        if (on) { last = performance.now(); raf = requestAnimationFrame(loop); }
        draw();
      }
      function loop(now) {
        state.t += (now - last) / 1000; last = now;
        if (state.t >= p.dur) state.t = 0;
        syncTime(); draw();
        raf = requestAnimationFrame(loop);
      }
      $('[data-act="play"]', el).addEventListener('click', () => setPlaying(!state.playing));
      $('[data-act="start"]', el).addEventListener('click', () => { state.t = 0; syncTime(); draw(); });
      $('[data-act="end"]', el).addEventListener('click', () => { state.t = p.dur - fr; syncTime(); draw(); });

      function renderAll() { renderTimeline(); renderProps(); draw(); }
      renderAssets(); renderAll(); syncTime();
      return {
        togglePlay: () => setPlaying(!state.playing),
        step: d => { state.t = Math.max(0, Math.min(p.dur - fr, state.t + d * fr)); syncTime(); draw(); },
        start: () => { state.t = 0; syncTime(); draw(); },
        deleteSel, arrange, addLib: id => { addLayer(state.assets.find(a => a.id === id), state.t); renderAll(); },
        preset: v => { const L = state.layers.find(l => l.id === state.sel); if (!L) return toast('Select a layer first'); L.anim = v; state.t = L.in; syncTime(); renderAll(); },
        import: () => fileInput.click(),
        pause: () => state.playing && setPlaying(false),
      };
    }

    /* ---------------- shell api ---------------- */
    const api = {
      menus() {
        const w = workspace;
        return {
          File: [{ label: 'New Project…', kbd: '⌘N', action: newProjectSheet }, { label: 'Open Project…', kbd: '⌘O', action: () => openWorkspace({ name: 'intro_v3', w: 1920, h: 1080, fps: 24, dur: 10, bg: '#140602' }, RECENT[0].layers) },
            { label: 'Import File…', kbd: '⌘I', disabled: !w, action: () => w.import() }, 'sep', { label: 'Close Project', disabled: !w, action: () => { home(); shell.refreshMenus(); } }],
          Edit: [{ label: 'Undo', kbd: '⌘Z', disabled: true }, { label: 'Delete Layer', kbd: '⌫', disabled: !w, action: () => w.deleteSel() }],
          Composition: [{ label: 'Play / Pause', kbd: 'Space', disabled: !w, action: () => w.togglePlay() }, { label: 'Go to Start', kbd: 'Home', disabled: !w, action: () => w.start() }],
          Layer: [...LIBRARY.map(a => ({ label: `New ${a.name} Layer`, disabled: !w, action: () => w.addLib(a.id) })), 'sep',
            { label: 'Bring to Front', kbd: '⇧⌘]', disabled: !w, action: () => w.arrange('front') },
            { label: 'Bring Forward', kbd: '⌘]', disabled: !w, action: () => w.arrange('forward') },
            { label: 'Send Backward', kbd: '⌘[', disabled: !w, action: () => w.arrange('backward') },
            { label: 'Send to Back', kbd: '⇧⌘[', disabled: !w, action: () => w.arrange('back') }],
          Animation: PRESETS.filter(x => x.v).map(x => ({ label: x.label, disabled: !w, action: () => w.preset(x.v) })),
        };
      },
      onKey(e) {
        if (!workspace) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === ']' || e.key === '}')) { e.preventDefault(); workspace.arrange(e.shiftKey ? 'front' : 'forward'); }
        else if (mod && (e.key === '[' || e.key === '{')) { e.preventDefault(); workspace.arrange(e.shiftKey ? 'back' : 'backward'); }
        else if (e.key === ' ') { e.preventDefault(); workspace.togglePlay(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') workspace.deleteSel();
        else if (e.key === 'ArrowRight') workspace.step(1);
        else if (e.key === 'ArrowLeft') workspace.step(-1);
        else if (e.key === 'Home') workspace.start();
      },
      onHide() { workspace?.pause(); },
      unmount() { cancelAnimationFrame(raf); },
    };
    home();
    return api;
  },
};

const easeOut = x => 1 - Math.pow(1 - x, 3);
const backOut = x => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const fract = x => x - Math.floor(x);
