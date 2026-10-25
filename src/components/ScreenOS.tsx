'use client';

import { useEffect, useRef, useState } from 'react';
import type { ScreenFocus, ScreenRect } from '@/runtime/presentation/PresentationScreen';

type Props = {
  open: boolean;
  reducedMotion: boolean;
  /** Where the lounge screen sits on the page right now; the OS grows out of it and returns to it. */
  getScreenRect: () => ScreenRect | undefined;
  onFocus: (focus: ScreenFocus) => void;
  onClose: () => void;
  /** True once the OS fully covers the scene, false as soon as it starts to close. */
  onCovered: (covered: boolean) => void;
};

const SOURCE = '/screen-os/index.html?host=lounge';
const EASE = 'cubic-bezier(0.77, 0, 0.175, 1)'; // the OS's --ease-in-out

/*
 * The Screen OS (public/screen-os) running as a page over the scene. It is mounted on the
 * first open and kept, hidden and suspended, so later visits resume where they left off.
 */
export default function ScreenOS({ open, reducedMotion, getScreenRect, onFocus, onClose, onCovered }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const callbacks = useRef({ getScreenRect, onFocus, onClose, onCovered });
  callbacks.current = { getScreenRect, onFocus, onClose, onCovered };

  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } & Partial<ScreenFocus>;
      if (data?.type === 'md-os:exit') callbacks.current.onClose();
      else if (data?.type === 'md-os:select' && typeof data.id === 'string' && typeof data.title === 'string') {
        callbacks.current.onFocus({ id: data.id, title: data.title, niche: data.niche, poster: data.poster });
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, []);

  useEffect(() => {
    if (open) { setMounted(true); setVisible(true); }
  }, [open]);

  useEffect(() => {
    const element = layer.current;
    if (!element || !visible) return;
    const post = (type: string) => frame.current?.contentWindow?.postMessage({ type }, window.location.origin);
    // Full page -> the screen's projected bounds: uniform scale by width, then crop the height.
    const screen = () => {
      const w = window.innerWidth, h = window.innerHeight, projected = callbacks.current.getScreenRect();
      // Seated, the curve runs past the window edges: grow from the part that is on screen.
      const rect = projected && (() => {
        const left = Math.max(0, projected.left), top = Math.max(0, projected.top);
        return { left, top, width: Math.min(w, projected.left + projected.width) - left, height: Math.min(h, projected.top + projected.height) - top };
      })();
      if (reducedMotion || !rect || rect.width < 40 || rect.height < 24 || rect.left > w || rect.top > h || rect.left + rect.width < 0 || rect.top + rect.height < 0) {
        return { transform: reducedMotion ? 'none' : 'scale(0.96)', clipPath: 'inset(0px round 0px)' };
      }
      const scale = rect.width / w, inset = Math.max(0, (h - rect.height / scale) / 2);
      const x = rect.left + rect.width / 2 - w / 2, y = rect.top + rect.height / 2 - h / 2;
      return { transform: `translate(${x}px, ${y}px) scale(${scale})`, clipPath: `inset(${inset}px 0px round ${10 / scale}px)` };
    };
    const full = { transform: 'none', clipPath: 'inset(0px round 0px)' };
    // The still on the lounge screen and the live OS differ: cross-fade during the first
    // (or, closing, the last) third while the geometry follows the whole curve.
    const keyframes = open
      ? [{ ...screen(), opacity: 0 }, { opacity: 1, offset: 0.3 }, { ...full, opacity: 1 }]
      : [{ ...full, opacity: 1 }, { opacity: 1, offset: 0.7 }, { ...screen(), opacity: 0 }];
    const duration = reducedMotion ? 180 : open ? 760 : 560;
    if (!open) callbacks.current.onCovered(false);
    const animation = element.animate(keyframes, { duration, easing: EASE, fill: 'forwards' });
    let cancelled = false;
    animation.finished.then(() => {
      if (cancelled) return;
      if (open) {
        callbacks.current.onCovered(true);
        post('md-os:resume');
        frame.current?.focus(); frame.current?.contentWindow?.focus();
      } else { post('md-os:suspend'); setVisible(false); }
    }, () => undefined);
    return () => { cancelled = true; animation.cancel(); };
  }, [open, visible, reducedMotion]);

  if (!mounted) return null;
  return <div ref={layer} className="screen-os" hidden={!visible} aria-hidden={!open}>
    <iframe ref={frame} src={SOURCE} title="motiondesign.ad — Screen OS" allow="autoplay; fullscreen" />
  </div>;
}
