'use client';

import { useEffect, useState, type ComponentType } from 'react';
import LoungeEntry from '@/studio/components/LoungeEntry';

export default function Home() { return <LoungeEntry><LoungeLaunch /></LoungeEntry>; }

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
  return <main className="welcome-layer">
    <section className="lounge-panel welcome-panel" aria-label="Opening the lounge">
      <p className="eyebrow">The lounge</p>
      {failed ? <>
        <h1>We couldn’t open the lounge.</h1>
        <div className="panel-actions">
          <button type="button" className="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>
          <a className="button button-quiet" href="/studio?entry=direct">Open the studio</a>
        </div>
      </> : <p className="panel-copy" role="status">Opening the 3D lounge…</p>}
    </section>
  </main>;
}
