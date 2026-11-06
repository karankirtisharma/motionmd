// ComfyUI (fictional): launcher + node workflow editor with draggable nodes, typed ports, wires, pan/zoom and a fake "Run"
// that walks the graph and paints a procedural image into Preview Image.
import { h, $, $$, ic, icons, launcher, swap, toast, esc, showMenu, reduceMotion } from '../ui.js';

const TYPE_COLOR = { MODEL: 'var(--port-model)', CLIP: 'var(--port-clip)', CONDITIONING: 'var(--port-cond)', LATENT: 'var(--port-latent)', VAE: 'var(--port-vae)', IMAGE: 'var(--port-image)' };
const CKPTS = ['sdxl_base_1.0.safetensors', 'anime_mix_v3.safetensors', 'juggernaut_xl.safetensors'];
const SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'ddim'];
const SCHEDULERS = ['normal', 'karras', 'exponential', 'simple'];

// Node catalogue: inputs/outputs are typed; widgets hold values.
const DEFS = {
  ckpt: { title: 'Load Checkpoint', icon: 'box', w: 270, outputs: ['MODEL', 'CLIP', 'VAE'], widgets: [{ k: 'ckpt_name', kind: 'choice', options: CKPTS, v: CKPTS[0] }] },
  pos: { title: 'CLIP Text Encode (Prompt)', icon: 'box', w: 300, inputs: [['clip', 'CLIP']], outputs: ['CONDITIONING'], widgets: [{ k: 'text', kind: 'text', v: 'a cinematic anime girl, sunset sky, clouds, rim light, highly detailed' }] },
  neg: { title: 'CLIP Text Encode (Negative)', icon: 'box', w: 300, inputs: [['clip', 'CLIP']], outputs: ['CONDITIONING'], widgets: [{ k: 'text', kind: 'text', v: 'low quality, blurry, deformed, extra limbs, text, watermark' }] },
  latent: { title: 'Empty Latent Image', icon: 'square-dashed', w: 240, outputs: ['LATENT'], widgets: [{ k: 'width', kind: 'num', v: 1024, step: 64, min: 256, max: 2048 }, { k: 'height', kind: 'num', v: 1024, step: 64, min: 256, max: 2048 }] },
  ksampler: { title: 'KSampler', icon: 'box', w: 280, inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: ['LATENT'],
    widgets: [{ k: 'seed', kind: 'num', v: 1568437325, step: 1, min: 0, max: 4294967295 }, { k: 'steps', kind: 'num', v: 30, step: 1, min: 1, max: 80 }, { k: 'cfg', kind: 'num', v: 7, step: .5, min: 1, max: 20, digits: 1 },
      { k: 'sampler_name', kind: 'choice', options: SAMPLERS, v: 'euler' }, { k: 'scheduler', kind: 'choice', options: SCHEDULERS, v: 'normal' }, { k: 'denoise', kind: 'num', v: 1, step: .05, min: 0, max: 1, digits: 2 }] },
  vae: { title: 'VAE Decode', icon: 'box', w: 210, inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: ['IMAGE'] },
  preview: { title: 'Preview Image', icon: 'image', w: 270, inputs: [['images', 'IMAGE']], preview: true },
};

const RECENT = [
  { name: 'sdxl_generate.json', when: 'Today · 12 nodes', thumb: 'linear-gradient(180deg,#5a6070,#2a2d36 55%,#14161c)' },
  { name: 'anime_pipeline.json', when: 'Yesterday · 18 nodes', thumb: 'linear-gradient(180deg,#6b5bd6,#f08a6a 50%,#3b2a48 51%,#24182c)' },
  { name: 'upscale_flow.json', when: '3 days ago · 14 nodes', thumb: 'radial-gradient(60% 80% at 70% 50%,#ffd6ad,#b4470b 55%,#3a1606)' },
];

