"use client";
import { useEffect, useRef } from 'react';
export type StudioBounds = { x: number; y: number; width: number; height: number };

/** The runtime retains one live iframe for both the TV and expanded view. */
export default function LoungeStudioOverlay({ open, reducedMotion, onCovered, onClose }: {
  open: boolean; bounds: StudioBounds | null; reducedMotion: boolean; sceneElement: HTMLElement | null;
  onCovered: (covered: boolean) => void; onClose: () => void;
}) {
  const openRef = useRef(open); openRef.current = open;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const coveredRef = useRef(onCovered); coveredRef.current = onCovered;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[data-live-studio-frame]');
      if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
      if (event.data?.type === 'md-studio:exit' && openRef.current) closeRef.current();
    };
    const completed = (event: Event) => {
      const expanded = (event as CustomEvent<{open: boolean}>).detail?.open;
      if (expanded === openRef.current) coveredRef.current(expanded);
    };
    window.addEventListener('message', receive); window.addEventListener('md-studio:layout-complete', completed);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('md-studio:layout-complete', completed); };
  }, []);
  useEffect(() => {
    if (!open) coveredRef.current(false);
    window.dispatchEvent(new CustomEvent('md-studio:layout', { detail: { open, reducedMotion } }));
  }, [open, reducedMotion]);
  return null;
}
