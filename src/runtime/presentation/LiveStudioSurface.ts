import { createNativeScreenInput } from './nativeScreenInput.ts';
type Options = {
  canvas: HTMLCanvasElement;
  aspect: number;
  sampleSurface: (x: number, y: number) => {
    u: number;
    v: number;
  } | null;
  onExpand: () => void;
  onFocus: () => void;
  onAperture: (live: boolean) => void;
};
/** One visible browser document for the physical TV and the expanded Studio.
 * The transparent depth-writing LED aperture reveals this sibling underneath the
 * renderer. Both browser hit testing and the visual use the same plane matrix. */
export function createLiveStudioSurface(options: Options) {
  const doc = options.canvas.ownerDocument, win = doc.defaultView!;
  const width = 1600, height = Math.round(width / options.aspect);
  const host = doc.createElement('div');
  host.dataset.liveStudio = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: width + 'px', height: height + 'px',
    transformOrigin: '0 0', overflow: 'hidden', background: '#241b13', zIndex: '0', visibility: 'hidden', pointerEvents: 'none' });
  const viewport = options.canvas.parentElement;
  const previousZ = viewport?.style.zIndex;
  if (viewport && viewport !== doc.body)
    viewport.style.zIndex = '1';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', background: '#241b13', color: '#f6efdf', font: '20px sans-serif' });
  host.append(status);
  doc.body.append(host);
  let frame: HTMLIFrameElement | undefined, matrix: number[] | undefined;
  let transform = '', clip = '', visible = false, ready = false, interactive = false, expanded = false, disposed = false;
  let aperture = false, suspended: boolean | undefined, animation: Animation | undefined, generation = 0;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const input = createNativeScreenInput({ canvas: options.canvas, frame: () => frame, hit: options.sampleSurface, onFocus: options.onFocus });
  const post = (type: string, detail = {}) => frame?.contentWindow?.postMessage({ type, ...detail }, win.location.origin);
  function sync() {
    const inRoom = !!matrix && visible && ready && !doc.hidden;
    const show = expanded || !!animation || inRoom;
    const live = inRoom && !expanded && !animation;
    if (live !== aperture) {
      aperture = live;
      options.onAperture(live);
    }
    host.style.visibility = show ? 'visible' : 'hidden';
    const inputEnabled = live && interactive;
    input.setEnabled(inputEnabled);
    host.style.pointerEvents = expanded || inputEnabled ? 'auto' : 'none';
    if (frame)
      frame.tabIndex = expanded || inputEnabled ? 0 : -1;
    const pause = doc.hidden || !(expanded || animation || inRoom);
    if (ready && pause !== suspended) {
      suspended = pause;
      post(pause ? 'md-studio:suspend' : 'md-studio:resume');
    }
  }
  function worldLayout() {
    host.style.width = width + 'px';
    host.style.height = height + 'px';
    host.style.zIndex = '0';
    host.style.transform = transform || 'none';
    host.style.clipPath = clip || 'none';
  }
  function load() {
    if (!frame || disposed)
      return;
    clearTimeout(loadTimer);
    ready = false;
    suspended = undefined;
    host.dataset.studioState = 'loading';
    status.textContent = 'Opening the studio…';
    status.style.display = 'grid';
    frame.src = '/studio?embed=lounge&display=tv&f=1&i=3';
    loadTimer = setTimeout(() => {
      if (disposed || ready)
        return;
      status.textContent = 'The Studio is taking longer to load. ';
      const retry = doc.createElement('button');
      retry.textContent = 'Retry';
      retry.onclick = load;
      status.append(retry);
    }, 20000);
    sync();
  }
  function ensureFrame() {
    if (frame)
      return;
    frame = doc.createElement('iframe');
    frame.dataset.liveStudioFrame = '';
    frame.title = 'Interactive Motion Design Studio';
    frame.allowFullscreen = true;
    Object.assign(frame.style, { width: '100%', height: '100%', display: 'block', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => { input.refreshFrame(); post('md-studio:display', { expanded }); });
    host.prepend(frame);
    load();
  }
  function receive(event: MessageEvent) {
    if (event.origin !== win.location.origin || event.source !== frame?.contentWindow || !frame)
      return;
    if (event.data?.type === 'md-studio:ready') {
      clearTimeout(loadTimer);
      ready = true;
      suspended = undefined;
      host.dataset.studioState = 'live';
      status.style.display = 'none';
      input.refreshFrame();
      post('md-studio:display', { expanded });
      sync();
    }
    else if (event.data?.type === 'md-studio:expand' && !expanded && visible && interactive)
      options.onExpand();
    else if (event.data?.type === 'md-studio:exit' && !expanded)
      input.focusRoom();
  }
  function layout(event: Event) {
    const detail = (event as CustomEvent<{
      open: boolean;
      reducedMotion: boolean;
    }>).detail;
    if (!detail || disposed || expanded === detail.open)
      return;
    const version = ++generation;
    const full = 'matrix3d(' + [win.innerWidth / width, 0, 0, 0, 0, win.innerHeight / height, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].join(',') + ')';
    const start = animation ? win.getComputedStyle(host).transform : (expanded ? full : transform || full);
    animation?.cancel();
    expanded = detail.open;
    ensureFrame();
    options.onFocus();
    input.setEnabled(false);
    host.style.zIndex = '1000';
    host.style.width = width + 'px';
    host.style.height = height + 'px';
    host.style.clipPath = 'none';
    host.setAttribute('role', expanded ? 'dialog' : 'region');
    host.setAttribute('aria-label', expanded ? 'Motion Design Studio' : 'Interactive presentation screen');
    if (expanded)
      host.setAttribute('aria-modal', 'true');
    else
      host.removeAttribute('aria-modal');
    if (!expanded)
      post('md-studio:display', { expanded: false });
    const destination = expanded ? full : transform || full;
    host.style.transform = destination;
    animation = host.animate([{ transform: start }, { transform: destination }], { duration: detail.reducedMotion ? 0 : 560, easing: 'cubic-bezier(.22,.68,0,1)' });
    sync();
    animation.finished.then(() => {
      if (disposed || version !== generation)
        return;
      animation = undefined;
      if (expanded) {
        host.style.width = '100vw';
        host.style.height = '100dvh';
        host.style.transform = 'none';
        host.style.clipPath = 'none';
        post('md-studio:display', { expanded: true });
        frame?.focus({ preventScroll: true });
      }
      else {
        worldLayout();
        input.focusRoom();
      }
      sync();
      win.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open: expanded } }));
    }).catch(() => { });
  }
  function openOnLoadingClick(event: MouseEvent) {
    if (!ready && !expanded && interactive && visible && matrix && options.sampleSurface(event.clientX, event.clientY)) {
      event.preventDefault();
      options.onExpand();
    }
  }
  function visibility() { sync(); }
  options.canvas.addEventListener('click', openOnLoadingClick);
  win.addEventListener('message', receive);
  win.addEventListener('md-studio:layout', layout);
  doc.addEventListener('visibilitychange', visibility);
  return {
    width, height,
    update(inView: boolean, next?: number[] | null, polygon?: string | null) {
      const wasVisible = visible;
      visible = inView;
      matrix = next ?? undefined;
      const css = matrix ? 'matrix3d(' + matrix.join(',') + ')' : '', newClip = polygon || 'none';
      if (css !== transform || newClip !== clip) {
        transform = css;
        clip = newClip;
        if (!expanded && !animation) {
          host.style.transform = transform || 'none';
          host.style.clipPath = clip;
        }
      }
      if (visible && matrix)
        ensureFrame();
      if (wasVisible && !visible && !expanded && doc.activeElement === frame)
        input.focusRoom();
      sync();
      input.updateCamera(matrix);
    },
    setInteractive(value: boolean) {
      if (interactive === value)
        return;
      interactive = value;
      if (!value && !expanded && doc.activeElement === frame)
        input.focusRoom();
      sync();
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      generation++;
      animation?.cancel();
      clearTimeout(loadTimer);
      input.dispose();
      if (aperture) {
        aperture = false;
        options.onAperture(false);
      }
      options.canvas.removeEventListener('click', openOnLoadingClick);
      win.removeEventListener('message', receive);
      win.removeEventListener('md-studio:layout', layout);
      doc.removeEventListener('visibilitychange', visibility);
      host.remove();
      if (viewport && viewport !== doc.body && viewport.style.zIndex === '1')
        viewport.style.zIndex = previousZ ?? '';
    }
  };
}
