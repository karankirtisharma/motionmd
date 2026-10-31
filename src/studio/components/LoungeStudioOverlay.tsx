"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
export type StudioBounds = { x: number; y: number; width: number; height: number };

/** Same-origin, retained browsing session; no lounge runtime imports. */
export default function LoungeStudioOverlay({ open, bounds, reducedMotion, sceneElement, onCovered, onClose }: {
  open: boolean; bounds: StudioBounds | null; reducedMotion: boolean;
  sceneElement: HTMLElement | null;
  onCovered: (covered: boolean) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false), [ready, setReady] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const coveredRef = useRef(onCovered); coveredRef.current = onCovered;
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => { if (open) setMounted(true); }, [open]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'md-studio:ready') {
        setReady(true);
        frame.current?.contentWindow?.postMessage({ type: openRef.current ? 'md-studio:resume' : 'md-studio:suspend' }, location.origin);
      }
      if (event.data?.type === 'md-studio:exit' && openRef.current) closeRef.current();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useLayoutEffect(() => {
    if (!mounted || !panel.current) return;
    if (!open) {
      frame.current?.contentWindow?.postMessage({ type: 'md-studio:suspend' }, location.origin);
      coveredRef.current(false); return;
    }
    frame.current?.contentWindow?.postMessage({ type: 'md-studio:resume' }, location.origin);
    const element = panel.current;
    const rect = bounds ?? { x: innerWidth / 2, y: innerHeight / 2, width: 1, height: 1 };
    // Enlarge the rendered room toward the actual TV, then reveal the embedded
    // studio at the end. The camera and seated pose remain untouched underneath.
    const canZoom = !reducedMotion && rect.width >= 32 && rect.height >= 16 &&
      Number.isFinite(rect.x + rect.y + rect.width + rect.height) &&
      rect.x < innerWidth && rect.y < innerHeight && rect.x + rect.width > 0 && rect.y + rect.height > 0;
    const zoom = Math.max(innerWidth / Math.max(1, rect.width), innerHeight / Math.max(1, rect.height));
    const tx = innerWidth / 2 - (rect.x + rect.width / 2) * zoom;
    const ty = innerHeight / 2 - (rect.y + rect.height / 2) * zoom;
    const roomAnimation = canZoom && sceneElement ? sceneElement.animate([
      { transform: 'none', transformOrigin: '0 0' },
      { transform: `translate(${tx}px, ${ty}px) scale(${zoom})`, transformOrigin: '0 0' },
    ], { duration: 700, easing: 'cubic-bezier(.77,0,.175,1)', fill: 'forwards' }) : undefined;
    const animation = element.animate(!canZoom ? [{ opacity: 0 }, { opacity: 1 }] : [
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .68 }, { opacity: 1, offset: 1 },
    ], { duration: !canZoom ? 180 : 700, easing: 'linear', fill: 'none' });
    let cancelled = false;
    animation.finished.then(() => {
      if (cancelled || !openRef.current) return;
      coveredRef.current(true); roomAnimation?.cancel(); frame.current?.focus();
    }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); roomAnimation?.cancel();  };
  }, [open, mounted, bounds, reducedMotion, sceneElement]);
  if (!mounted) return null;
  return <div ref={panel} hidden={!open} inert={!open} role="dialog" aria-modal="true" aria-label="Motion Design studio" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab' && event.target === event.currentTarget) { event.preventDefault(); frame.current?.focus(); }
  }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#241b13', transformOrigin: '0 0', overflow: 'hidden' }}>
    {!ready && <p role="status" style={{ position: 'absolute', inset: '45% 0 auto', textAlign: 'center', color: '#f6f1e7' }}>Opening the studio…</p>}
    <iframe ref={frame} src="/studio?embed=lounge" title="Motion Design studio" allowFullScreen onLoad={() => {
      frame.current?.contentWindow?.postMessage({ type: openRef.current ? 'md-studio:resume' : 'md-studio:suspend' }, location.origin);
    }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
    {!ready && <button type="button" className="button button-quiet" onClick={onClose} style={{ position: 'absolute', top: 20, right: 20 }}>Back to the lounge</button>}
  </div>;
}
