import { createFrameReadiness } from './frameReadiness.ts';
import { createNativeScreenInput } from './nativeScreenInput.ts';
import type { ScreenSource } from './projectionCabinet.ts';
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
  /** Static app shown instead of the React Studio; it has no controls of its own to leave the expanded view. */
  source?: ScreenSource;
};
/** One visible browser document for the physical TV and the expanded Studio.
 * The transparent depth-writing LED aperture reveals this sibling underneath the
 * renderer. Both browser hit testing and the visual use the same plane matrix. */
export function createLiveStudioSurface(options: Options) {
  const doc = options.canvas.ownerDocument, win = doc.defaultView!;
  const source = options.source;
  const width = source?.width ?? 1600, height = source?.height ?? Math.round(width / options.aspect);
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
  let engaged = false;
  let aperture = false, suspended: boolean | undefined, animation: Animation | undefined, generation = 0;
  // A static source expands into a second, full-window page (its responsive
  // edition) that fades in over the room once the camera has glided onto the TV.
  let overlay: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  let page: HTMLIFrameElement | undefined, pageReady = false, pageSuspended: boolean | undefined, fade: Animation | undefined;
  let pageWaiters: (() => void)[] = [], preloadTimer: ReturnType<typeof setTimeout> | undefined;
  const pageHost = source?.expandedUrl ? doc.createElement('div') : undefined;
  const close = pageHost ? doc.createElement('button') : undefined;
  if (pageHost && close && source) {
    pageHost.dataset.liveStudioPage = '';
    pageHost.setAttribute('role', 'dialog');
    pageHost.setAttribute('aria-modal', 'true');
    pageHost.setAttribute('aria-label', source.title);
    Object.assign(pageHost.style, { position: 'fixed', inset: '0', width: '100vw', height: '100dvh', zIndex: '1000', background: '#140f0d',
      opacity: '0', visibility: 'hidden', pointerEvents: 'none' });
    close.type = 'button';
    close.textContent = 'Back to TV';
    close.hidden = true;
    Object.assign(close.style, { position: 'absolute', bottom: '20px', left: '20px', zIndex: '1', padding: '9px 16px',
      border: '1px solid #d7bc928c', borderRadius: '999px', background: '#140f0dd9', color: '#f6efdf', font: '13px sans-serif', cursor: 'pointer' });
    close.onclick = () => page?.contentWindow?.postMessage({ type: 'md-studio:request-exit' }, win.location.origin);
    pageHost.append(close);
    doc.body.append(pageHost);
  }

  const input = createNativeScreenInput({ canvas: options.canvas, frame: () => frame, hit: options.sampleSurface, onFocus: options.onFocus });
  const post = (type: string, detail = {}) => frame?.contentWindow?.postMessage({ type, ...detail }, win.location.origin);
  function sync() {
    // While the full-window page covers the room, the TV itself rests.
    const inRoom = engaged && !!matrix && visible && ready && !doc.hidden && overlay !== 'open';
    const show = expanded || !!animation || inRoom;
    const live = inRoom && !expanded && !animation;
    if (live !== aperture) {
      aperture = live;
      options.onAperture(live);
    }
    const visibility = show ? 'visible' : 'hidden';
    if (host.style.visibility !== visibility) host.style.visibility = visibility;
    const inputEnabled = live && interactive;
    input.setEnabled(inputEnabled);
    const pointerEvents = expanded || inputEnabled ? 'auto' : 'none';
    if (host.style.pointerEvents !== pointerEvents) host.style.pointerEvents = pointerEvents;
    const tabIndex = expanded || inputEnabled ? 0 : -1;
    if (frame && frame.tabIndex !== tabIndex) frame.tabIndex = tabIndex;
    const pause = doc.hidden || !(expanded || animation || inRoom);
    if (ready && pause !== suspended) {
      suspended = pause;
      post(pause ? 'md-studio:suspend' : 'md-studio:resume');
    }
    const pagePause = doc.hidden || overlay === 'closed';
    if (page && pageReady && pagePause !== pageSuspended) {
      pageSuspended = pagePause;
      page.contentWindow?.postMessage({ type: pagePause ? 'md-studio:suspend' : 'md-studio:resume' }, win.location.origin);
    }
  }
  const hashOf = (target?: HTMLIFrameElement) => { try { return target?.contentWindow?.location.hash ?? ''; } catch { return ''; } };
  function ensurePage() {
    if (page || !pageHost || !source?.expandedUrl) return;
    const created = page = doc.createElement('iframe');
    created.dataset.liveStudioFrame = '';
    created.title = source.title;
    created.allowFullscreen = true;
    Object.assign(created.style, { width: '100%', height: '100%', display: 'block', border: '0', background: '#140f0d' });
    created.addEventListener('load', () => source.onLoad(created));
    created.src = source.expandedUrl(hashOf(frame));
    pageHost.prepend(created);
  }
  // Load the full page quietly once the visitor is seated and the TV is live, so the
  // first expand neither waits for it nor shares the camera glide with its boot.
  function schedulePreload() {
    if (page || preloadTimer || !pageHost || !engaged || !ready) return;
    preloadTimer = setTimeout(() => { preloadTimer = undefined; if (!disposed && engaged) ensurePage(); }, 1500);
  }
  // Ready, or after a bounded wait so a slow picture never strands the visitor.
  const whenPageReady = () => new Promise<void>(resolve => {
    if (pageReady) return resolve();
    const timer = setTimeout(done, 6000);
    function done() { clearTimeout(timer); pageWaiters = pageWaiters.filter(waiter => waiter !== done); resolve(); }
    pageWaiters.push(done);
  });
  async function layoutPage(open: boolean, reducedMotion: boolean) {
    if (!pageHost || !close) return;
    const version = ++generation;
    fade?.cancel();
    const complete = () => win.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open } }));
    if (open) {
      overlay = 'opening';
      ensurePage();
      await whenPageReady();
      if (disposed || version !== generation) return;
      // Carry the TV's page into the full view.
      const hash = hashOf(frame);
      if (hash && hashOf(page) !== hash && page?.contentWindow) page.contentWindow.location.hash = hash;
      Object.assign(pageHost.style, { visibility: 'visible', pointerEvents: 'auto' });
      sync();
      fade = pageHost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reducedMotion ? 0 : 220, easing: 'ease-out', fill: 'forwards' });
      try { await fade.finished; } catch { return; }
      if (disposed || version !== generation) return;
      pageHost.style.opacity = '1';
      overlay = 'open';
      close.hidden = false;
      page?.focus({ preventScroll: true });
      sync();
      complete();
    }
    else {
      overlay = 'closing';
      close.hidden = true;
      // Bring the visitor's page back to the TV before the room shows again.
      const hash = hashOf(page);
      if (hash && hashOf(frame) !== hash && frame?.contentWindow) frame.contentWindow.location.hash = hash;
      sync();
      fade = pageHost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion ? 0 : 200, easing: 'ease-in', fill: 'forwards' });
      try { await fade.finished; } catch { return; }
      if (disposed || version !== generation) return;
      Object.assign(pageHost.style, { opacity: '0', visibility: 'hidden', pointerEvents: 'none' });
      overlay = 'closed';
      sync();
      input.focusRoom();
      complete();
    }
  }
  function worldLayout() {
    host.style.width = width + 'px';
    host.style.height = height + 'px';
    host.style.zIndex = '0';
    host.style.transform = transform || 'none';
    host.style.clipPath = clip || 'none';
  }
  const readiness = createFrameReadiness({
    // Next hydration and first-paint image decoding need more time than the
    // standalone CRM. Recovery remains bounded and never reloads a ready app.
    loadedGraceMs: 8000,
    load: attempt => {
      if (!frame || disposed) return;
      ready = false;
      suspended = undefined;
      host.dataset.studioState = 'loading';
      host.dataset.studioAttempt = String(attempt);
      status.textContent = source?.loading ?? 'Opening the studio...';
      status.style.display = 'grid';
      frame.src = source ? source.url(attempt) : `/studio?embed=lounge&display=tv&f=1&i=3&attempt=${attempt}`;
      sync();
    },
    exhausted: () => {
      host.dataset.studioState = 'failed';
      status.textContent = 'The Studio could not load. ';
      const retry = doc.createElement('button');
      retry.textContent = 'Retry';
      retry.onclick = () => readiness.retry();
      status.append(retry);
    },
  });
  function ensureFrame() {
    if (frame)
      return;
    frame = doc.createElement('iframe');
    frame.dataset.liveStudioFrame = '';
    frame.title = source?.title ?? 'Interactive Motion Graphics Agency Studio';
    frame.allowFullscreen = true;
    Object.assign(frame.style, { width: '100%', height: '100%', display: 'block', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => { if (source && frame) source.onLoad(frame); readiness.loaded(); input.refreshFrame(); post('md-studio:display', { expanded }); });
    // Set src before insertion so about:blank cannot start a false boot deadline.
    readiness.start();
    host.prepend(frame);
  }
  function receive(event: MessageEvent) {
    if (event.origin === win.location.origin && page && event.source === page.contentWindow) {
      if (event.data?.type === 'md-studio:ready' && !pageReady) {
        pageReady = true;
        pageSuspended = undefined;
        pageWaiters.slice().forEach(done => done());
        sync();
      }
      return;
    }
    if (event.origin !== win.location.origin || event.source !== frame?.contentWindow || !frame)
      return;
    if (event.data?.type === 'md-studio:ready') {
      readiness.ready();
      ready = true;
      suspended = undefined;
      host.dataset.studioState = 'live';
      status.style.display = 'none';
      input.refreshFrame();
      post('md-studio:display', { expanded });
      sync();
      schedulePreload();
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
    if (!detail || disposed)
      return;
    if (pageHost) {
      if ((overlay === 'open' || overlay === 'opening') !== detail.open) void layoutPage(detail.open, detail.reducedMotion);
      return;
    }
    if (expanded === detail.open)
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
    host.setAttribute('aria-label', expanded ? 'Motion Graphics Agency Studio' : 'Interactive presentation screen');
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
    if (!expanded && interactive && visible && matrix && options.sampleSurface(event.clientX, event.clientY)) {
      event.preventDefault();
      engaged = true; ensureFrame(); sync();
      if (ready) options.onExpand();
    }
  }
  function visibility() { sync(); }
  options.canvas.addEventListener('click', openOnLoadingClick);
  win.addEventListener('message', receive);
  win.addEventListener('md-studio:layout', layout);
  doc.addEventListener('visibilitychange', visibility);
  // The GPU snapshot owns the idle display. Hydrate only on chair approach
  // or explicit screen use, outside the world's expensive Details phase.
  return {
    width, height,
    prepare() { ensureFrame(); },
    prepareExpanded() { ensurePage(); },
    setEngaged(value: boolean) {
      if (engaged === value) return;
      engaged = value;
      if (value) ensureFrame();
      sync();
      if (value) schedulePreload();
    },
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
      if (visible && matrix && engaged) ensureFrame();
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
      fade?.cancel();
      clearTimeout(preloadTimer);
      pageHost?.remove();
      readiness.dispose();
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
