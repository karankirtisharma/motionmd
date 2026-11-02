import { mapScreenPoint, screenHomography, type ScreenQuad } from './projection.ts';

type Options = { canvas: HTMLCanvasElement; aspect: number; onExpand: () => void;
  canInteract: (x: number, y: number) => boolean; onFocus: () => void };

/** One real same-origin browsing session. Its DOM is never reparented on expand:
 * reparenting an iframe would reload it and lose the selected film/form state. */
export function createLiveStudioSurface(options: Options) {
  const width = 1600, height = Math.round(width / options.aspect);
  const host = document.createElement('div'); host.dataset.liveStudio = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`,
    transformOrigin: '0 0', overflow: 'hidden', background: '#241b13', zIndex: '0', visibility: 'hidden', pointerEvents: 'none' });
  const status = document.createElement('div'); status.setAttribute('role', 'status');
  status.textContent = 'Opening the studio…';
  Object.assign(status.style, { position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', color: '#f6f1e7', font: '20px sans-serif' });
  host.append(status); document.body.append(host);
  const viewport = options.canvas.parentElement, oldZ = viewport?.style.zIndex;
  if (viewport) viewport.style.zIndex = '1';
  let frame: HTMLIFrameElement | undefined, frameDocument: Document | null = null;
  let matrix: number[] | null = null, transform = '', visible = false, interactive = false;
  let expanded = false, ready = false, disposed = false, suspended: boolean | undefined;
  let inputCheckTime = -Infinity;
  let animation: Animation | undefined, animationVersion = 0, loadTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (type: string, extra = {}) => frame?.contentWindow?.postMessage({ type, ...extra }, location.origin);
  function resetPointer() { options.canvas.style.pointerEvents = ''; }
  function sync() {
    host.style.visibility = expanded || visible ? 'visible' : 'hidden';
    host.style.pointerEvents = (expanded || visible && interactive) && !document.hidden ? 'auto' : 'none';
    if (frame) frame.tabIndex = expanded || visible && interactive ? 0 : -1;
    const next = document.hidden || !(expanded || visible);
    if (next !== suspended && ready) { suspended = next; post(next ? 'md-studio:suspend' : 'md-studio:resume'); }
    if (!interactive || !visible || expanded) resetPointer();
  }
  function focusRoom() { resetPointer(); options.canvas.focus({ preventScroll: true }); }
  function receive(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'md-studio:ready') {
      ready = true; clearTimeout(loadTimer); status.hidden = true; status.style.display = 'none';
      suspended = undefined; post('md-studio:display', { expanded }); sync();
    } else if (event.data?.type === 'md-studio:expand' && interactive) options.onExpand();
    else if (event.data?.type === 'md-studio:exit' && !expanded) focusRoom();
  }
  function routePointer(event: PointerEvent) {
    if (expanded || !visible || !interactive || event.buttons || document.pointerLockElement) return;
    // Only relinquish the canvas over the actual visible screen, never its box.
    if (event.target === options.canvas && options.canInteract(event.clientX, event.clientY)) options.canvas.style.pointerEvents = 'none';
    else if (!host.contains(event.target as Node)) resetPointer();
  }
  function touchScreen(event: PointerEvent) {
    if (!expanded && visible && interactive && event.button === 0 && options.canInteract(event.clientX, event.clientY)) {
      // The first touch/locked-cursor click enters the screen; subsequent input is
      // native iframe input. Do not synthesize clicks into a form or film control.
      event.preventDefault(); event.stopImmediatePropagation(); options.onFocus();
      options.canvas.style.pointerEvents = 'none'; frame?.focus();
    }
  }
  function guardFrameInput(event: Event) {
    if (expanded || !matrix) return;
    if (event.type === 'pointermove') {
      const now = performance.now(); if (now - inputCheckTime < 32) return; inputCheckTime = now;
    }
    // Keyboard activation has no meaningful pointer coordinates. It must still
    // work when the screen's top-left corner happens to be behind furniture.
    if (event.type === 'click' && (event as MouseEvent).detail === 0 && interactive && visible) return;
    const pointer = event as PointerEvent;
    const p = mapScreenPoint(matrix, pointer.clientX, pointer.clientY);
    if (!interactive || !visible || !options.canInteract(p.x, p.y)) {
      event.preventDefault(); event.stopImmediatePropagation(); resetPointer(); return;
    }
    if (event.type === 'pointerdown') options.onFocus();
  }
  function detachDocument() {
    for (const name of ['pointermove', 'pointerdown', 'click', 'wheel']) frameDocument?.removeEventListener(name, guardFrameInput, true);
    frameDocument = null;
  }
  function ensureFrame() {
    if (frame) return;
    frame = document.createElement('iframe'); frame.dataset.liveStudioFrame = '';
    frame.title = 'Interactive Motion Design studio on the presentation screen'; frame.allowFullscreen = true;
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => {
      detachDocument(); frameDocument = frame?.contentDocument ?? null;
      for (const name of ['pointermove', 'pointerdown', 'click', 'wheel']) frameDocument?.addEventListener(name, guardFrameInput, { capture: true, passive: false });
      post('md-studio:display', { expanded }); sync();
    });
    frame.src = '/studio?embed=lounge&display=tv&f=1&i=3'; host.prepend(frame);
    loadTimer = setTimeout(() => {
      if (ready || disposed) return;
      status.textContent = 'The studio is taking longer to load. ';
      const retry = document.createElement('button'); retry.textContent = 'Retry';
      retry.onclick = () => { if (frame) frame.src = '/studio?embed=lounge&display=tv&f=1&i=3'; };
      status.append(retry);
    }, 20000);
  }
  function layout(event: Event) {
    const detail = (event as CustomEvent<{ open: boolean; reducedMotion: boolean }>).detail;
    if (!detail || disposed || expanded === detail.open) return;
    const current = host.style.transform;
    expanded = detail.open; ensureFrame(); options.onFocus(); resetPointer();
    animation?.cancel(); const version = ++animationVersion;
    host.style.zIndex = '1000'; host.style.width = `${width}px`; host.style.height = `${height}px`;
    host.setAttribute('role', expanded ? 'dialog' : 'region');
    host.setAttribute('aria-label', expanded ? 'Motion Design studio' : 'Interactive presentation screen');
    if (expanded) host.setAttribute('aria-modal', 'true'); else host.removeAttribute('aria-modal');
    const full = `matrix3d(${innerWidth / width},0,0,0,0,${innerHeight / height},0,0,0,0,1,0,0,0,0,1)`;
    const destination = expanded ? full : transform;
    host.style.transform = destination;
    animation = host.animate([{ transform: expanded ? current : full }, { transform: destination }],
      { duration: detail.reducedMotion ? 0 : 560, easing: 'cubic-bezier(.22,.68,0,1)' });
    sync();
    animation.finished.then(() => {
      if (disposed || version !== animationVersion) return;
      animation = undefined;
      if (expanded) {
        host.style.width = '100vw'; host.style.height = '100dvh'; host.style.transform = 'none'; frame?.focus();
      } else { host.style.zIndex = '0'; host.style.transform = transform; focusRoom(); }
      post('md-studio:display', { expanded }); sync();
      window.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open: expanded } }));
    }).catch(() => {});
  }
  window.addEventListener('message', receive);
  window.addEventListener('md-studio:layout', layout);
  window.addEventListener('pointermove', routePointer, true);
  options.canvas.addEventListener('pointerdown', touchScreen, true);
  host.addEventListener('pointerleave', resetPointer);
  document.addEventListener('visibilitychange', sync);
  return {
    update(quad: ScreenQuad, inView: boolean) {
      visible = inView;
      if (visible) {
        matrix = screenHomography(quad, width, height);
        if (!matrix) visible = false;
        else {
          const next = `matrix3d(${matrix.join(',')})`;
          if (next !== transform) { transform = next; if (!expanded && !animation) host.style.transform = next; }
          ensureFrame();
        }
      }
      sync();
    },
    setInteractive(value: boolean) { interactive = value; sync(); },
    dispose() {
      if (disposed) return; disposed = true; animationVersion++; animation?.cancel(); clearTimeout(loadTimer);
      detachDocument(); resetPointer();
      window.removeEventListener('message', receive); window.removeEventListener('md-studio:layout', layout);
      window.removeEventListener('pointermove', routePointer, true);
      options.canvas.removeEventListener('pointerdown', touchScreen, true);
      document.removeEventListener('visibilitychange', sync);
      host.remove(); if (viewport) viewport.style.zIndex = oldZ ?? '';
    },
  };
}
