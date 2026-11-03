import { createCurvedStudioView, type StudioSurfacePatch } from './CurvedStudioView.ts';
import { createCurvedInput } from './curvedInput.ts';

type Options = { canvas: HTMLCanvasElement; aspect: number; onExpand: () => void;
  canInteract: (x: number, y: number) => boolean;
  sampleSurface: (x: number, y: number) => { u: number; v: number } | null;
  onFocus: () => void };

/** One real same-origin Studio session supplies both the curved visual fragments
 * and native input. The iframe never reloads or reparents on fullscreen changes. */
export function createLiveStudioSurface(options: Options) {
  const width = 1600, height = Math.round(width / options.aspect);
  const visual = document.createElement('div'); visual.dataset.liveStudioVisual = '';
  Object.assign(visual.style, { position: 'fixed', inset: '0', overflow: 'hidden', contain: 'paint', zIndex: '0', pointerEvents: 'none', visibility: 'hidden' });
  const host = document.createElement('div'); host.dataset.liveStudio = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`,
    transformOrigin: '0 0', overflow: 'hidden', background: '#241b13', zIndex: '2', visibility: 'hidden', opacity: '0', pointerEvents: 'none' });
  const status = document.createElement('div'); status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', color: '#f6f1e7', font: '20px sans-serif' });
  host.append(status); document.body.append(visual, host);
  const viewport = options.canvas.parentElement, oldZ = viewport?.style.zIndex;
  if (viewport) viewport.style.zIndex = '1';
  let frame: HTMLIFrameElement | undefined, curved: ReturnType<typeof createCurvedStudioView> | undefined;
  let patches: StudioSurfacePatch[] = [], transform = '', visible = false, interactive = false;
  let expanded = false, ready = false, viewReady = false, disposed = false, suspended: boolean | undefined;
  let animation: Animation | undefined, animationVersion = 0, loadTimer: ReturnType<typeof setTimeout> | undefined;
  let inputEnabled: boolean | undefined, preparingReturn = false;
  let pendingView: ReturnType<typeof createCurvedStudioView> | undefined;
  const input = createCurvedInput({ canvas: options.canvas, host, getFrame: () => frame, width, height,
    hit: (x,y) => { const uv = options.sampleSurface(x,y); return uv ? { x: uv.u, y: uv.v } : null; }, onFocus: options.onFocus });
  const post = (type: string, extra = {}) => frame?.contentWindow?.postMessage({ type, ...extra }, location.origin);
  function sync() {
    host.style.visibility = expanded || visible ? 'visible' : 'hidden';
    const showCurved = visible && !preparingReturn && (!expanded || !!animation);
    visual.style.visibility = showCurved && viewReady ? 'visible' : 'hidden';
    curved?.setVisible(showCurved);
    const nextInput = !expanded && !animation && !preparingReturn && visible && interactive && viewReady && !document.hidden;
    if (inputEnabled !== nextInput) { inputEnabled = nextInput; input.setEnabled(nextInput); }
    if (!expanded && !animation && !preparingReturn) { host.style.opacity = '0'; if (!nextInput) host.style.pointerEvents = 'none'; }
    if (frame) frame.tabIndex = expanded || nextInput ? 0 : -1;
    const next = document.hidden || !(expanded || visible);
    if (next !== suspended && ready) { suspended = next; post(next ? 'md-studio:suspend' : 'md-studio:resume'); }
  }
  function createView() {
    if (curved || !ready || !frame?.contentDocument?.querySelector('#md-studio-root') || expanded || preparingReturn || disposed) return;
    curved = createCurvedStudioView({ parent: visual, document: frame.contentDocument, width, height,
      onReady: () => { if (!disposed) { viewReady = true; sync(); } } });
    curved.setVisible(visible); curved.update(patches);
  }
  function receive(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'md-studio:ready') {
      ready = true; clearTimeout(loadTimer); status.style.display = 'none';
      suspended = undefined; post('md-studio:display', { expanded }); createView(); sync();
    } else if (event.data?.type === 'md-studio:expand' && interactive) options.onExpand();
    else if (event.data?.type === 'md-studio:exit' && !expanded) input.focusRoom();
  }
  function startFrameLoad() {
    if (!frame || disposed) return;
    clearTimeout(loadTimer); curved?.dispose(); curved = undefined; viewReady = ready = false; suspended = undefined;
    status.textContent = 'Opening the studio…'; status.style.display = 'grid';
    frame.src = '/studio?embed=lounge&display=tv&f=1&i=3';
    loadTimer = setTimeout(() => {
      if (ready || disposed) return;
      status.textContent = 'The studio is taking longer to load. ';
      const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = startFrameLoad; status.append(retry);
    }, 20000);
  }
  function ensureFrame() {
    if (frame) return;
    frame = document.createElement('iframe'); frame.dataset.liveStudioFrame = '';
    frame.title = 'Interactive Motion Design studio on the presentation screen'; frame.allowFullscreen = true;
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => { input.refreshFrame(); post('md-studio:display', { expanded }); createView(); sync(); });
    host.prepend(frame); input.refreshFrame(); startFrameLoad();
  }
  function layout(event: Event) {
    const detail = (event as CustomEvent<{ open: boolean; reducedMotion: boolean }>).detail;
    if (!detail || disposed || expanded === detail.open) return;
    const version = ++animationVersion;
    animation?.cancel(); animation = undefined;
    pendingView?.dispose(); pendingView = undefined;
    expanded = detail.open; preparingReturn = !expanded;
    ensureFrame(); options.onFocus(); input.setExpanded(true); sync();
    host.style.zIndex = '1000'; host.style.width = `${width}px`; host.style.height = `${height}px`;
    host.style.visibility = 'visible'; host.style.pointerEvents = 'auto'; host.style.clipPath = 'none';
    host.setAttribute('role', expanded ? 'dialog' : 'region');
    host.setAttribute('aria-label', expanded ? 'Motion Design studio' : 'Interactive presentation screen');
    if (expanded) host.setAttribute('aria-modal', 'true'); else host.removeAttribute('aria-modal');
    const full = `matrix3d(${innerWidth / width},0,0,0,0,${innerHeight / height},0,0,0,0,1,0,0,0,0,1)`;
    function animateHandoff() {
      if (disposed || version !== animationVersion) return;
      preparingReturn = false;
      const destination = expanded ? full : transform;
      host.style.transform = destination; host.style.opacity = expanded ? '1' : '0';
      // Curved fragments stay visible beneath both fades. Only the intentional
      // fullscreen handoff uses the native flat browser viewport.
      animation = host.animate([{ transform: expanded ? transform : full, opacity: expanded ? 0 : 1 },
        { transform: destination, opacity: expanded ? 1 : 0 }],
        { duration: detail.reducedMotion ? 0 : 560, easing: 'cubic-bezier(.22,.68,0,1)' });
      sync();
      animation.finished.then(() => {
        if (disposed || version !== animationVersion) return;
        animation = undefined;
        if (expanded) {
          // Stop mirroring before the source document adopts fullscreen layout.
          sync();
          host.style.width = '100vw'; host.style.height = '100dvh'; host.style.transform = 'none'; host.style.opacity = '1'; frame?.focus();
        } else {
          host.style.zIndex = '2'; host.style.opacity = '0'; host.style.pointerEvents = 'none';
          input.setExpanded(false); input.focusRoom();
        }
        post('md-studio:display', { expanded }); sync();
        window.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open: expanded } }));
      }).catch(() => {});
    }
    if (expanded) animateHandoff();
    else {
      // Keep the same opaque iframe over the viewport while TV layout settles.
      // Do not uncover the room or destroy its old visual until a replacement is ready.
      host.style.transform = full; host.style.opacity = '1';
      post('md-studio:display', { expanded: false });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || version !== animationVersion) return;
        const source = frame?.contentDocument;
        if (!source?.querySelector('#md-studio-root')) { preparingReturn = false; animateHandoff(); return; }
        const replacement = createCurvedStudioView({ parent: visual, document: source, width, height,
          onReady: () => {
            if (disposed || version !== animationVersion || pendingView !== replacement) return;
            const previous = curved;
            curved = replacement; pendingView = undefined; viewReady = true;
            previous?.dispose(); animateHandoff();
          } });
        pendingView = replacement;
        replacement.setVisible(true); replacement.update(patches);
      }));
    }
  }
  window.addEventListener('message', receive);
  window.addEventListener('md-studio:layout', layout);
  document.addEventListener('visibilitychange', sync);
  return {
    width, height,
    update(next: StudioSurfacePatch[], inView: boolean, expandMatrix?: number[] | null) {
      patches = next; visible = inView;
      if (expandMatrix) transform = `matrix3d(${expandMatrix.join(',')})`;
      if (visible) ensureFrame();
      curved?.update(next); pendingView?.update(next); sync(); input.updateCamera();
    },
    setInteractive(value: boolean) { interactive = value; sync(); },
    dispose() {
      if (disposed) return; disposed = true; animationVersion++; animation?.cancel(); clearTimeout(loadTimer);
      input.dispose(); curved?.dispose(); pendingView?.dispose();
      window.removeEventListener('message', receive); window.removeEventListener('md-studio:layout', layout);
      document.removeEventListener('visibilitychange', sync);
      host.remove(); visual.remove(); if (viewport) viewport.style.zIndex = oldZ ?? '';
    },
  };
}
