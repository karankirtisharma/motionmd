'use client';

import { useEffect, useRef } from 'react';
import type { MaquetteOptions, MaquetteRenderer } from './maquetteRenderer';

export interface MaquetteCanvasProps extends MaquetteOptions {
  onReady?: () => void;
  onUnavailable?: () => void;
}

/** Decorative renderer. Entry readiness always belongs to the host lounge. */
export default function MaquetteCanvas(props: MaquetteCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MaquetteRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let disposed = false;
    import('./maquetteRenderer').then(({ mountMaquette }) => {
      if (disposed || !canvas.current) return;
      renderer.current = mountMaquette(canvas.current, latest.current, {
        ready: () => { if (!disposed) latest.current.onReady?.(); },
        unavailable: () => { if (!disposed) latest.current.onUnavailable?.(); },
      });
    }).catch(() => { if (!disposed) latest.current.onUnavailable?.(); });
    return () => { disposed = true; renderer.current?.dispose(); renderer.current = null; };
  }, []);

  useEffect(() => { renderer.current?.update(props); }, [props.light, props.reducedMotion, props.assembly, props.turn]);

  return <canvas ref={canvas} className="maquette-canvas" aria-label="Interactive architectural miniature. Drag horizontally to turn; the turn buttons offer the same control." role="img" style={{ display: 'block', width: '100%', height: '100%', touchAction: 'pan-y' }} />;
}
