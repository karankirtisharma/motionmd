'use client';

import { useEffect, useState, type ComponentType } from 'react';
import LoungeEntry from '@/studio/components/LoungeEntry';
import { IntroPreparationBoundary, useIntroPrepared } from '@/intro/IntroPreparation';
import MaquetteIntro, { MaquettePreferences } from '@/components/maquette/MaquetteIntro';

export default function Home() { return <MaquettePreferences><IntroPreparationBoundary><LoungeEntry><LoungeLaunch /></LoungeEntry></IntroPreparationBoundary></MaquettePreferences>; }

// Keep the Android redirect ahead of the lounge runtime; desktop visitors arrive
// directly in Living Maquette, which contains the version choices.
function LoungeLaunch() {
  const markPrepared = useIntroPrepared();
  const [Experience, setExperience] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    import('@/components/LoungeHome').then(module => {
      if (active) setExperience(() => module.default);
    }).catch(() => { if (active) { setFailed(true); markPrepared(); } });
    return () => { active = false; };
  }, [attempt, markPrepared]);

  if (Experience) return <Experience />;
  if (!failed) return null;
  return <MaquetteIntro state="error" error="We couldn’t open the lounge. Check your connection and try again." onRetry={() => { setFailed(false); setAttempt(value => value + 1); }} />;
}