export const comfy = {
  id: 'cf', name: 'ComfyUI', icon: 'cf',
  mount(root, shell) {
    let editor = null;
    const l = launcher({
      id: 'cf', name: 'ComfyUI',
      nav: [{ v: 'home', label: 'Home', icon: 'house' }, { v: 'workflows', label: 'Workflows', icon: 'workflow' }, { v: 'models', label: 'Models', icon: 'layers' }, { v: 'extensions', label: 'Extensions', icon: 'puzzle' }, { v: 'settings', label: 'Settings', icon: 'settings' }],
      status: '<span class="dot"></span>Server Running<small>http://127.0.0.1:8188</small>',
      onNav: v => { if (v === 'home') home(); else if (v === 'workflows') openEditor('anime_generate.json'); else { toast(`${v[0].toUpperCase() + v.slice(1)} is coming soon`); } },
    });
    swap(root, l.el);

    function home() {
      editor?.dispose(); editor = null;
      const body = h(`<div class="lmain">
        <label class="search">${ic('search')}<input placeholder="Search workflows, models…" aria-label="Search workflows"></label>
        <div class="hero panel hero-split cf-hero">
          <div class="copy">
            <span class="eyebrow">Welcome to ComfyUI</span>
            <h1>Build AI Workflows<br>Your Way</h1>
            <p>A powerful, node-based interface for generative AI.</p>
            <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="new">${ic('plus')}New Workflow</button><button class="btn btn-secondary" data-act="open">${ic('folder')}Open Workflow</button></div>
          </div>
          <div class="hero-graph">
            <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <path class="hw" d="M116 86 C160 86 150 126 190 126"/><path class="hw" d="M-20 214 C100 214 150 142 190 142"/>
              <path class="hw" d="M262 124 C300 124 296 64 326 64"/><path class="hw" d="M262 142 C300 142 296 196 326 196"/>
              <path class="flow" d="M116 86 C160 86 150 126 190 126"/><path class="flow" d="M262 142 C300 142 296 196 326 196"/>
            </svg>
            <div class="hn" style="left:19.5%;top:33%;width:19%">${ic('image')}</div>
            <div class="hn" style="left:56.5%;top:51.5%;width:18%">${ic('sparkle')}</div>
            <div class="hn" style="left:89%;top:24.6%;width:15%">${ic('sliders-horizontal')}</div>
            <div class="hn" style="left:89%;top:75.4%;width:15%">${ic('image')}</div>
          </div>
        </div>
        <div class="sec-head"><h2>Recent Workflows</h2><button class="btn btn-ghost btn-sm">View All ${ic('arrow-right')}</button></div>
        <div class="cards"></div>
      </div>`);
      const cards = $('.cards', body);
      const render = q => cards.replaceChildren(...RECENT.filter(r => r.name.includes(q)).map(r => {
        const c = h(`<div class="card" role="button" tabindex="0"><div class="thumb" style="background:${r.thumb}"></div><div class="meta"><b>${r.name}</b><small>${r.when}</small></div><button class="icon-btn more" aria-label="More">${ic('ellipsis')}</button></div>`);
        c.addEventListener('click', e => { if (!e.target.closest('.more')) openEditor(r.name); });
        $('.more', c).addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'Open', action: () => openEditor(r.name) }, { label: 'Duplicate', action: () => toast(`Duplicated ${r.name}`) }, 'sep', { label: 'Remove from Recent', action: () => c.remove() }], { align: 'right' }));
        icons(c); return c;
      }));
      render('');
      $('input', body).addEventListener('input', e => render(e.target.value.trim()));
      $('[data-act="new"]', body).addEventListener('click', () => openEditor('untitled_workflow.json'));
      $('[data-act="open"]', body).addEventListener('click', () => openEditor('anime_generate.json'));
      swap(l.main, body);
      l.nav.select('home');
      shell.refreshMenus();
    }

    function openEditor(file) {
      editor?.dispose();
      l.nav.select('workflows');
      const el = h(`<div class="cf-ed">
        <header class="cf-top" data-drag>
          <div class="cf-tab"><span>${esc(file)}</span><button class="icon-btn" aria-label="Close workflow">${ic('x')}</button></div>
          <button class="icon-btn" data-act="newtab" aria-label="New workflow">${ic('plus')}</button>
          <div class="cf-top-r">
            <div class="split"><button class="btn btn-primary btn-sm" data-act="queue">${ic('play')}<span>Queue (0)</span></button><button class="btn btn-primary btn-sm caret" aria-label="Queue options">${ic('chevron-down')}</button></div>
            <button class="icon-btn" data-act="save" aria-label="Save">${ic('save')}</button>
          </div>
        </header>
        <section class="panel cf-canvas-panel">
          <div class="cf-tools">
            <button class="icon-btn" data-tool="select" aria-label="Select" aria-pressed="true">${ic('mouse-pointer-2')}</button>
            <button class="icon-btn" data-tool="pan" aria-label="Pan (hold Space)">${ic('hand')}</button>
            <button class="icon-btn" data-act="add" aria-label="Add node">${ic('square-plus')}</button>
            <button class="icon-btn" data-act="fit" aria-label="Fit view">${ic('scan')}</button>
            <div class="cf-tools-r"><button class="chip-btn" data-act="zoom"><span>100%</span>${ic('chevron-down')}</button></div>
          </div>
          <div class="cf-canvas" tabindex="0">
            <div class="world"><svg class="wires"><g class="links"></g><path class="temp" fill="none"/></svg></div>
            <div class="marquee" hidden></div>
          </div>
        </section>
        <footer class="panel cf-bottom">
          <div class="history"></div>
          <button class="icon-btn add-thumb" data-act="run1" aria-label="Generate">${ic('plus')}</button>
          <div class="cf-bottom-r">
            <div class="split"><button class="btn btn-primary run" data-act="run">${ic('play')}Run</button><button class="btn btn-primary caret" data-act="runmenu" aria-label="Run options">${ic('chevron-down')}</button></div>
            <div class="batch chip"><span class="mono">${ic('layers')}</span><b class="mono">1</b><span class="arrows"><button aria-label="More">▲</button><button aria-label="Fewer">▼</button></span></div>
          </div>
        </footer>
      </div>`);
      swap(l.main, el);
      editor = buildEditor(el, file);
      shell.refreshMenus();
    }

    /* =================== editor =================== */
    function buildEditor(el, file) {
      const canvasEl = $('.cf-canvas', el), world = $('.world', el), linksG = $('.links', el), temp = $('path.temp', el), marquee = $('.marquee', el);
      const view = { x: 0, y: 0, z: 1 };
      let nodes = [], links = [], uid = 1, tool = 'select', spaceDown = false;
      const sel = new Set();
      let selLink = null, nodeRO = null;

      /* ---------- graph construction ---------- */
      function addNode(type, x, y, values) {
        const d = DEFS[type];
        const n = { id: uid++, type, x, y, w: d.w, values: Object.fromEntries((d.widgets || []).map(w => [w.k, values?.[w.k] ?? w.v])) };
        nodes.push(n);
        n.el = renderNode(n);
        world.append(n.el);
        place(n);
        nodeRO?.observe(n.el);
        return n;
      }
      function link(a, out, b, input) {
        const type = DEFS[a.type].outputs[out];
        links = links.filter(L => !(L.b === b && L.in === input));
        links.push({ a, out, b, in: input, type });
      }
      // Every workflow (new ones too) starts as the complete text-to-image graph, like ComfyUI's default workflow.
      {
        const c = addNode('ckpt', 40, 20), p = addNode('pos', 40, 210), ng = addNode('neg', 40, 395), lt = addNode('latent', 420, 20);
        const k = addNode('ksampler', 420, 200), v = addNode('vae', 770, 250), pv = addNode('preview', 1040, 150);
        link(c, 0, k, 0); link(c, 1, p, 0); link(c, 1, ng, 0); link(p, 0, k, 1); link(ng, 0, k, 2); link(lt, 0, k, 3); link(k, 0, v, 0); link(c, 2, v, 1); link(v, 0, pv, 0);
      }

      function renderNode(n) {
        const d = DEFS[n.type];
        const rows = Math.max(d.inputs?.length || 0, d.outputs?.length || 0);
        let io = '';
        for (let i = 0; i < rows; i++) {
          const inp = d.inputs?.[i], out = d.outputs?.[i];
          io += `<div class="io">${inp ? `<span class="pin in" data-dir="in" data-i="${i}" data-type="${inp[1]}"><i class="port" style="--pc:${TYPE_COLOR[inp[1]]}"></i>${inp[0]}</span>` : '<span></span>'}${out ? `<span class="pin out" data-dir="out" data-i="${i}" data-type="${out}">${out}<i class="port" style="--pc:${TYPE_COLOR[out]}"></i></span>` : '<span></span>'}</div>`;
        }
        const widgets = (d.widgets || []).map(w => w.kind === 'text'
          ? `<textarea class="wtext" data-k="${w.k}" spellcheck="false" rows="3">${esc(n.values[w.k])}</textarea>`
          : `<div class="widget" data-k="${w.k}"><button class="arr" data-d="-1" aria-label="Decrease ${w.k}">${ic('chevron-left')}</button><span class="wk">${w.k}</span><b class="wv"></b><button class="arr" data-d="1" aria-label="Increase ${w.k}">${ic('chevron-right')}</button></div>`).join('');
        const el = h(`<div class="node" data-id="${n.id}" style="width:${n.w}px">
          <header class="nh">${ic(d.icon)}<span>${d.title}</span><i class="prog"></i></header>
          <div class="nb">${io}${widgets}${d.preview ? '<div class="pv"><canvas width="512" height="512"></canvas><div class="pv-empty">No image yet<br><small>Press Run</small></div><small class="pv-size mono">—</small></div>' : ''}</div>
        </div>`);
        // widgets
        $$('.widget', el).forEach(wd => {
          const w = d.widgets.find(x => x.k === wd.dataset.k);
          const show = () => { const v = n.values[w.k]; $('.wv', wd).textContent = w.kind === 'choice' ? v : (w.digits ? v.toFixed(w.digits) : v); };
          $$('.arr', wd).forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            const dir = +b.dataset.d;
            if (w.kind === 'choice') { const i = w.options.indexOf(n.values[w.k]); n.values[w.k] = w.options[(i + dir + w.options.length) % w.options.length]; }
            else n.values[w.k] = Math.min(w.max, Math.max(w.min, +(n.values[w.k] + dir * w.step).toFixed(4)));
            show();
          }));
          $('.wv', wd).addEventListener('dblclick', e => {
            if (w.kind !== 'num') return;
            const inp = h(`<input class="wv-in" value="${n.values[w.k]}">`); const out = e.currentTarget; out.replaceWith(inp); inp.focus(); inp.select();
            const done = () => { const v = parseFloat(inp.value); if (!isNaN(v)) n.values[w.k] = Math.min(w.max, Math.max(w.min, v)); inp.replaceWith(out); show(); };
            inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') inp.blur(); });
            inp.addEventListener('blur', done, { once: true });
          });
          show();
        });
        $$('.wtext', el).forEach(t => { t.addEventListener('input', () => { n.values[t.dataset.k] = t.value; }); t.addEventListener('pointerdown', e => e.stopPropagation()); });
        icons(el);
        return el;
      }
      function place(n) { n.el.style.transform = `translate(${n.x}px, ${n.y}px)`; }
      function applyView() { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; $('[data-act="zoom"] span', el).textContent = Math.round(view.z * 100) + '%'; canvasEl.style.backgroundSize = `${20 * view.z}px ${20 * view.z}px`; canvasEl.style.backgroundPosition = `${view.x}px ${view.y}px`; }

      /* ---------- wires ---------- */
      // Port positions are measured once per node (relative to the node) and cached, so dragging never reads layout.
      function measurePorts(n) { // layout offsets (world units), unaffected by zoom or window animations
        n.ports = { in: [], out: [] };
        n.el.querySelectorAll('.pin').forEach(pin => {
          const p = pin.querySelector('.port');
          let x = p.offsetWidth / 2, y = p.offsetHeight / 2;
          for (let e = p; e && e !== n.el; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
          n.ports[pin.dataset.dir][+pin.dataset.i] = { x, y };
        });
      }
      function portPos(n, dir, i) {
        if (!n.ports) measurePorts(n);
        const p = n.ports[dir][i];
        return { x: n.x + p.x, y: n.y + p.y };
      }
      const curve = (a, b) => { const dx = Math.max(50, Math.abs(b.x - a.x) * .5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
      // Each link owns one <g> created once; redraws only update path data.
      function ensureLinkEl(L) {
        if (L.g) return;
        L.g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        L.g.innerHTML = '<path class="hit"/><path class="wire"/>';
        L.hit = L.g.firstChild; L.path = L.g.lastChild; L.path.style.stroke = TYPE_COLOR[L.type];
        L.hit.addEventListener('pointerdown', e => { e.stopPropagation(); selLink = L; sel.clear(); syncSel(); drawLinks(false); });
        linksG.append(L.g);
      }
      function drawLinks(full = true) {
        if (full) { // structure changed: drop stale wires and refresh which ports are filled
          [...linksG.children].forEach(g => { if (!links.some(L => L.g === g)) g.remove(); });
          $$('.pin.linked', world).forEach(p => p.classList.remove('linked'));
          links.forEach(L => { L.a.el.querySelector(`.pin.out[data-i="${L.out}"]`)?.classList.add('linked'); L.b.el.querySelector(`.pin.in[data-i="${L.in}"]`)?.classList.add('linked'); });
        }
        links.forEach(L => {
          ensureLinkEl(L);
          const d = curve(portPos(L.a, 'out', L.out), portPos(L.b, 'in', L.in));
          L.hit.setAttribute('d', d); L.path.setAttribute('d', d);
          L.path.classList.toggle('sel', L === selLink);
          L.path.classList.toggle('flowing', !!L.flow);
        });
      }
      // a node that changes size (fonts loading, preview image) re-measures its ports
      nodeRO = new ResizeObserver(entries => { entries.forEach(en => { const n = nodes.find(x => x.el === en.target); if (n) n.ports = null; }); drawLinks(false); });
      nodes.forEach(n => nodeRO.observe(n.el));

      /* ---------- selection ---------- */
      function syncSel() { nodes.forEach(n => n.el.classList.toggle('sel', sel.has(n))); }

      /* ---------- pointer handling on the canvas ---------- */
      const toWorld = (cx, cy) => { const r = canvasEl.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
      canvasEl.addEventListener('pointerdown', e => {
        if (e.target.closest('textarea, .widget, input')) return;
        const pin = e.target.closest('.pin'), nodeEl = e.target.closest('.node');
        canvasEl.setPointerCapture(e.pointerId);
        canvasEl.focus({ preventScroll: true });

        // pan: hand tool, space held, or middle button
        if (tool === 'pan' || spaceDown || e.button === 1) {
          const sx = e.clientX - view.x, sy = e.clientY - view.y; canvasEl.classList.add('panning');
          return track(ev => { view.x = ev.clientX - sx; view.y = ev.clientY - sy; applyView(); }, () => canvasEl.classList.remove('panning'));
        }
        // wiring: drag from an output, or pull an existing link off an input
        if (pin) {
          const n = nodes.find(x => x.id === +pin.closest('.node').dataset.id), i = +pin.dataset.i;
          let from;
          if (pin.dataset.dir === 'out') from = { n, i };
          else { const L = links.find(x => x.b === n && x.in === i); if (!L) return; links = links.filter(x => x !== L); drawLinks(); from = { n: L.a, i: L.out }; }
          const type = DEFS[from.n.type].outputs[from.i], start = portPos(from.n, 'out', from.i);
          temp.style.stroke = TYPE_COLOR[type]; canvasEl.classList.add('wiring'); canvasEl.dataset.wtype = type;
          return track(ev => { temp.setAttribute('d', curve(start, toWorld(ev.clientX, ev.clientY))); hover(ev, type); }, ev => {
            temp.setAttribute('d', ''); canvasEl.classList.remove('wiring'); clearHover();
            const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pin.in');
            if (!t) return;
            const tn = nodes.find(x => x.id === +t.closest('.node').dataset.id);
            if (t.dataset.type !== type) return toast(`Can't connect ${type} to ${t.dataset.type}`);
            if (tn === from.n) return;
            link(from.n, from.i, tn, +t.dataset.i); t.classList.remove('missing'); drawLinks();
          });
        }
        // node drag (moves the whole selection)
        if (nodeEl) {
          const n = nodes.find(x => x.id === +nodeEl.dataset.id);
          if (e.shiftKey) { sel.has(n) ? sel.delete(n) : sel.add(n); } else if (!sel.has(n)) { sel.clear(); sel.add(n); }
          selLink = null; syncSel(); drawLinks();
          world.append(...[...sel].map(s => s.el)); // bring to front
          const p0 = toWorld(e.clientX, e.clientY), starts = [...sel].map(s => ({ s, x: s.x, y: s.y }));
          nodeEl.classList.add('dragging');
          return track(ev => {
            const p = toWorld(ev.clientX, ev.clientY);
            starts.forEach(({ s, x, y }) => { s.x = Math.round(x + p.x - p0.x); s.y = Math.round(y + p.y - p0.y); place(s); });
            drawLinks(false); // fast path: only path data changes while dragging
          }, () => nodeEl.classList.remove('dragging'));
        }
        // empty canvas: marquee select
        if (!e.shiftKey) sel.clear();
        selLink = null; syncSel(); drawLinks();
        const r0 = canvasEl.getBoundingClientRect(), sx = e.clientX - r0.left, sy = e.clientY - r0.top;
        marquee.hidden = false; Object.assign(marquee.style, { left: sx + 'px', top: sy + 'px', width: '0px', height: '0px' });
        track(ev => {
          const x = ev.clientX - r0.left, y = ev.clientY - r0.top;
          const L = Math.min(x, sx), T = Math.min(y, sy), W = Math.abs(x - sx), H = Math.abs(y - sy);
          Object.assign(marquee.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
          const a = toWorld(L + r0.left, T + r0.top), b = toWorld(L + W + r0.left, T + H + r0.top);
          nodes.forEach(n => { const hit = n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.el.offsetHeight > a.y; if (hit) sel.add(n); else if (!e.shiftKey) sel.delete(n); });
          syncSel();
        }, () => { marquee.hidden = true; });
      });
      function track(move, up) {
        const mv = ev => move(ev);
        const fin = ev => { canvasEl.removeEventListener('pointermove', mv); canvasEl.removeEventListener('pointerup', fin); canvasEl.removeEventListener('pointercancel', fin); up?.(ev); };
        canvasEl.addEventListener('pointermove', mv); canvasEl.addEventListener('pointerup', fin); canvasEl.addEventListener('pointercancel', fin);
      }
      let hot = null;
      function hover(ev, type) {
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pin.in');
        if (hot && hot !== t) hot.classList.remove('ok', 'bad');
        hot = t; if (t) t.classList.add(t.dataset.type === type ? 'ok' : 'bad');
      }
      const clearHover = () => { hot?.classList.remove('ok', 'bad'); hot = null; };

      // wheel zooms around the cursor
      canvasEl.addEventListener('wheel', e => {
        if (e.target.closest('textarea')) return;
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .0015));
      }, { passive: false });
      function zoomAt(cx, cy, k) {
        const r = canvasEl.getBoundingClientRect(), z = Math.min(2, Math.max(.3, view.z * k)), px = cx - r.left, py = cy - r.top;
        view.x = px - (px - view.x) * z / view.z; view.y = py - (py - view.y) * z / view.z; view.z = z; applyView();
      }
      function fit(animate = true) {
        if (!nodes.length) return;
        const r = canvasEl.getBoundingClientRect(); if (!r.width) return;
        const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y)), x1 = Math.max(...nodes.map(n => n.x + n.w)), y1 = Math.max(...nodes.map(n => n.y + n.el.offsetHeight));
        const z = Math.min(1.2, Math.max(.3, Math.min((r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0))));
        const target = { z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z };
        if (!animate || reduceMotion) { Object.assign(view, target); return applyView(); }
        const s = { ...view }, t0 = performance.now();
        const stepAnim = now => { const k = Math.min(1, (now - t0) / 320), e = 1 - Math.pow(1 - k, 3); view.x = s.x + (target.x - s.x) * e; view.y = s.y + (target.y - s.y) * e; view.z = s.z + (target.z - s.z) * e; applyView(); if (k < 1) requestAnimationFrame(stepAnim); };
        requestAnimationFrame(stepAnim);
      }

      /* ---------- toolbar ---------- */
      const setTool = t => { tool = t; $$('[data-tool]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); canvasEl.classList.toggle('pan-tool', t === 'pan'); };
      $$('[data-tool]', el).forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
      $('[data-act="fit"]', el).addEventListener('click', () => fit());
      $('[data-act="zoom"]', el).addEventListener('click', e => { const r = canvasEl.getBoundingClientRect(); showMenu(e.currentTarget, [50, 75, 100, 125, 150].map(p => ({ label: p + '%', action: () => zoomAt(r.left + r.width / 2, r.top + r.height / 2, p / 100 / view.z) })).concat(['sep', { label: 'Fit to View', action: () => fit() }]), { align: 'right' }); });
      function addMenu(anchor) {
        const r = canvasEl.getBoundingClientRect(), c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
        showMenu(anchor, Object.entries(DEFS).map(([k, d]) => ({ label: d.title, action: () => { const n = addNode(k, Math.round(c.x - d.w / 2), Math.round(c.y - 60)); sel.clear(); sel.add(n); syncSel(); drawLinks(); } })));
      }
      $('[data-act="add"]', el).addEventListener('click', e => addMenu(e.currentTarget));
      $('.cf-tab .icon-btn', el).addEventListener('click', home);
      $('[data-act="newtab"]', el).addEventListener('click', () => openEditor('untitled_workflow.json'));
      $('[data-act="save"]', el).addEventListener('click', () => toast(`Saved ${file}`));
      $('.cf-top .caret', el).addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'Queue Prompt', action: () => run() }, { label: 'Queue Front', action: () => run() }, 'sep', { label: 'Clear Queue', action: () => { queue = 0; updQueue(); } }], { align: 'right' }));

      // batch count
      let batch = 1;
      const batchEl = $('.batch b', el);
      $$('.batch .arrows button', el).forEach((b, i) => b.addEventListener('click', () => { batch = Math.min(8, Math.max(1, batch + (i ? -1 : 1))); batchEl.textContent = batch; }));

      function deleteSelection() {
        if (selLink) { links = links.filter(L => L !== selLink); selLink = null; drawLinks(); return; }
        if (!sel.size) return;
        sel.forEach(n => { nodeRO.unobserve(n.el); n.el.remove(); });
        links = links.filter(L => !sel.has(L.a) && !sel.has(L.b));
        nodes = nodes.filter(n => !sel.has(n)); sel.clear(); drawLinks();
      }

      /* ---------- running the graph ---------- */
      let queue = 0, running = false;
      const history = $('.history', el);
      const updQueue = () => { $('[data-act="queue"] span', el).textContent = `Queue (${queue})`; };
      function validate() {
        const missing = [];
        nodes.forEach(n => (DEFS[n.type].inputs || []).forEach((inp, i) => { if (!links.some(L => L.b === n && L.in === i)) missing.push({ n, i, name: inp[0] }); }));
        $$('.pin.missing', world).forEach(p => p.classList.remove('missing'));
        missing.forEach(m => m.n.el.querySelector(`.pin.in[data-i="${m.i}"]`)?.classList.add('missing'));
        const out = nodes.find(n => n.type === 'preview');
        if (!out) return 'Add a Preview Image node';
        if (missing.length) return `${missing.length} input${missing.length > 1 ? 's are' : ' is'} not connected`;
        return null;
      }
      function order() { // nodes upstream of Preview, in dependency order
        const out = [], seen = new Set();
        const visit = n => { if (seen.has(n)) return; seen.add(n); links.filter(L => L.b === n).forEach(L => visit(L.a)); out.push(n); };
        nodes.filter(n => n.type === 'preview').forEach(visit);
        return out;
      }
      function run(times = batch) {
        const err = validate();
        if (err) return toast(err);
        queue += times; updQueue();
        if (!running) next();
      }
      function graphParams(seq) {
        const ks = seq.find(n => n.type === 'ksampler'), pos = seq.find(n => n.type === 'pos'), lat = seq.find(n => n.type === 'latent'), ck = seq.find(n => n.type === 'ckpt');
        return { seed: ks?.values.seed ?? 1, steps: ks?.values.steps ?? 20, cfg: ks?.values.cfg ?? 7, prompt: pos?.values.text ?? '', w: lat?.values.width ?? 1024, hgt: lat?.values.height ?? 1024, ckpt: ck?.values.ckpt_name ?? '' };
      }
      async function next() {
        if (!queue || !alive) { running = false; return; }
        running = true;
        const seq = order();
        const ks = seq.find(n => n.type === 'ksampler');
        const params = graphParams(seq);
        const img = paintImage(params);
        for (const n of seq) {
          if (!alive) return;
          n.el.classList.add('running');
          links.filter(L => L.b === n).forEach(L => { L.flow = true; }); drawLinks();
          if (n.type === 'ksampler') {
            const bar = $('.prog', n.el), total = Math.min(2200, params.steps * 55);
            await steps(total, p => { bar.style.transform = `scaleX(${p})`; seq.filter(x => x.type === 'preview').forEach(pv => drawPreview(pv, img, p * .85)); });
            bar.style.transform = 'scaleX(0)';
          } else if (n.type === 'preview') { drawPreview(n, img, 1); addHistory(img, n, params); await wait(200); }
          else await wait(n.type === 'ckpt' ? 380 : 220);
          n.el.classList.remove('running');
          links.forEach(L => { L.flow = false; }); drawLinks();
        }
        if (ks) { ks.values.seed = (ks.values.seed + 1) % 4294967296; ks.el.querySelector('.widget[data-k="seed"] .wv').textContent = ks.values.seed; } // control_after_generate: increment
        queue--; updQueue();
        next();
      }
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const steps = (ms, onP) => new Promise(r => { const t0 = performance.now(); const tick = () => { const p = Math.min(1, (performance.now() - t0) / ms); onP(p); p < 1 && alive ? setTimeout(tick, 40) : r(); }; tick(); });
      function drawPreview(n, img, p) {
        const c = $('.pv canvas', n.el), g = c.getContext('2d');
        $('.pv-empty', n.el).hidden = true;
        g.filter = p < 1 ? `blur(${(1 - p) * 18}px) saturate(${.4 + p * .6})` : 'none';
        g.drawImage(img, 0, 0, 512, 512); g.filter = 'none';
        if (p < 1) { // latent noise fading out as the sampler converges
          const id = g.getImageData(0, 0, 512, 512), a = id.data, amt = (1 - p) * 90;
          for (let i = 0; i < a.length; i += 4) { const nz = (Math.random() - .5) * amt; a[i] += nz; a[i + 1] += nz; a[i + 2] += nz; }
          g.putImageData(id, 0, 0);
        }
      }
      function addHistory(img, pv, prm) {
        const t = h(`<button class="hthumb" aria-label="Show generated image (seed ${prm.seed})"><img alt="" src="${img.toDataURL('image/jpeg', .8)}"></button>`);
        t.addEventListener('click', () => { const im = new Image(); im.onload = () => { const c = $('.pv canvas', pv.el); c.getContext('2d').drawImage(im, 0, 0, 512, 512); }; im.src = $('img', t).src; $$('.hthumb', history).forEach(x => x.classList.toggle('on', x === t)); });
        history.prepend(t);
        $$('.hthumb', history).forEach(x => x.classList.toggle('on', x === t));
        $('.pv-size', pv.el).textContent = `${prm.w} × ${prm.hgt} · seed ${prm.seed}`;
      }
      $('[data-act="run"]', el).addEventListener('click', () => run());
      $('[data-act="run1"]', el).addEventListener('click', () => run(1));
      $('[data-act="queue"]', el).addEventListener('click', () => run());
      $('[data-act="runmenu"]', el).addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'Run', kbd: '⌘↵', action: () => run() }, { label: 'Run ×4', action: () => run(4) }, 'sep', { label: 'Cancel Queue', action: () => { queue = Math.min(queue, 1); updQueue(); } }], { align: 'right' }));

      // initial layout
      let alive = true;
      requestAnimationFrame(() => { drawLinks(); fit(false); });
      applyView();

      // open with the last result already in the preview and history, not an empty "No image yet"
      const pv0 = nodes.find(n => n.type === 'preview');
      if (pv0) { const prm = graphParams(order()), img = paintImage(prm); drawPreview(pv0, img, 1); addHistory(img, pv0, prm); }

      return {
        dispose() { alive = false; nodeRO.disconnect(); },
        onKey(e) {
          if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
          else if (e.key === ' ' && !spaceDown) { e.preventDefault(); spaceDown = true; canvasEl.classList.add('pan-tool'); }
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
          else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); nodes.forEach(n => sel.add(n)); syncSel(); }
          else if (e.key === '.') fit();
          else if (e.key.toLowerCase() === 'h') setTool(tool === 'pan' ? 'select' : 'pan');
        },
        keyup(e) { if (e.key === ' ') { spaceDown = false; canvasEl.classList.toggle('pan-tool', tool === 'pan'); } },
        run, fit, deleteSelection, addMenu: () => addMenu($('[data-act="add"]', el)),
      };
    }

    const keyup = e => editor?.keyup(e);
    addEventListener('keyup', keyup);
    home();

    return {
      menus() {
        const d = !editor;
        return {
          Workflow: [{ label: 'New Workflow', action: () => openEditor('untitled_workflow.json') }, { label: 'Open Workflow…', action: () => openEditor('anime_generate.json') }, 'sep', { label: 'Save', kbd: '⌘S', disabled: d, action: () => toast('Saved') }, { label: 'Close Workflow', disabled: d, action: home }],
          Edit: [{ label: 'Delete Selection', kbd: '⌫', disabled: d, action: () => editor.deleteSelection() }],
          View: [{ label: 'Fit to View', kbd: '.', disabled: d, action: () => editor.fit() }],
          Nodes: [{ label: 'Add Node…', disabled: d, action: () => editor.addMenu() }],
          Queue: [{ label: 'Run', kbd: '⌘↵', disabled: d, action: () => editor.run() }],
        };
      },
      onKey(e) { editor?.onKey(e); },
      unmount() { editor?.dispose(); removeEventListener('keyup', keyup); },
    };
  },
};

