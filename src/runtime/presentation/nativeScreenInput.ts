import { mapScreenPoint } from './projection.ts';
type Point = {
  x: number;
  y: number;
};
type Options = {
  canvas: HTMLCanvasElement;
  frame: () => HTMLIFrameElement | undefined;
  hit: (x: number, y: number) => {
    u: number;
    v: number;
  } | null;
  onFocus: () => void;
};
/** The scene canvas visually occludes the iframe. Yield its pointer hit box only
 * while the actual cursor ray reaches the display. The browser then targets the
 * visible transformed document itself, including native drags, forms and wheel. */
export function createNativeScreenInput({ canvas, frame, hit, onFocus }: Options) {
  let enabled = false, routed = false, dragging = false, disposed = false;
  let matrix: number[] | undefined, last: Point | undefined, child: Window | null = null;
  let savedPointer = '', releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerId: number | undefined;
  const doc = canvas.ownerDocument;
  const running = () => enabled && !disposed && !doc.hidden && !doc.pointerLockElement;
  function route(next: boolean) {
    if (next === routed)
      return;
    if (next) {
      savedPointer = canvas.style.pointerEvents;
      canvas.style.pointerEvents = 'none';
    }
    else if (canvas.style.pointerEvents === 'none')
      canvas.style.pointerEvents = savedPointer;
    routed = next;
  }
  function allowed(point: Point) {
    if (!running() || !matrix)
      return false;
    const uv = hit(point.x, point.y);
    return !!uv && uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1;
  }
  function cancel() {
    clearTimeout(releaseTimer);
    dragging = false;
    pointerId = undefined;
    last = undefined;
    route(false);
  }
  function focusRoom() { cancel(); canvas.focus({ preventScroll: true }); }
  function updateCamera(next: number[] | undefined) {
    matrix = next;
    if (!dragging && last)
      route(allowed(last));
  }
  function parentMove(event: PointerEvent) {
    if (!running() || dragging || event.buttons)
      return;
    // The HUD always owns its own interactive controls.
    if (event.target !== canvas) {
      last = undefined;
      route(false);
      return;
    }
    last = { x: event.clientX, y: event.clientY };
    route(allowed(last));
  }
  function parentDown(event: PointerEvent) {
    if (!enabled || disposed || doc.hidden || event.target !== canvas || event.button !== 0)
      return;
    const point = { x: event.clientX, y: event.clientY };
    if (doc.pointerLockElement === canvas) {
      const rect = canvas.getBoundingClientRect();
      point.x = rect.left + rect.width / 2;
      point.y = rect.top + rect.height / 2;
    }
    // Touch and pointer lock have no preceding hover to route the first press.
    // Let that press focus the TV; the next press reaches the actual DOM control.
    const uv = matrix && hit(point.x, point.y);
    if (!uv || uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1)
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onFocus();
    last = point;
    route(true);
    frame()?.focus({ preventScroll: true });
  }
  function release(event: PointerEvent) {
    if (!dragging || event.pointerId !== pointerId)
      return;
    clearTimeout(releaseTimer);
    // Native click follows pointerup. Retain ownership through that dispatch.
    releaseTimer = setTimeout(() => { dragging = false; pointerId = undefined; if (last)
      route(allowed(last)); }, 0);
  }
  function childPointer(event: Event) {
    if (!enabled || disposed)
      return; // fullscreen owns its own native event routing
    const mouse = event as MouseEvent;
    if (event.type === 'click' && mouse.detail === 0)
      return; // keyboard activation
    if (event.type === 'pointercancel') {
      cancel();
      return;
    }
    if (!matrix)
      return;
    const point = mapScreenPoint(matrix, mouse.clientX, mouse.clientY);
    last = point;
    if (dragging && (event.type === 'pointermove' || event.type === 'pointerup')) {
      if (event.type === 'pointerup')
        release(event as PointerEvent);
      return;
    }
    if (!allowed(point)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      route(false);
      return;
    }
    route(true);
    if (event.type === 'pointerdown') {
      onFocus();
      dragging = true;
      pointerId = (event as PointerEvent).pointerId;
    }
  }
  function childFocused() { if (enabled && !disposed)
    onFocus(); }
  const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'wheel', 'contextmenu'] as const;
  function detach() {
    for (const name of events)
      child?.removeEventListener(name, childPointer, true);
    child?.removeEventListener('focusin', childFocused, true);
    child = null;
  }
  function refreshFrame() {
    detach();
    try {
      const iframe = frame();
      if (!iframe?.contentDocument)
        return;
      child = iframe.contentWindow;
      for (const name of events)
        child?.addEventListener(name, childPointer, { capture: true, passive: false });
      child?.addEventListener('focusin', childFocused, true);
    }
    catch {
      detach();
      cancel();
    }
  }
  function lockChanged() { if (doc.pointerLockElement)
    cancel(); }
  function blur() {
    queueMicrotask(() => { if (!disposed && (doc.activeElement !== frame() || !doc.hasFocus()))
      cancel(); });
  }
  window.addEventListener('pointermove', parentMove, true);
  window.addEventListener('pointerdown', parentDown, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', blur);
  doc.addEventListener('pointerlockchange', lockChanged);
  return {
    refreshFrame, focusRoom, updateCamera,
    setEnabled(next: boolean) { if (next === enabled)
      return; enabled = next; if (!next)
      cancel(); },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      cancel();
      detach();
      window.removeEventListener('pointermove', parentMove, true);
      window.removeEventListener('pointerdown', parentDown, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
      doc.removeEventListener('pointerlockchange', lockChanged);
    }
  };
}
