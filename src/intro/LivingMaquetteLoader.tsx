'use client';

import { useEffect, useRef, useState } from 'react';
import type { createWorldIntroHost } from './worldIntroHost.mjs';
import './living-maquette/src/ui/intro.css';
import IntroPreparation from './IntroPreparation';

type Props = {
  host: ReturnType<typeof createWorldIntroHost>;
  initialReducedMotion: boolean;
  onExit: () => void;
};

/** The supplied UI owns its DOM; React owns only its lifetime. */
export default function LivingMaquetteLoader({ host, initialReducedMotion, onExit }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const [failed, setFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let active = true;
    setMounted(false);
    setFailed(false);
    let intro: { dispose: () => void } | undefined;
    import('./living-maquette/src/index.mjs').then(({ mountLivingMaquette }) => {
      if (!active || !element.current) return;
      intro = mountLivingMaquette(element.current, {
        host,
        assetBase: '/living-maquette/assets/',
        destinations: ['lounge', 'motion-floor'],
        expectedWaitMs: 131000,
        entryHint: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard',
        sound: false,
        initialPreferences: { reducedMotion: initialReducedMotion },
        onExit: () => { if (active) exit.current(); },
        onEvent: (name: string, detail: Record<string, unknown>) => {
          if (new URLSearchParams(location.search).has('profile')) console.info('[living-maquette]', name, detail);
        },
      });
      setMounted(true);
      // Keep the reference's Sound off control without implying unapproved audio.
      // Clone the kit's own styling outside its controlled (hidden) sound node.
      const sound = element.current.querySelector<HTMLButtonElement>('[data-lm="sound"]');
      if (sound) {
        const silent = sound.cloneNode(true) as HTMLButtonElement;
        silent.removeAttribute('data-lm'); silent.hidden = false; silent.disabled = true;
        silent.title = 'Sound is off. Audio is not available in this experience.';
        silent.querySelector('.lm-toggle-label')!.textContent = 'Sound off';
        sound.after(silent);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; intro?.dispose(); };
  }, [host, initialReducedMotion]);
  return <div data-testid="living-maquette-loader" style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#f6efe5', overflow: 'hidden' }}>
    <div ref={element} style={{ position: 'absolute', inset: 0 }} />
    {!mounted && !failed && <IntroPreparation />}
    {failed && <div role="alert" style={{ padding: 32, color: '#352416' }}>The arrival screen could not load. <button onClick={() => location.reload()}>Try again</button> <a href="/studio?entry=direct">Use Lite Version</a></div>}
  </div>;
}
