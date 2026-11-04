/** Event-driven visual surface for the real Studio iframe. Input and accessibility
 * remain in that single document. Scene/camera updates never trigger a paint. */
import { createStudioPaintDocument } from './studioPaintDocument.ts';
import { browseSignature, prepareStudioBrowseLayers } from './studioBrowsePaint.ts';
type Options = {
  document: Document;
  width: number;
  height: number;
  onPaint: (canvas: HTMLCanvasElement) => void;
  onError: (error: Error) => void;
};
export function createStudioPaintSource({ document: doc, width, height, onPaint, onError }: Options) {
  const win = doc.defaultView;
  if (!win || !doc.querySelector('#md-studio-root'))
    throw new Error('The live Studio document is not ready.');
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Cannot create the Studio paint canvas.');
  const abort = new AbortController();
  const capture = createStudioPaintDocument(doc, width, height, abort.signal);
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // The callback communicates a failed paint to the integration, even if the
  // consumer has not reached the handoff's await yet.
  void ready.catch(() => { });
  let visible = false, disposed = false, busy = false, dirty = true, first = true, timer = 0, lastPaint = -Infinity;
  const minimumFrameMs = 1000 / 12;
  let browse: Awaited<ReturnType<typeof prepareStudioBrowseLayers>> = null;
  let warming = '', warmTimer = 0, fastFrame = 0, settleTimer = 0, gesture = false;
  const root = doc.querySelector<HTMLElement>('#md-studio-root')!;
  function prepare(template: HTMLElement) {
    const signature = browseSignature(root);
    if (!signature || browse?.signature === signature || warming || disposed)
      return;
    warming = signature;
    warmTimer = win!.setTimeout(async () => {
      try {
        if (!visible || disposed)
          return;
        const layers = await prepareStudioBrowseLayers(root, template, width, height, capture.rasterize, abort.signal);
        if (layers && !disposed && visible && browseSignature(root) === signature) {
          browse = layers;
          browse.refresh(canvas);
        }
      }
      catch { /* The full-fidelity paint remains active if prewarming is unavailable. */ }
      finally {
        warming = '';
      }
    }, 220);
  }
  function fastPaint() {
    fastFrame = 0;
    if (!visible || disposed || !gesture || !browse)
      return;
    try {
      if (browse.draw(context!)) {
        onPaint(canvas);
        return;
      }
    }
    catch {
      // A future transform the fast compositor cannot represent should take
      // the complete document path, retaining the previous good texture.
      browse = null;
    }
    gesture = false;
    schedule();
  }
  function settle() {
    settleTimer = 0;
    gesture = false;
    dirty = true;
    schedule();
  }
  function schedule() {
    if (timer || disposed || !visible || busy || gesture || !dirty)
      return;
    timer = win!.setTimeout(paint, Math.max(0, minimumFrameMs - (performance.now() - lastPaint)));
  }
  function invalidate() {
    dirty = true;
    if (visible && !disposed && browse && (gesture || browse.changed())) {
      if (browseSignature(root) === browse.signature) {
        gesture = true;
        if (timer) {
          win!.clearTimeout(timer);
          timer = 0;
        }
        if (!fastFrame)
          fastFrame = win!.requestAnimationFrame(fastPaint);
        win!.clearTimeout(settleTimer);
        settleTimer = win!.setTimeout(settle, 75);
        return;
      }
      gesture = false;
    }
    schedule();
  }
  async function paint() {
    timer = 0;
    if (!visible || disposed || busy || !dirty)
      return;
    dirty = false;
    busy = true;
    try {
      const { image, moving, template } = await capture.compose();
      if (disposed || !visible || gesture)
        return;
      context!.drawImage(image, 0, 0, width, height);
      if (first) {
        // Fail closed before a WebGPU/WebGL texture uploads an unreadable image.
        if (!context!.getImageData(width >> 1, height >> 1, 1, 1).data[3])
          throw new Error('The Studio paint backend returned a blank frame.');
        first = false;
      }
      browse?.refresh(canvas);
      onPaint(canvas);
      resolveReady();
      prepare(template);
      dirty ||= moving;
      lastPaint = performance.now();
    }
    catch (cause) {
      if (!disposed) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        rejectReady(error);
        dispose();
        onError(error);
      }
    }
    finally {
      busy = false;
      schedule();
    }
  }
  function scroll(event: Event) {
    if ((event.target as Element | null)?.nodeType === 1)
      capture.trackScroll(event.target as Element);
    invalidate();
  }
  doc.addEventListener('scroll', scroll, true);
  const observer = new MutationObserver(invalidate);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, characterData: true });
  // Motion's transient rules are injected with CSSOM. The document snapshot
  // reads those rules separately instead of rebuilding the whole stylesheet.
  const head = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeName === 'LINK' || (node.nodeName === 'STYLE' && !!node.textContent))))
      capture.invalidateStyles();
    invalidate();
  });
  head.observe(doc.head, { subtree: true, childList: true, characterData: true });
  const events = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'input', 'change', 'timeupdate', 'seeked', 'load', 'animationstart', 'animationend', 'transitionrun', 'transitionend'];
  events.forEach(name => doc.addEventListener(name, invalidate, true));
  function fontsChanged() { capture.invalidateStyles(); invalidate(); }
  doc.fonts?.addEventListener('loadingdone', fontsChanged);
  function setVisible(next: boolean) {
    if (visible === next || disposed)
      return;
    visible = next;
    if (next)
      invalidate();
    else {
      win!.clearTimeout(timer);
      win!.clearTimeout(settleTimer);
      win!.cancelAnimationFrame(fastFrame);
      timer = fastFrame = 0;
      gesture = false;
    }
  }
  function dispose() {
    if (disposed)
      return;
    disposed = true;
    visible = false;
    win!.clearTimeout(timer);
    win!.clearTimeout(settleTimer);
    win!.clearTimeout(warmTimer);
    win!.cancelAnimationFrame(fastFrame);
    browse = null;
    abort.abort();
    observer.disconnect();
    head.disconnect();
    capture.dispose();
    resolveReady();
    doc.removeEventListener('scroll', scroll, true);
    events.forEach(name => doc.removeEventListener(name, invalidate, true));
    doc.fonts?.removeEventListener('loadingdone', fontsChanged);
  }
  return { canvas, ready, invalidate, setVisible, dispose };
}
