'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import styles from './MaquetteIntro.module.css';

const MaquetteCanvas = dynamic(() => import('./MaquetteCanvas'), { ssr: false });
type Preferences = { light: 'warm' | 'soft'; reduced: boolean };
const PreferencesContext = createContext<Preferences & { setLight: (light: 'warm' | 'soft') => void; setReduced: (reduced: boolean) => void }>({ light: 'warm', reduced: false, setLight: (_: 'warm' | 'soft') => {}, setReduced: (_: boolean) => {} });

export function MaquettePreferences({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>({ light: 'warm', reduced: false });
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPreferences(value => ({ ...value, reduced: media.matches }));
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <PreferencesContext.Provider value={{ ...preferences, setLight: light => setPreferences(value => ({ ...value, light })), setReduced: reduced => setPreferences(value => ({ ...value, reduced })) }}>{children}</PreferencesContext.Provider>;
}

export type MaquetteIntroProps = {
  state: 'choose' | 'boot' | 'loading' | 'ready' | 'error';
  choices?: ReactNode;
  loading?: { phase: string; detail?: string; progress?: number };
  error?: string;
  onEnter?: () => void;
  onCinematic?: () => void;
  onRetry?: () => void;
};

const studies = [
  { title: 'Space', image: 'P02_lighting.webp', copy: 'A room, revealed layer by layer.' },
  { title: 'Light', image: 'L02_glazing_material_target.webp', copy: 'Soft reflections. A warmer welcome.' },
  { title: 'Form', image: 'L01_stair_material_target.webp', copy: 'A small detail with a sense of movement.' },
];

/** This surface observes host readiness; decorative motion can never grant entry. */
export default function MaquetteIntro({ state, choices, loading, error, onEnter, onCinematic, onRetry }: MaquetteIntroProps) {
  const { light, reduced, setLight, setReduced } = useContext(PreferencesContext);
  const [turn, setTurn] = useState(0);
  const [assembled, setAssembled] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [studiesOpen, setStudiesOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const previousState = useRef(state);
  const live = (state === 'loading' || state === 'ready') && !unavailable;
  const ready = state === 'ready';
  const failed = state === 'error';
  const progress = loading?.progress;
  const measured = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null;
  useEffect(() => {
    if (studiesOpen) dialog.current?.showModal(); else dialog.current?.close();
  }, [studiesOpen]);
  useEffect(() => {
    // Do not steal focus from a study or a control when readiness arrives.
    if (previousState.current === 'error' && state === 'loading') { setUnavailable(false); setModelReady(false); }
    previousState.current = state;
  }, [state]);
  const heading = failed ? 'A moment, please.' : ready ? 'Your room is ready.' : 'Your first room is taking shape.';
  const detail = failed ? (error || 'The connection was interrupted. Your visit can still continue in the light version.')
    : ready ? 'Step inside. Find your own perspective.'
    : state === 'choose' ? 'A little space for a different perspective.' : 'Explore a little while the studio prepares.';
  return <main className={styles.intro} data-state={state} data-light={light} data-reduced-motion={reduced || undefined} aria-label="Motion Design arrival">
    <div className={styles.inner}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Motion Design home">motiondesign<span>.ad</span></a>
        <label className={styles.motion}><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />Reduce motion</label>
      </header>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>A SPACE FOR IDEAS</p>
          <h1 ref={title} className={styles.title}>{heading}</h1>
          <p className={styles.subtitle}>{detail}</p>
          <div className={styles.choiceArea}>
            {choices || <>
              <p className={styles.eyebrow}>{ready ? 'MAKE YOURSELF AT HOME' : 'YOUR EXPERIENCE'}</p>
              <div className={styles.choices}>
                {ready ? <button className={styles.primary} onClick={onEnter} type="button">Enter the 3D environment <span aria-hidden="true">↗</span></button>
                  : failed ? <button className={styles.primary} onClick={onRetry} type="button">Try again <span aria-hidden="true">↻</span></button>
                  : <span className={styles.selected}>3D environment <span aria-hidden="true">✓</span></span>}
                <a className={styles.secondary} href="/studio?entry=direct">Light version <span aria-hidden="true">↗</span></a>
              </div>
            </>}
            {ready && onCinematic && <button className={styles.textLink} type="button" onClick={onCinematic}>Take the guided tour <span aria-hidden="true">→</span></button>}
            <button className={styles.textLink} type="button" onClick={() => setStudiesOpen(true)}>Explore studies <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <div className={styles.modelArea}>
          <div className={styles.modelStage}>
            <img className={styles.poster} data-hidden={live && modelReady || undefined} src="/maquette/I08_maquette_ready.webp" alt={live && modelReady ? '' : 'An architectural miniature in travertine, glass and champagne bronze'} width="1280" height="853" fetchPriority="high" />
            {live && <div className={styles.liveModel} data-ready={modelReady || undefined}><MaquetteCanvas light={light} reducedMotion={reduced} assembly={ready || assembled || reduced ? 0 : 0.35} turn={turn} onReady={() => setModelReady(true)} onUnavailable={() => { setUnavailable(true); setModelReady(false); }} /></div>}
          </div>
          {live && modelReady ? <div className={styles.modelTools}>
            <div className={styles.toolGroup} aria-label="Turn the miniature">
              <button type="button" aria-label="Rotate miniature left" onClick={() => setTurn(value => value - Math.PI / 8)}>↶</button>
              <span>Drag to explore</span>
              <button type="button" aria-label="Rotate miniature right" onClick={() => setTurn(value => value + Math.PI / 8)}>↷</button>
            </div>
            <div className={styles.toolGroup} role="group" aria-label="Miniature light">
              <button type="button" aria-pressed={light === 'warm'} onClick={() => setLight('warm')}>Warm</button>
              <button type="button" aria-pressed={light === 'soft'} onClick={() => setLight('soft')}>Soft</button>
            </div>
            {!ready && <button className={styles.assemblyButton} type="button" aria-pressed={assembled} onClick={() => setAssembled(value => !value)}>{assembled ? 'Reveal layers' : 'Bring it together'}</button>}
          </div> : <p className={styles.modelCaption}>{unavailable ? 'A still preview · your room is preparing independently' : 'Architecture. Light. A little possibility.'}</p>}
        </div>
      </section>
      <footer className={styles.status}>
        <div className={styles.statusHeading} role="status" aria-live="polite" aria-atomic="true"><span className={styles.statusDot} aria-hidden="true" /><strong>{failed ? 'We couldn’t finish preparing the room' : ready ? 'The 3D environment is ready' : state === 'choose' ? 'Choose your experience' : loading?.phase || 'Opening the 3D environment'}</strong></div>
        <p>{failed ? 'Try again, or open the light version instantly.' : ready ? 'Enter when you’re ready. There’s no rush.' : state === 'choose' ? 'Light version opens instantly. The 3D world downloads only when you choose it.' : loading?.detail || 'We’re preparing the architecture, materials and light for your visit.'}</p>
        {measured !== null && state === 'loading' && <progress aria-label={loading?.phase || 'Current preparation task'} max={1} value={measured} />}
      </footer>
      <div className={styles.bottomLine}><span>MOTION DESIGN / LIVING MAQUETTE</span><span>A considered arrival.</span></div>
    </div>
    <dialog ref={dialog} className={styles.studies} onCancel={() => setStudiesOpen(false)} onClose={() => setStudiesOpen(false)} aria-labelledby="maquette-studies-title">
      {studiesOpen && <><div className={styles.studiesHeader}><div><p className={styles.eyebrow}>PREVIEW STUDIES</p><h2 id="maquette-studies-title">A glimpse of the studio</h2></div><button className={styles.secondary} type="button" onClick={() => setStudiesOpen(false)}>Back to the model <span aria-hidden="true">×</span></button></div><div className={styles.studyGrid}>{studies.map(study => <article key={study.title}><img src={`/maquette/${study.image}`} width="1280" height="720" alt={`${study.title} architectural material study`} /><h3>{study.title}</h3><p>{study.copy}</p><small>Preview study</small></article>)}</div></>}
    </dialog>
  </main>;
}