/* ---------- procedural "generation": a painted landscape that follows the prompt and seed ---------- */
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function paintImage({ seed, prompt }) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), R = rng(seed), P = prompt.toLowerCase();
  const pal = P.includes('night') ? { sky: ['#0b1030', '#27346b', '#6a5aa8'], sun: '#f4f1ff', far: '#2a2d5a', near: '#11122a', glow: 'rgba(200,200,255,' }
    : P.includes('forest') ? { sky: ['#a7d3c9', '#f3d9a4', '#ffd38a'], sun: '#fff3c4', far: '#4f7d62', near: '#1f3b2c', glow: 'rgba(255,240,190,' }
    : P.includes('ocean') || P.includes('sea') ? { sky: ['#4c7fd1', '#9ec2f0', '#ffd4a8'], sun: '#fff6dc', far: '#3e6a9c', near: '#1d3d66', glow: 'rgba(255,230,190,' }
    : P.includes('cyber') || P.includes('neon') ? { sky: ['#14062b', '#5b1a7a', '#ff4fa3'], sun: '#ffd1f0', far: '#3a1258', near: '#12051f', glow: 'rgba(255,90,200,' }
    : { sky: ['#5a4bc4', '#e98a8a', '#ffc37a'], sun: '#fff1c9', far: '#7a4e7a', near: '#2c1a35', glow: 'rgba(255,200,140,' };
  const sky = g.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, pal.sky[0]); sky.addColorStop(.55, pal.sky[1]); sky.addColorStop(1, pal.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
  const sx = 120 + R() * 280, sy = 250 + R() * 60;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 230); glow.addColorStop(0, pal.glow + '.85)'); glow.addColorStop(1, pal.glow + '0)');
  g.fillStyle = glow; g.fillRect(0, 0, 512, 512);
  g.fillStyle = pal.sun; g.beginPath(); g.arc(sx, sy, 26 + R() * 14, 0, 7); g.fill();
  if (P.includes('night')) for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${R() * .8})`; g.fillRect(R() * 512, R() * 260, 1.4, 1.4); }
  // clouds lit from the sun side
  if (P.includes('cloud') || R() > .3) for (let i = 0; i < 9; i++) {
    const cx = R() * 560 - 24, cy = 40 + R() * 200, w = 70 + R() * 140;
    const cg = g.createLinearGradient(cx, cy - 20, cx, cy + 24); cg.addColorStop(0, 'rgba(255,240,230,.85)'); cg.addColorStop(1, 'rgba(160,110,170,.25)');
    g.fillStyle = cg;
    for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(cx + (j - 2) * w * .22, cy + Math.sin(j * 2 + i) * 6, w * .28, 16 + R() * 10, 0, 0, 7); g.fill(); }
  }
  // mountain layers
  const ridge = (base, amp, col, rough) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 512); let y = base;
    for (let x = 0; x <= 512; x += 8) { y += (R() - .5) * rough; y = Math.max(base - amp, Math.min(base + amp * .4, y)); g.lineTo(x, y); }
    g.lineTo(512, 512); g.closePath(); g.fill();
  };
  ridge(330, 60, pal.far, 14); ridge(380, 40, mix(pal.far, pal.near), 10);
  if (P.includes('ocean') || P.includes('sea') || P.includes('lake')) {
    const wg = g.createLinearGradient(0, 400, 0, 512); wg.addColorStop(0, pal.sky[2]); wg.addColorStop(1, pal.near);
    g.fillStyle = wg; g.fillRect(0, 400, 512, 112);
    for (let i = 0; i < 40; i++) { g.fillStyle = pal.glow + (.2 + R() * .4) + ')'; g.fillRect(sx - 40 + R() * 80, 410 + R() * 90, 20 + R() * 40, 1.5); }
  } else ridge(430, 30, pal.near, 6);
  // a figure on the hill when the prompt asks for a person
  if (/girl|boy|person|woman|man|character/.test(P)) {
    const fx = 160 + R() * 190, fy = 452;
    g.fillStyle = pal.near; g.strokeStyle = pal.glow + '.9)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(fx - 16, fy); g.quadraticCurveTo(fx - 12, fy - 52, fx - 6, fy - 66); g.lineTo(fx + 6, fy - 66); g.quadraticCurveTo(fx + 14, fy - 50, fx + 18, fy); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(fx, fy - 76, 11, 0, 7); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(fx - 8, fy - 82); g.quadraticCurveTo(fx - 26, fy - 60, fx - 30, fy - 46); g.lineTo(fx - 22, fy - 50); g.quadraticCurveTo(fx - 16, fy - 66, fx - 6, fy - 72); g.fill(); // hair in the wind
  }
  // soft grain + vignette
  const v = g.createRadialGradient(256, 256, 180, 256, 256, 380); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.35)');
  g.fillStyle = v; g.fillRect(0, 0, 512, 512);
  return c;
}
function mix(a, b) { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round((v + B[i]) / 2).toString(16).padStart(2, '0')).join(''); }
