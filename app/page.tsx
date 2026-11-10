'use client';

import { useEffect, useState, type ComponentType } from 'react';
import LoungeEntry from '@/studio/components/LoungeEntry';
import MaquetteIntro, { MaquettePreferences } from '@/components/maquette/MaquetteIntro';

export default function Home() { return <MaquettePreferences><LoungeEntry><LoungeLaunch /></LoungeEntry></MaquettePreferences>; }

// The chooser and the Android redirect do not need the lounge UI or its
// diagnostics. Mounting this component means the visitor explicitly chose 3D.
function LoungeLaunch() {
  const [Experience, setExperience] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    import('@/components/LoungeHome').then(module => {
      if (active) setExperience(() => module.default);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  if (Experience) return <Experience />;
  return <MaquetteIntro state={failed ? 'error' : 'boot'} error="We couldn’t open the lounge. Check your connection and try again." onRetry={() => { setFailed(false); setAttempt(value => value + 1); }} />;
}
