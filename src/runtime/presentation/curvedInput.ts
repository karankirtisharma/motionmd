/** Native input for a curved screen. The transparent iframe is translated so the
 * raycast UV falls under the real pointer; its DOM, focus and browser events stay
 * intact. The owner controls visibility, dimensions, stacking and fullscreen. */
export type CurvedInputPoint = { x: number; y: number };
export type CurvedInputOptions = {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  getFrame: () => HTMLIFrameElement | undefined;
  /** Normalized UV, with y=0 at the top of the source document. */
  hit: (clientX: number, clientY: number) => CurvedInputPoint | null;
  width: number;
  height: number;
  onFocus: () => void;
};

export function createCurvedInput(options: CurvedInputOptions) {
  const { canvas, host } = options;
  const radius = 10;
  const styleKeys = ['opacity', 'pointerEvents', 'clipPath', 'transform'] as const;
  type HostStyle = Record<(typeof styleKeys)[number], string>;
  let savedStyle: HostStyle | undefined;
  let enabled = false, expanded = false, disposed = false, placed = false;
  let dragging = false, pointerId: number | undefined;
  let last: CurvedInputPoint | undefined, lastEligible = false;
  let boundFrame: HTMLIFrameElement | undefined, child: Window | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const running = () => enabled && !expanded && !disposed && !document.hidden;
  function claimStyle() {
    if (savedStyle) return;
    savedStyle = Object.fromEntries(styleKeys.map(key => [key, host.style[key]])) as HostStyle;
    host.style.opacity = '0';
    host.style.pointerEvents = 'none';
    host.style.clipPath = 'inset(50%)';
  }
  function dismiss() {
    placed = false;
    if (savedStyle) {
      host.style.pointerEvents = 'none';
      host.style.clipPath = 'inset(50%)';
    }
  }
  function releaseStyle() {
    dismiss();
    if (!savedStyle) return;
    for (const key of styleKeys) host.style[key] = savedStyle[key];
    savedStyle = undefined;
  }
  function cancelDrag() {
    clearTimeout(settleTimer); settleTimer = undefined;
    dragging = false; pointerId = undefined;
  }
  function uvAt(point: CurvedInputPoint) {
    const uv = options.hit(point.x, point.y);
    return uv && Number.isFinite(uv.x) && Number.isFinite(uv.y) &&
      uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1 ? uv : null;
  }
  function place(point: CurvedInputPoint) {
    if (!running() || dragging || !boundFrame || !child) return false;
    const uv = uvAt(point);
    if (!uv) { dismiss(); return false; }
    claimStyle();
    const sourceX = uv.x * options.width, sourceY = uv.y * options.height;
    host.style.transform = `translate3d(${point.x - sourceX}px,${point.y - sourceY}px,0)`;
    // A small native hit window cannot hijack unrelated lounge controls. Moving
    // outside it returns to the canvas, where the next raycast places it again.
    host.style.clipPath = `inset(${Math.max(0, sourceY - radius)}px ${Math.max(0, options.width - sourceX - radius)}px ${Math.max(0, options.height - sourceY - radius)}px ${Math.max(0, sourceX - radius)}px)`;
    host.style.pointerEvents = 'auto';
    placed = true;
    return true;
  }
  function childPoint(event: MouseEvent): CurvedInputPoint {
    const rect = host.getBoundingClientRect();
    return { x: rect.left + event.clientX, y: rect.top + event.clientY };
  }
  function block(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function settle(point: CurvedInputPoint) {
    cancelDrag();
    // Keep the original target/coordinates through the native pointerup + click.
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (running() && lastEligible) place(point); else dismiss();
    }, 0);
  }
  function framePointer(event: Event) {
    if (!running() || !placed) return;
    const pointer = event as PointerEvent;
    // Keyboard activation has no pointer coordinates and belongs to the focused
    // child control, including when the screen edge is behind furniture.
    if (event.type === 'click' && pointer.detail === 0) return;
    const point = childPoint(pointer);
    last = point; lastEligible = true;
    if (event.type === 'pointercancel') { cancelDrag(); dismiss(); return; }
    if (dragging) {
      // Freeze the translation during native capture/selection. Changing it would
      // make Timeline's clientX and browser text selection jump during a drag.
      if (event.type === 'pointerup' && pointer.pointerId === pointerId) settle(point);
      return;
    }
    if (!uvAt(point)) { block(event); dismiss(); return; }
    if (event.type === 'pointerdown') {
      options.onFocus();
      dragging = true; pointerId = pointer.pointerId;
      host.style.clipPath = 'none';
    } else if (event.type === 'pointermove' && !pointer.buttons) place(point);
  }
  const frameEvents = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'wheel', 'contextmenu'] as const;
  function detachChild() {
    for (const name of frameEvents) child?.removeEventListener(name, framePointer, true);
    child = null;
  }
  function attachChild() {
    detachChild();
    try {
      // Reading the document deliberately verifies same-origin access.
      if (!boundFrame?.contentDocument) return;
      child = boundFrame.contentWindow;
      for (const name of frameEvents) child?.addEventListener(name, framePointer, { capture: true, passive: false });
    } catch { child = null; dismiss(); }
  }
  function refreshFrame() {
    const next = options.getFrame();
    if (next === boundFrame) {
      if (next?.contentWindow !== child) attachChild();
      return;
    }
    boundFrame?.removeEventListener('load', attachChild);
    detachChild(); boundFrame = next;
    boundFrame?.addEventListener('load', attachChild);
    attachChild();
  }
  function parentMove(event: PointerEvent) {
    if (!running() || dragging || event.buttons || document.pointerLockElement) return;
    last = { x: event.clientX, y: event.clientY };
    lastEligible = event.target === canvas;
    if (!lastEligible) { if (!host.contains(event.target as Node)) dismiss(); return; }
    refreshFrame(); place(last);
  }
  function parentDown(event: PointerEvent) {
    if (!running() || event.target !== canvas || event.button !== 0) return;
    last = { x: event.clientX, y: event.clientY }; lastEligible = true;
    refreshFrame();
    if (!place(last)) return;
    // Touch/locked-cursor input has no hover to position the native iframe. This
    // first press focuses it; the following native press activates a control.
    block(event); options.onFocus(); boundFrame?.focus({ preventScroll: true });
  }
  function parentUp(event: PointerEvent) {
    if (!running() || !dragging || event.pointerId !== pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    last = point; settle(point);
  }
  function interrupted() { cancelDrag(); dismiss(); }
  function visibility() { if (document.hidden) interrupted(); }
  function blurred() {
    // Focusing the child document also blurs the parent window. Keep the native
    // pointer session alive; only leaving this browser document interrupts it.
    queueMicrotask(() => {
      if (!disposed && (document.activeElement !== boundFrame || !document.hasFocus())) interrupted();
    });
  }
  window.addEventListener('pointermove', parentMove, true);
  window.addEventListener('pointerdown', parentDown, true);
  window.addEventListener('pointerup', parentUp, true);
  window.addEventListener('pointercancel', interrupted, true);
  window.addEventListener('blur', blurred);
  document.addEventListener('visibilitychange', visibility);
  refreshFrame();

  return {
    refreshFrame,
    setEnabled(value: boolean) {
      enabled = value; refreshFrame();
      if (!value) { cancelDrag(); releaseStyle(); }
      else if (!expanded) { claimStyle(); if (last && lastEligible) place(last); }
    },
    /** Call before the owner changes host styles for its fullscreen transition. */
    setExpanded(value: boolean) {
      expanded = value; cancelDrag(); releaseStyle();
      if (!value && enabled) { claimStyle(); if (last && lastEligible) place(last); }
    },
    /** Re-evaluate a stationary cursor when camera/occluders move. */
    updateCamera() {
      refreshFrame();
      if (running() && !dragging && last && lastEligible) place(last);
    },
    focusRoom() { cancelDrag(); dismiss(); canvas.focus({ preventScroll: true }); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelDrag(); releaseStyle();
      boundFrame?.removeEventListener('load', attachChild); detachChild();
      window.removeEventListener('pointermove', parentMove, true);
      window.removeEventListener('pointerdown', parentDown, true);
      window.removeEventListener('pointerup', parentUp, true);
      window.removeEventListener('pointercancel', interrupted, true);
      window.removeEventListener('blur', blurred);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
