import { createCurvedInput } from './curvedInput.ts';
import { createStudioPaintSource } from './StudioPaintSource.ts';

type Options = {
  canvas: HTMLCanvasElement;
  aspect: number;
  onExpand: () => void;
  onFrame: (canvas: HTMLCanvasElement) => void;
  sampleSurface: (x: number, y: number) => { u: number; v: number } | null;
  onFocus: () => void;
};

/** One native Studio owns navigation, input and fullscreen. Only UI changes
 * repaint the texture on the mesh; camera movement never paints the document. */
export function createLiveStudioSurface(options: Options, makePainter = createStudioPaintSource) {
  const width = 1600, height = Math.round(width / options.aspect);
  const host = document.createElement('div');
  host.dataset.liveStudio = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`,
    transformOrigin: '0 0', overflow: 'hidden', background: '#241b13', zIndex: '2', visibility: 'hidden', opacity: '0', pointerEvents: 'none' });
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', color: '#f6f1e7', font: '20px sans-serif' });
  host.append(status);
  document.body.append(host);
  let frame: HTMLIFrameElement | undefined, painter: ReturnType<typeof makePainter> | undefined;
  let transform = 'none', visible = false, interactive = false, expanded = false, ready = false;
  let painted = false, paintFailed = false, disposed = false, suspended: boolean | undefined;
  let animation: Animation | undefined, transition = 0, inputEnabled = false;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const input = createCurvedInput({ canvas: options.canvas, host, getFrame: () => frame, width, height,
    hit: (x, y) => { const uv = options.sampleSurface(x, y); return uv ? { x: uv.u, y: uv.v } : null; }, onFocus: options.onFocus });
  const post = (type: string, extra = {}) => frame?.contentWindow?.postMessage({ type, ...extra }, location.origin);

  function sync() {
    host.style.visibility = expanded || visible || animation ? 'visible' : 'hidden';
    painter?.setVisible(visible && !expanded && !document.hidden);
    const enable = visible && interactive && painted && !expanded && !animation && !paintFailed && !document.hidden;
    if (enable !== inputEnabled) { inputEnabled = enable; input.setEnabled(enable); }
    if (!expanded && !animation) { host.style.opacity = '0'; if (!enable) host.style.pointerEvents = 'none'; }
    if (frame) frame.tabIndex = expanded || enable ? 0 : -1;
    const next = document.hidden || !(expanded || visible);
    if (next !== suspended && ready) { suspended = next; post(next ? 'md-studio:suspend' : 'md-studio:resume'); }
  }

  function failed(error: Error) {
    if (disposed || paintFailed) return;
    paintFailed = true;
    host.dataset.paintState = 'fallback';
    console.warn('Studio TV paint unavailable', error);
    // Browsers that cannot export this document can still open the native
    // session by clicking the physical screen. Keep a legible affordance.
    const card = document.createElement('canvas');
    card.width = width; card.height = height;
    const ctx = card.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#36241b'; ctx.fillRect(0, 0, width, height);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f6efdf'; ctx.font = '54px Georgia';
      ctx.fillText('Motion Design Studio', width / 2, height / 2);
      ctx.font = '24px sans-serif'; ctx.fillText('Open the studio', width / 2, height / 2 + 56);
      options.onFrame(card);
    }
    sync();
  }

  function ensurePainter() {
    const doc = frame?.contentDocument;
    if (painter || paintFailed || !ready || disposed || !doc?.querySelector('#md-studio-root')) return;
    try {
      painter = makePainter({ document: doc, width, height, onPaint: canvas => {
        if (disposed || expanded) return;
        options.onFrame(canvas);
        if (!painted) { painted = true; host.dataset.paintState = 'live'; sync(); }
      }, onError: failed });
      sync();
    } catch (error) { failed(error instanceof Error ? error : new Error(String(error))); }
  }

  function receive(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'md-studio:ready') {
      ready = true; clearTimeout(loadTimer); status.style.display = 'none'; suspended = undefined;
      post('md-studio:display', { expanded }); ensurePainter(); sync();
    } else if (event.data?.type === 'md-studio:expand' && interactive) options.onExpand();
    else if (event.data?.type === 'md-studio:exit' && !expanded) input.focusRoom();
  }

  function load() {
    if (!frame || disposed) return;
    clearTimeout(loadTimer); painter?.dispose(); painter = undefined;
    painted = paintFailed = ready = false; suspended = undefined;
    host.dataset.paintState = 'loading';
    status.textContent = 'Opening the studio…'; status.style.display = 'grid';
    frame.src = '/studio?embed=lounge&display=tv&f=1&i=3';
    loadTimer = setTimeout(() => {
      if (ready || disposed) return;
      status.textContent = 'The studio is taking longer to load. ';
      const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = load; status.append(retry);
    }, 20000);
  }

  function ensureFrame() {
    if (frame) return;
    frame = document.createElement('iframe'); frame.dataset.liveStudioFrame = '';
    frame.title = 'Interactive Motion Design studio on the presentation screen'; frame.allowFullscreen = true;
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => { input.refreshFrame(); post('md-studio:display', { expanded }); ensurePainter(); sync(); });
    host.prepend(frame); input.refreshFrame(); load();
  }

  function clickFallback(event: MouseEvent) {
    if (!interactive || expanded || !visible || (!paintFailed && ready)) return;
    if (options.sampleSurface(event.clientX, event.clientY)) { event.preventDefault(); options.onExpand(); }
  }

  function layout(event: Event) {
    const detail = (event as CustomEvent<{ open: boolean; reducedMotion: boolean }>).detail;
    if (!detail || disposed || expanded === detail.open) return;
    const version = ++transition;
    animation?.cancel(); expanded = detail.open;
    ensureFrame(); options.onFocus(); input.setExpanded(true);
    host.style.zIndex = '1000'; host.style.width = `${width}px`; host.style.height = `${height}px`;
    host.style.visibility = 'visible'; host.style.pointerEvents = 'auto'; host.style.clipPath = 'none';
    host.setAttribute('role', expanded ? 'dialog' : 'region');
    host.setAttribute('aria-label', expanded ? 'Motion Design studio' : 'Interactive presentation screen');
    if (expanded) host.setAttribute('aria-modal', 'true'); else host.removeAttribute('aria-modal');
    const full = `matrix3d(${innerWidth / width},0,0,0,0,${innerHeight / height},0,0,0,0,1,0,0,0,0,1)`;
    if (!expanded) post('md-studio:display', { expanded: false });
    const destination = expanded ? full : transform;
    host.style.transform = destination; host.style.opacity = expanded ? '1' : '0';
    animation = host.animate([{ transform: expanded ? transform : full, opacity: expanded ? 0 : 1 },
      { transform: destination, opacity: expanded ? 1 : 0 }],
      { duration: detail.reducedMotion ? 0 : 560, easing: 'cubic-bezier(.22,.68,0,1)' });
    sync();
    if (!expanded) painter?.invalidate();
    animation.finished.then(() => {
      if (disposed || version !== transition) return;
      animation = undefined;
      if (expanded) {
        host.style.width = '100vw'; host.style.height = '100dvh'; host.style.transform = 'none'; host.style.opacity = '1'; frame?.focus();
        post('md-studio:display', { expanded: true });
      } else {
        host.style.zIndex = '2'; host.style.opacity = '0'; host.style.pointerEvents = 'none';
        input.setExpanded(false); input.focusRoom();
      }
      sync();
      window.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open: expanded } }));
    }).catch(() => {});
  }

  options.canvas.addEventListener('click', clickFallback);
  window.addEventListener('message', receive);
  window.addEventListener('md-studio:layout', layout);
  document.addEventListener('visibilitychange', sync);
  return {
    width, height,
    update(inView: boolean, expandMatrix?: number[] | null) {
      if (expandMatrix) transform = `matrix3d(${expandMatrix.join(',')})`;
      if (visible !== inView) { visible = inView; if (visible) ensureFrame(); sync(); }
      input.updateCamera();
    },
    setInteractive(value: boolean) { if (value !== interactive) { interactive = value; sync(); } },
    dispose() {
      if (disposed) return;
      disposed = true; transition++; animation?.cancel(); clearTimeout(loadTimer);
      input.dispose(); painter?.dispose();
      options.canvas.removeEventListener('click', clickFallback);
      window.removeEventListener('message', receive);
      window.removeEventListener('md-studio:layout', layout);
      document.removeEventListener('visibilitychange', sync);
      host.remove();
    },
  };
}
