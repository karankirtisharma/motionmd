// Blender (fictional): launcher + 3D workspace with a real Three.js viewport showing the md. text object.
// The viewport stays neutral charcoal; orange belongs only to the surrounding UI.
import { h, $, $$, ic, icons, launcher, swap, seg, scrub, toast, esc, showMenu, reduceMotion } from '../ui.js';

const FONT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json';
let lib = null; // lazily loaded three.js modules + font, shared by the launcher hero and the workspace
async function three() {
  if (lib) return lib;
  const [THREE, { OrbitControls }, { TransformControls }, { FontLoader }, { TextGeometry }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/controls/TransformControls.js'),
    import('three/addons/loaders/FontLoader.js'),
    import('three/addons/geometries/TextGeometry.js'),
  ]);
  const font = await new FontLoader().loadAsync(FONT_URL);
  lib = { THREE, OrbitControls, TransformControls, TextGeometry, font };
  return lib;
}
function mdGeometry({ THREE, TextGeometry, font }) {
  const g = new TextGeometry('md.', { font, size: 1, height: 0.36, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2); // centred, sitting on the floor
  return g;
}

const RECENT = [
  { name: 'studio_setup.blend', when: 'Today · 12.4 MB', thumb: 'radial-gradient(60% 70% at 40% 40%,#f3f1ee,#bdb8b2 55%,#8f8a84)' },
  { name: 'chair_model.blend', when: 'Yesterday · 8.7 MB', thumb: 'radial-gradient(40% 45% at 50% 55%,#e8670f,#7a2a07 60%,#2f3036 61%)' },
  { name: 'enviro_scene.blend', when: '3 days ago · 56.1 MB', thumb: 'linear-gradient(180deg,#7d6ad9,#e89a7a 55%,#3a3550 56%,#24223a)' },
];
const WORKSPACES = ['Layout', 'Modeling', 'Sculpting', 'UV Editing', 'Shading', 'Animation', 'Rendering', 'Compositing'];

export const blender = {
  id: 'bl', name: 'Blender', icon: 'bl',
  mount(root, shell) {
    let stopHero = null, ws = null, heroPaused = false;

    /* ---------------- launcher ---------------- */
    function home() {
      ws?.dispose(); ws = null;
      const body = h(`<div class="lmain">
        <div class="hero panel hero-split bl-hero">
          <div class="copy">
            <h1>Welcome to Blender</h1>
            <p>Create 3D models, animations, VFX and more.</p>
            <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="new">${ic('plus')}New File</button><button class="btn btn-secondary" data-act="open">${ic('folder')}Open…</button></div>
          </div>
          <div class="hero-3d"><canvas></canvas></div>
        </div>
        <div class="sec-head"><h2>Recent Files</h2><button class="btn btn-ghost btn-sm">View All ${ic('arrow-right')}</button></div>
        <div class="cards"></div>
      </div>`);
      const cards = $('.cards', body);
      RECENT.forEach(r => {
        const c = h(`<div class="card" role="button" tabindex="0"><div class="thumb" style="background:${r.thumb}"></div><div class="meta"><b>${r.name}</b><small>${r.when}</small></div><button class="icon-btn more" aria-label="More">${ic('ellipsis')}</button></div>`);
        c.addEventListener('click', e => { if (!e.target.closest('.more')) workspace(r.name); });
        $('.more', c).addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'Open', action: () => workspace(r.name) }, { label: 'Show in Folder', action: () => toast(`~/Projects/${r.name}`) }, 'sep', { label: 'Remove from Recent', action: () => c.remove() }], { align: 'right' }));
        cards.append(c);
      });
      $('[data-act="new"]', body).addEventListener('click', () => workspace('untitled.blend'));
      $('[data-act="open"]', body).addEventListener('click', () => workspace(RECENT[0].name));
      const l = launcher({
        id: 'bl', name: 'Blender',
        nav: [{ v: 'home', label: 'Home', icon: 'house' }, { v: 'new', label: 'New File', icon: 'plus' }, { v: 'open', label: 'Open…', icon: 'folder' }, 'sep',
          { v: 'recent', label: 'Recent', icon: 'clock' }, { v: 'learn', label: 'Learn', icon: 'graduation-cap' }, { v: 'community', label: 'Community', icon: 'users' }, { v: 'settings', label: 'Settings', icon: 'settings' }],
        status: '<span class="dot"></span>GPU ready',
        onNav: v => { if (v === 'new') workspace('untitled.blend'); else if (v === 'open') workspace(RECENT[0].name); else if (v !== 'home' && v !== 'recent') { toast(`${v[0].toUpperCase() + v.slice(1)} is coming soon`); } },
        body,
      });
      swap(root, l.el);
      startHero($('.hero-3d canvas', body));
      shell.refreshMenus();
    }

    // launcher hero: an orange wireframe md. turning slowly (UI decoration, so orange is allowed here)
    async function startHero(canvas) {
      stopHero?.();
      let alive = true; stopHero = () => { alive = false; };
      const L = await three(); if (!alive) return;
      const { THREE } = L;
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, .1, 50);
      cam.position.set(0, 1.0, 4.4); cam.lookAt(0, .5, 0);
      const geo = mdGeometry(L);
      const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, opacity: .22 }));
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffd6ad, transparent: true, opacity: .55 }));
      const grp = new THREE.Group(); grp.add(solid, wire); scene.add(grp);
      const fit = () => { const w = canvas.clientWidth, hh = canvas.clientHeight; if (!w) return; r.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); };
      const ro = new ResizeObserver(fit); ro.observe(canvas); fit();
      let last = 0;
      const loop = now => {
        if (!alive) { ro.disconnect(); r.dispose(); geo.dispose(); return; }
        requestAnimationFrame(loop);
        if (heroPaused || now - last < 33) return; last = now; // 30 fps is plenty for a slow turntable; nothing while minimised
        grp.rotation.y = reduceMotion ? -.5 : Math.sin(now / 4000) * .6 - .2;
        r.render(scene, cam);
      };
      requestAnimationFrame(loop);
    }

    /* ---------------- workspace ---------------- */
    function workspace(file) {
      stopHero?.(); stopHero = null;
      const el = h(`<div class="bl">
        <header class="topbar" data-drag>
          <div class="tb-brand"><span class="tb-pad"></span><b>Blender</b></div>
          <nav class="tb-menus">${['File', 'Edit', 'Render', 'Window', 'Help'].map(m => `<button class="tb-m">${m}</button>`).join('')}</nav>
          <div class="seg ws-tabs">${WORKSPACES.map((w, i) => `<button ${i ? '' : 'aria-selected="true"'}>${w}</button>`).join('')}</div>
          <span class="tb-title">${esc(file)}</span>
          <button class="icon-btn" data-act="home" aria-label="Back to home">${ic('house')}</button>
        </header>
        <div class="bl-grid">
          <section class="panel vp-panel">
            <div class="vp-head">
              <button class="chip-btn mode">${ic('box')}<span>Object Mode</span>${ic('chevron-down')}</button>
              <button class="tb-m" data-menu="View">View</button><button class="tb-m" data-menu="Select">Select</button><button class="tb-m" data-menu="Add">Add</button><button class="tb-m" data-menu="Object">Object</button>
              <span class="chip-btn">${ic('globe')}Global</span>
              <div class="shading">
                <button class="icon-btn" data-shade="wire" aria-label="Wireframe">${ic('globe')}</button>
                <button class="icon-btn" data-shade="solid" aria-label="Solid" aria-pressed="true">${ic('circle')}</button>
                <button class="icon-btn" data-shade="material" aria-label="Material preview">${ic('circle-dot')}</button>
              </div>
            </div>
            <div class="vp-body">
              <div class="toolbar">
                <button class="icon-btn" data-tool="select" aria-label="Select" aria-pressed="true">${ic('mouse-pointer-2')}</button>
                <button class="icon-btn" data-tool="translate" aria-label="Move (G)">${ic('move')}</button>
                <button class="icon-btn" data-tool="rotate" aria-label="Rotate (R)">${ic('rotate-3d')}</button>
                <button class="icon-btn" data-tool="scale" aria-label="Scale (S)">${ic('scaling')}</button>
              </div>
              <div class="viewport"><canvas class="gl"></canvas>
                <div class="vp-label"><b>User Perspective</b><span class="vp-sub">(1) Collection | md_logo</span></div>
                <canvas class="gizmo" width="96" height="96" aria-label="Navigation gizmo"></canvas>
                <div class="vp-nav">
                  <button class="icon-btn" data-nav="zoom" aria-label="Zoom in">${ic('zoom-in')}</button>
                  <button class="icon-btn" data-nav="pan" aria-label="Pan">${ic('hand')}</button>
                  <button class="icon-btn" data-nav="camera" aria-label="Camera view">${ic('video')}</button>
                  <button class="icon-btn" data-nav="grid" aria-label="Toggle grid" aria-pressed="true">${ic('grid-3x3')}</button>
                </div>
                <div class="vp-loading">Loading viewport…</div>
              </div>
            </div>
          </section>
          <aside class="bl-side">
            <section class="panel outliner">
              <div class="pane-head">${ic('list-tree')}<span>Scene Collection</span></div>
              <div class="tree"></div>
            </section>
            <section class="panel props">
              <div class="prop-tabs">${['wrench', 'box', 'camera', 'sun', 'settings-2'].map((n, i) => `<button class="icon-btn" ${i === 1 ? 'aria-pressed="true"' : ''}>${ic(n)}</button>`).join('')}</div>
              <div class="prop-body"></div>
            </section>
          </aside>
          <section class="panel bl-tl">
            <div class="tl-bar">
              <button class="tb-m">Playback</button><button class="tb-m">Keying</button><button class="tb-m">View</button><button class="tb-m">Marker</button>
              <div class="tp-mid">
                <button class="icon-btn" data-tp="key" aria-label="Insert keyframe (I)">${ic('diamond-plus')}</button>
                <button class="icon-btn" data-tp="start" aria-label="Jump to start">${ic('skip-back')}</button>
                <button class="icon-btn play" data-tp="play" aria-label="Play">${ic('play')}</button>
                <button class="icon-btn" data-tp="end" aria-label="Jump to end">${ic('skip-forward')}</button>
              </div>
              <span class="chip mono">Start 1</span><span class="chip mono">End 250</span>
            </div>
            <div class="frames"><div class="fr-ticks"></div><div class="keys"></div><div class="fr-head"><span class="mono">1</span></div></div>
          </section>
        </div>
      </div>`);
      swap(root, el);
      $('[data-act="home"]', el).addEventListener('click', home);
      $$('.tb-m[data-menu]', el).forEach(b => b.addEventListener('click', () => showMenu(b, api.menus()[b.dataset.menu])));
      $$('.tb-menus .tb-m', el).forEach(b => b.addEventListener('click', () => { const m = api.menus()[b.textContent]; if (m) showMenu(b, m); }));
      $$('.prop-tabs .icon-btn', el).forEach(b => b.addEventListener('click', () => $$('.prop-tabs .icon-btn', el).forEach(x => x.setAttribute('aria-pressed', x === b))));
      ws = buildWorkspace(el);
      shell.refreshMenus();
    }

    function buildWorkspace(el) {
      let alive = true, raf = 0, ctx = null;
      const ready = three().then(L => { if (alive) ctx = initViewport(L, el); });
      return {
        dispose() { alive = false; cancelAnimationFrame(raf); ctx?.dispose(); },
        get ctx() { return ctx; }, ready,
      };
    }

    function initViewport(L, el) {
      const { THREE, OrbitControls, TransformControls } = L;
      const canvas = $('canvas.gl', el), vp = $('.viewport', el);
      $('.vp-loading', el).remove();
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor(0x2b2b2b);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x2b2b2b, 14, 34);
      const camera = new THREE.PerspectiveCamera(38, 1, .05, 200);
      camera.position.set(2.7, 1.7, 3.6);
      const controls = new OrbitControls(camera, canvas);
      controls.target.set(0, .55, 0); controls.enableDamping = true; controls.dampingFactor = .12; controls.update();

      // lights (Blender-like solid shading)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(4, 6, 5); scene.add(key);

      // floor grid + axes (red X, green Y). Blender's Y axis runs along three's -Z.
      const grid = new THREE.GridHelper(60, 60, 0x3d3d3d, 0x353535); scene.add(grid);
      const axis = (a, b, c) => { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })); l.position.y = .002; scene.add(l); return l; };
      const axes = [axis(new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0), 0xe5484d), axis(new THREE.Vector3(0, 0, -30), new THREE.Vector3(0, 0, 30), 0x8bc34a)];

      // materials
      const mats = {
        solid: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: .62, metalness: 0 }),
        wire: new THREE.MeshBasicMaterial({ color: 0xb8b8b8, wireframe: true }),
        material: new THREE.MeshPhysicalMaterial({ color: 0xe9e6e2, roughness: .28, clearcoat: .6, clearcoatRoughness: .2 }),
      };
      let shade = 'solid';

      // selection outline: back faces pushed out along normals, drawn in Blender's selection orange
      const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffa033, side: THREE.BackSide });
      outlineMat.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.022;'); };

      // ---------- scene objects ----------
      const objects = [];
      function addObject(name, mesh, kind = 'mesh') {
        mesh.name = name;
        const o = { name, obj: mesh, kind, visible: true, keys: [] };
        if (kind === 'mesh') {
          const outline = new THREE.Mesh(mesh.geometry, outlineMat); outline.visible = false; mesh.add(outline); o.outline = outline;
        }
        scene.add(mesh); objects.push(o);
        return o;
      }
      const md = addObject('md_logo', new THREE.Mesh(mdGeometry(L), mats.solid));
      // default turntable animation so the timeline has something to play
      md.keys = [{ f: 1, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, { f: 250, p: [0, 0, 0], r: [0, Math.PI * 2, 0], s: [1, 1, 1] }];

      // camera object (black frustum, like Blender)
      const camObj = new THREE.Group();
      const camShape = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ConeGeometry(.42, .6, 4, 1, true).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -.3)), new THREE.LineBasicMaterial({ color: 0x111111 }));
      const camPick = new THREE.Mesh(new THREE.SphereGeometry(.45, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      camObj.add(camShape, camPick);
      camObj.position.set(6.5, 3.2, 6.5); camObj.lookAt(0, .55, 0);
      const cam = addObject('Camera', camObj, 'camera'); cam.pick = camPick; cam.lines = camShape;
      // light object
      const lightObj = new THREE.Group();
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 16, 12), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(.26, 24)), new THREE.LineBasicMaterial({ color: 0x111111 }));
      const lightPick = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      lightObj.add(bulb, ring, lightPick); lightObj.position.set(-3, 4.2, 2.2);
      const lit = addObject('Light', lightObj, 'light'); lit.pick = lightPick; lit.lines = ring;
      const tick = () => { ring.quaternion.copy(camera.quaternion); };

      // ---------- selection + transform gizmo ----------
      let sel = md, tool = 'select';
      const tc = new TransformControls(camera, canvas);
      tc.setSize(.85);
      scene.add(tc);
      tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
      tc.addEventListener('objectChange', () => { renderProps(); dirty = true; });
      tc.addEventListener('change', () => { dirty = true; });

      function select(o) {
        sel = o;
        objects.forEach(x => {
          if (x.outline) x.outline.visible = x === o && shade !== 'wire';
          if (x.lines) x.lines.material.color.set(x === o ? 0xffa033 : 0x111111);
          if (x.kind === 'light') bulb.material.color.set(x === o ? 0xffa033 : 0x111111);
        });
        if (o && tool !== 'select') tc.attach(o.obj); else tc.detach();
        $('.vp-sub', el).textContent = `(1) Collection | ${o ? o.name : '—'}`;
        renderTree(); renderProps(); dirty = true;
      }
      function setTool(t) {
        tool = t;
        $$('[data-tool]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
        if (t === 'select') tc.detach(); else { tc.setMode(t); if (sel) tc.attach(sel.obj); }
        dirty = true;
      }
      $$('[data-tool]', el).forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

      // click (not drag) to select
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      let down = null;
      canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
      canvas.addEventListener('pointerup', e => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || tc.dragging) return;
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const targets = objects.filter(o => o.visible).map(o => o.pick || o.obj);
        const hit = ray.intersectObjects(targets, false)[0];
        select(hit ? objects.find(o => (o.pick || o.obj) === hit.object) : null);
      });

      // ---------- shading ----------
      function setShade(s) {
        shade = s;
        objects.forEach(o => { if (o.kind === 'mesh') o.obj.material = mats[s]; });
        if (s === 'material' && !scene.environment) {
          import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
            const pm = new THREE.PMREMGenerator(renderer);
            scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; dirty = true;
          });
        }
        $$('[data-shade]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.shade === s));
        select(sel);
      }
      $$('[data-shade]', el).forEach(b => b.addEventListener('click', () => setShade(b.dataset.shade)));

      // ---------- view helpers ----------
      let anim = null;
      function flyTo(pos, target, ms = 380) {
        const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
        anim = now => {
          const k = Math.min(1, (now - start) / ms), e = reduceMotion ? 1 : 1 - Math.pow(1 - k, 3);
          camera.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e);
          if (k >= 1) anim = null;
        };
        dirty = true;
      }
      const viewAxis = (dir, label) => {
        const dist = camera.position.distanceTo(controls.target);
        flyTo(controls.target.clone().add(dir.clone().multiplyScalar(dist)), controls.target.clone());
        $('.vp-label b', el).textContent = label;
      };
      function frameSelected() {
        if (!sel) return;
        const box = new THREE.Box3().setFromObject(sel.obj), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length();
        const dir = camera.position.clone().sub(controls.target).normalize();
        flyTo(c.clone().add(dir.multiplyScalar(Math.max(2.5, r * 1.6))), c);
      }
      let panMode = false;
      $$('[data-nav]', el).forEach(b => b.addEventListener('click', () => {
        const n = b.dataset.nav;
        if (n === 'zoom') { const d = camera.position.clone().sub(controls.target).multiplyScalar(.75); flyTo(controls.target.clone().add(d), controls.target.clone(), 240); }
        if (n === 'pan') { panMode = !panMode; b.setAttribute('aria-pressed', panMode); controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; }
        if (n === 'camera') { flyTo(camObj.position.clone(), new THREE.Vector3(0, .55, 0)); $('.vp-label b', el).textContent = 'Camera Perspective'; }
        if (n === 'grid') { grid.visible = !grid.visible; axes.forEach(a => { a.visible = grid.visible; }); b.setAttribute('aria-pressed', grid.visible); dirty = true; }
      }));
      controls.addEventListener('start', () => { $('.vp-label b', el).textContent = 'User Perspective'; });

      // navigation gizmo: click an axis to look along it
      const gz = $('canvas.gizmo', el), gctx = gz.getContext('2d');
      const AX = [
        { v: new THREE.Vector3(1, 0, 0), c: '#e5484d', l: 'X', view: 'Right' }, { v: new THREE.Vector3(0, 0, -1), c: '#8bc34a', l: 'Y', view: 'Back' }, { v: new THREE.Vector3(0, 1, 0), c: '#3b82f6', l: 'Z', view: 'Top' },
        { v: new THREE.Vector3(-1, 0, 0), c: '#e5484d', view: 'Left' }, { v: new THREE.Vector3(0, 0, 1), c: '#8bc34a', view: 'Front' }, { v: new THREE.Vector3(0, -1, 0), c: '#3b82f6', view: 'Bottom' },
      ];
      let gzHits = [];
      function drawGizmo() {
        const inv = camera.quaternion.clone().invert();
        gctx.clearRect(0, 0, 96, 96);
        const pts = AX.map(a => { const v = a.v.clone().applyQuaternion(inv); return { ...a, x: 48 + v.x * 32, y: 48 - v.y * 32, z: v.z }; }).sort((a, b) => a.z - b.z);
        gzHits = pts;
        pts.forEach(p => {
          if (p.l) { gctx.strokeStyle = p.c; gctx.lineWidth = 2; gctx.beginPath(); gctx.moveTo(48, 48); gctx.lineTo(p.x, p.y); gctx.stroke(); }
          gctx.fillStyle = p.l ? p.c : p.c + '66';
          gctx.beginPath(); gctx.arc(p.x, p.y, p.l ? 9 : 7, 0, Math.PI * 2); gctx.fill();
          if (p.l) { gctx.fillStyle = p.l === 'Y' ? '#14210a' : '#fff'; gctx.font = '700 10px Inter, sans-serif'; gctx.textAlign = 'center'; gctx.textBaseline = 'middle'; gctx.fillText(p.l, p.x, p.y + .5); }
        });
      }
      gz.addEventListener('click', e => {
        const r = gz.getBoundingClientRect(), x = (e.clientX - r.left) * 96 / r.width, y = (e.clientY - r.top) * 96 / r.height;
        const hit = [...gzHits].reverse().find(p => Math.hypot(p.x - x, p.y - y) < 11);
        if (hit) viewAxis(hit.v.clone().add(new THREE.Vector3(0, 0, hit.v.y ? .0001 : 0)), `${hit.view} Orthographic`); // tiny z offset avoids gimbal lock looking straight down
      });

      // ---------- outliner ----------
      const tree = $('.tree', el);
      function renderTree() {
        tree.replaceChildren(h(`<div class="tr-row root">${ic('chevron-down')}${ic('folder')}<span>Collection</span></div>`), ...objects.map(o => {
          const r = h(`<div class="tr-row ${o === sel ? 'sel' : ''}"><span class="ind"></span>${ic(o.kind === 'mesh' ? 'shapes' : o.kind === 'camera' ? 'video' : 'lightbulb')}<span>${esc(o.name)}</span><button class="icon-btn eye" aria-label="Toggle visibility" aria-pressed="${o.visible}">${ic(o.visible ? 'eye' : 'eye-off')}</button></div>`);
          r.addEventListener('click', e => { if (!e.target.closest('.eye')) select(o); });
          $('.eye', r).addEventListener('click', () => { o.visible = !o.visible; o.obj.visible = o.visible; if (!o.visible && sel === o) select(null); else renderTree(); dirty = true; });
          return r;
        }));
        icons(tree);
      }

      // ---------- properties (Blender axes: X, Y = -three.z, Z = three.y) ----------
      const body = $('.prop-body', el);
      const B = { x: ['position', 'x', 1], y: ['position', 'z', -1], z: ['position', 'y', 1] };
      function renderProps() {
        if (!sel) { body.replaceChildren(h(`<div class="empty fill">${ic('box')}<p>Nothing selected</p></div>`)); icons(body); return; }
        if (body.dataset.for === sel.name && body.firstElementChild?.classList.contains('pgrid')) { body._fields?.forEach(f => f.render()); return; }
        body.dataset.for = sel.name;
        const f = h(`<div class="pgrid">
          <div class="obj-name">${ic(sel.kind === 'mesh' ? 'shapes' : sel.kind === 'camera' ? 'video' : 'lightbulb')}<b>${esc(sel.name)}</b></div>
          <details open><summary>${ic('chevron-right')}Transform</summary>
            <div class="xyz"><span>Location</span>${['x', 'y', 'z'].map(a => `<div class="num" data-g="loc" data-a="${a}">${a.toUpperCase()} <b></b></div>`).join('')}</div>
            <div class="xyz"><span>Rotation</span>${['x', 'y', 'z'].map(a => `<div class="num" data-g="rot" data-a="${a}">${a.toUpperCase()} <b></b></div>`).join('')}</div>
            <div class="xyz"><span>Scale</span>${['x', 'y', 'z'].map(a => `<div class="num" data-g="scl" data-a="${a}">${a.toUpperCase()} <b></b></div>`).join('')}</div>
          </details>
          ${['Relations', 'Visibility', 'Viewport Display', 'Custom Properties'].map(s => `<details><summary>${ic('chevron-right')}${s}</summary><p class="muted">No ${s.toLowerCase()} on this object.</p></details>`).join('')}
        </div>`);
        const o = sel.obj;
        body._fields = $$('.num', f).map(n => {
          const [prop, ax, sign] = B[n.dataset.a], g = n.dataset.g;
          if (g === 'loc') return scrub(n, { step: .01, digits: 3, suffix: ' m', get: () => o.position[ax] * sign, set: v => { o.position[ax] = v * sign; dirty = true; } });
          if (g === 'rot') return scrub(n, { step: .5, digits: 1, suffix: '°', get: () => THREE.MathUtils.radToDeg(o.rotation[ax]) * sign, set: v => { o.rotation[ax] = THREE.MathUtils.degToRad(v * sign); dirty = true; } });
          return scrub(n, { step: .005, digits: 3, get: () => o.scale[ax], set: v => { o.scale[ax] = Math.max(.01, v); dirty = true; } });
        });
        body.replaceChildren(f); icons(f);
      }

      // ---------- timeline: frames 1-250, keyframes, playback ----------
      const fr = $('.frames', el), ticks = $('.fr-ticks', el), keysEl = $('.keys', el), head = $('.fr-head', el);
      for (let f = 0; f <= 250; f += 10) ticks.append(h(`<span style="left:${(Math.max(f, 1) - 1) / 249 * 100}%"><i>${Math.max(f, 1)}</i></span>`));
      let frame = 1, playing = false, lastT = 0;
      const pct = f => (f - 1) / 249 * 100;
      function renderKeys() { keysEl.replaceChildren(...(sel?.keys || []).map(k => h(`<span class="kf" style="left:${pct(k.f)}%"></span>`))); }
      function evalKeys(o, f) {
        const k = o.keys; if (k.length < 2) return;
        let a = k[0], b = k[k.length - 1];
        for (let i = 0; i < k.length - 1; i++) if (f >= k[i].f && f <= k[i + 1].f) { a = k[i]; b = k[i + 1]; break; }
        const t = b.f === a.f ? 0 : Math.max(0, Math.min(1, (f - a.f) / (b.f - a.f)));
        const L3 = (x, y) => x.map((v, i) => v + (y[i] - v) * t);
        o.obj.position.fromArray(L3(a.p, b.p)); o.obj.rotation.fromArray(L3(a.r, b.r)); o.obj.scale.fromArray(L3(a.s, b.s));
      }
      function setFrame(f) {
        frame = Math.max(1, Math.min(250, Math.round(f)));
        head.style.left = pct(frame) + '%'; $('span', head).textContent = frame;
        objects.forEach(o => evalKeys(o, frame));
        renderProps(); dirty = true;
      }
      const frameAt = x => { const r = fr.getBoundingClientRect(); return 1 + (x - r.left) / r.width * 249; };
      fr.addEventListener('pointerdown', e => {
        fr.setPointerCapture(e.pointerId); setFrame(frameAt(e.clientX));
        const mv = ev => setFrame(frameAt(ev.clientX)), up = () => { fr.removeEventListener('pointermove', mv); fr.removeEventListener('pointerup', up); };
        fr.addEventListener('pointermove', mv); fr.addEventListener('pointerup', up);
      });
      function setPlaying(on) {
        playing = on; lastT = performance.now();
        const b = $('[data-tp="play"]', el); b.innerHTML = ic(on ? 'pause' : 'play'); icons(b);
      }
      function insertKey() {
        if (!sel) return toast('Select an object to key');
        const o = sel.obj, k = { f: frame, p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), s: o.scale.toArray() };
        sel.keys = sel.keys.filter(x => x.f !== frame).concat(k).sort((a, b) => a.f - b.f);
        renderKeys(); toast(`Keyframe inserted on frame ${frame}`);
      }
      $('[data-tp="play"]', el).addEventListener('click', () => setPlaying(!playing));
      $('[data-tp="start"]', el).addEventListener('click', () => setFrame(1));
      $('[data-tp="end"]', el).addEventListener('click', () => setFrame(250));
      $('[data-tp="key"]', el).addEventListener('click', insertKey);

      // ---------- workspace tabs + mode ----------
      let editMode = false, wireOverlay = null;
      function setEdit(on) {
        editMode = on;
        $('.mode span', el).textContent = on ? 'Edit Mode' : 'Object Mode';
        if (on && sel?.kind === 'mesh') {
          wireOverlay = new THREE.LineSegments(new THREE.WireframeGeometry(sel.obj.geometry), new THREE.LineBasicMaterial({ color: 0x0f0f0f, transparent: true, opacity: .55 }));
          sel.obj.add(wireOverlay);
        } else if (wireOverlay) { wireOverlay.parent?.remove(wireOverlay); wireOverlay.geometry.dispose(); wireOverlay = null; }
        dirty = true;
      }
      $('.mode', el).addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'Object Mode', action: () => setEdit(false) }, { label: 'Edit Mode', kbd: 'Tab', action: () => setEdit(true) }]));
      const wsTabs = seg($('.ws-tabs', el), w => {
        setEdit(w === 'Modeling');
        setShade(w === 'Shading' || w === 'Rendering' ? 'material' : 'solid');
        el.classList.toggle('anim-ws', w === 'Animation');
        if (w === 'Rendering') $('[data-nav="camera"]', el).click();
        requestAnimationFrame(fit);
      });

      // ---------- add / delete ----------
      let nAdded = 0;
      function addPrimitive(kind) {
        const geo = { Cube: () => new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), 'UV Sphere': () => new THREE.SphereGeometry(.6, 32, 16).translate(0, .6, 0), Torus: () => new THREE.TorusGeometry(.5, .18, 16, 48).rotateX(Math.PI / 2).translate(0, .18, 0), Cone: () => new THREE.ConeGeometry(.55, 1.1, 32).translate(0, .55, 0) }[kind]();
        const o = addObject(`${kind}${nAdded ? '.' + String(nAdded).padStart(3, '0') : ''}`, new THREE.Mesh(geo, mats[shade]));
        nAdded++;
        o.obj.position.set(2.6 + (nAdded % 3) * .3, 0, -1.2 - (nAdded % 4) * .4);
        select(o);
      }
      function deleteSel() {
        if (!sel) return;
        const o = sel; tc.detach(); scene.remove(o.obj);
        objects.splice(objects.indexOf(o), 1);
        select(null);
      }
      function duplicateSel() {
        if (!sel || sel.kind !== 'mesh') return;
        const o = addObject(`${sel.name}.001`, new THREE.Mesh(sel.obj.geometry, mats[shade]));
        o.obj.position.copy(sel.obj.position).add(new THREE.Vector3(.6, 0, .6)); o.obj.rotation.copy(sel.obj.rotation); o.obj.scale.copy(sel.obj.scale);
        select(o);
      }

      // ---------- render loop: only draws when something changed ----------
      let dirty = true, raf = 0, alive = true;
      function fit() {
        const r = vp.getBoundingClientRect(); if (!r.width) return;
        renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); dirty = true;
      }
      const ro = new ResizeObserver(fit); ro.observe(vp); fit();
      function loop(now) {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (anim) { anim(now); dirty = true; }
        if (playing) { // 24 fps clock that accumulates, so no frame is lost between display refreshes
          const adv = Math.floor((now - lastT) / 1000 * 24);
          if (adv >= 1) { lastT += adv / 24 * 1000; let f = frame + adv; if (f > 250) f = 1 + (f - 251) % 250; setFrame(f); }
        }
        if (controls.update()) dirty = true;
        if (!dirty || hidden) return;
        dirty = false;
        tick(); renderer.render(scene, camera); drawGizmo();
      }
      let hidden = false;
      raf = requestAnimationFrame(loop);
      controls.addEventListener('change', () => { dirty = true; });

      select(md); setFrame(1); renderKeys();
      const origSelect = select;
      // keep keyframe markers in sync with the selection
      select = o => { origSelect(o); renderKeys(); };

      return {
        dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); tc.dispose(); controls.dispose(); renderer.dispose(); },
        setHidden(v) { hidden = v; if (!v) dirty = true; },
        setTool, addPrimitive, deleteSel, duplicateSel, frameSelected, insertKey, setShade,
        togglePlay: () => setPlaying(!playing), setFrame: f => setFrame(f), frame: () => frame,
        selectAll: () => select(objects[0] || null), selectNone: () => select(null),
        view: v => ({ Front: () => viewAxis(new THREE.Vector3(0, 0, 1), 'Front Orthographic'), Right: () => viewAxis(new THREE.Vector3(1, 0, 0), 'Right Orthographic'), Top: () => viewAxis(new THREE.Vector3(0, 1, .0001), 'Top Orthographic') })[v](),
        toggleGrid: () => $('[data-nav="grid"]', el).click(),
        editToggle: () => { setEdit(!editMode); },
        tabs: wsTabs,
      };
    }

    /* ---------------- shell api ---------------- */
    const C = () => ws?.ctx;
    const api = {
      menus() {
        const c = C(), d = !c;
        return {
          File: [{ label: 'New', kbd: '⌘N', action: () => workspace('untitled.blend') }, { label: 'Open…', kbd: '⌘O', action: () => workspace(RECENT[0].name) }, 'sep', { label: 'Save', kbd: '⌘S', disabled: d, action: () => toast('Saved') }, { label: 'Close File', disabled: d, action: home }],
          Edit: [{ label: 'Undo', kbd: '⌘Z', disabled: true }, { label: 'Duplicate', kbd: '⇧D', disabled: d, action: () => c.duplicateSel() }, { label: 'Delete', kbd: 'X', disabled: d, action: () => c.deleteSel() }],
          View: [{ label: 'Frame Selected', kbd: '.', disabled: d, action: () => c.frameSelected() }, 'sep', { label: 'Front', kbd: '1', disabled: d, action: () => c.view('Front') }, { label: 'Right', kbd: '3', disabled: d, action: () => c.view('Right') }, { label: 'Top', kbd: '7', disabled: d, action: () => c.view('Top') }, 'sep', { label: 'Toggle Grid', disabled: d, action: () => c.toggleGrid() }],
          Select: [{ label: 'All', kbd: 'A', disabled: d, action: () => c.selectAll() }, { label: 'None', kbd: '⌥A', disabled: d, action: () => c.selectNone() }],
          Add: ['Cube', 'UV Sphere', 'Torus', 'Cone'].map(k => ({ label: k, disabled: d, action: () => c.addPrimitive(k) })),
          Object: [{ label: 'Duplicate', kbd: '⇧D', disabled: d, action: () => c.duplicateSel() }, { label: 'Delete', kbd: 'X', disabled: d, action: () => c.deleteSel() }, 'sep', { label: 'Insert Keyframe', kbd: 'I', disabled: d, action: () => c.insertKey() }],
          Render: [{ label: 'Render Image', kbd: 'F12', disabled: d, action: () => { c.setShade('material'); toast('Rendered with Material Preview'); } }],
        };
      },
      onKey(e) {
        const c = C(); if (!c) return;
        const k = e.key.toLowerCase();
        if (k === 'g') c.setTool('translate'); else if (k === 'r') c.setTool('rotate'); else if (k === 's') c.setTool('scale');
        else if (k === 'escape' || k === 'q') c.setTool('select');
        else if (k === 'x' || k === 'delete') c.deleteSel();
        else if (k === 'i') c.insertKey();
        else if (k === '.') c.frameSelected();
        else if (k === ' ') { e.preventDefault(); c.togglePlay(); }
        else if (k === 'tab') { e.preventDefault(); c.editToggle(); }
        else if (k === '1') c.view('Front'); else if (k === '3') c.view('Right'); else if (k === '7') c.view('Top');
        else if (k === 'arrowright') c.setFrame(c.frame() + 1); else if (k === 'arrowleft') c.setFrame(c.frame() - 1);
      },
      onHide() { heroPaused = true; C()?.setHidden(true); },
      onShow() { heroPaused = false; C()?.setHidden(false); },
      unmount() { stopHero?.(); ws?.dispose(); },
    };
    home();
    return api;
  },
};
