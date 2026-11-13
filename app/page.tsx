'use client';

import { useEffect, useState, type ComponentType } from 'react';
import LoungeEntry from '@/studio/components/LoungeEntry';
import MaquetteIntro, { MaquettePreferences } from '@/components/maquette/MaquetteIntro';

export default function Home() { return <MaquettePreferences><LoungeEntry><LoungeLaunch /></LoungeEntry></MaquettePreferences>; }

// Keep the Android redirect ahead of the lounge runtime; desktop visitors arrive
// directly in Living Maquette, which contains the version choices.
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
  if (!failed) return <div role="status" style={{ position: 'fixed', inset: 0, background: '#f6efe5', color: '#352416', padding: 32 }}>Preparing your visit</div>;
  return <MaquetteIntro state="error" error="We couldn’t open the lounge. Check your connection and try again." onRetry={() => { setFailed(false); setAttempt(value => value + 1); }} />;
}
