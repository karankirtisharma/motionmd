'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './MaquetteIntro.module.css';

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

export const useMaquettePreferences = () => useContext(PreferencesContext);

export type MaquetteIntroProps = {
  state: 'choose' | 'boot' | 'error';
  choices?: ReactNode;
  error?: string;
  onRetry?: () => void;
};

const studies = [
  { title: 'Space', image: 'P02_lighting.webp', copy: 'A room, revealed layer by layer.' },
  { title: 'Light', image: 'L02_glazing_material_target.webp', copy: 'Soft reflections. A warmer welcome.' },
  { title: 'Form', image: 'L01_stair_material_target.webp', copy: 'A small detail with a sense of movement.' },
];

/** This surface observes host readiness; decorative motion can never grant entry. */
export default function MaquetteIntro({ state, choices, error, onRetry }: MaquetteIntroProps) {
  const { light, reduced } = useContext(PreferencesContext);
  const [studiesOpen, setStudiesOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const failed = state === 'error';
  useEffect(() => {
    if (studiesOpen) dialog.current?.showModal(); else dialog.current?.close();
  }, [studiesOpen]);
  const heading = failed ? 'A moment, please.' : 'Your first room is taking shape.';
  const detail = failed ? (error || 'The connection was interrupted. Your visit can still continue in the light version.')

    : state === 'choose' ? 'Choose the full 3D environment or open the light version.' : 'Explore a little while the studio prepares.';
  return <main className={styles.intro} data-state={state} data-light={light} data-reduced-motion={reduced || undefined} aria-label="Motion Design arrival">
    <div className={styles.inner}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Motion Design home">motiondesign<span>.ad</span></a>

      </header>
      <section className={styles.hero}>
        <div className={styles.copy}>

          <h1 className={styles.title}>{failed ? heading : <>Your first room<br />is taking<br />shape.</>}</h1>
          <p className={styles.subtitle}>{detail}</p>
          <div className={styles.choiceArea}>
            {choices || <>
              <p className={styles.eyebrow}>YOUR EXPERIENCE</p>
              <div className={styles.choices}>
                {failed ? <button className={styles.primary} onClick={onRetry} type="button">Try again <span aria-hidden="true">↻</span></button>
                  : <span className={styles.selected}>3D environment <span aria-hidden="true">✓</span></span>}
                <a className={styles.secondary} href="/studio?entry=direct">Light version <span aria-hidden="true">↗</span></a>
              </div>
            </>}
            <button className={styles.textLink} type="button" onClick={() => setStudiesOpen(true)}>Explore studies <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <div className={styles.modelArea}>
          <div className={styles.modelStage}>
            <img className={styles.poster} src="/living-maquette/assets/images/stills/loading-lounge-warm.webp" alt="An architectural miniature in travertine, glass and champagne bronze" width="1280" height="1096" fetchPriority="high" />
          </div>

        </div>
      </section>
      <footer className={styles.status}>
        <div className={styles.statusHeading} role="status" aria-live="polite" aria-atomic="true"><span className={styles.statusDot} aria-hidden="true" /><strong>{failed ? 'We couldn’t finish preparing the room' : state === 'choose' ? 'Choose your experience' : 'Opening the 3D environment'}</strong></div>
        <p>{failed ? 'Try again, or open the light version instantly.' : state === 'choose' ? 'Light version opens instantly. The 3D world downloads only when you choose it.' : 'We’re preparing the architecture, materials and light for your visit.'}</p>
      </footer>

    </div>
    <dialog ref={dialog} className={styles.studies} onCancel={() => setStudiesOpen(false)} onClose={() => setStudiesOpen(false)} aria-labelledby="maquette-studies-title">
      {studiesOpen && <><div className={styles.studiesHeader}><div><p className={styles.eyebrow}>PREVIEW STUDIES</p><h2 id="maquette-studies-title">A glimpse of the studio</h2></div><button className={styles.secondary} type="button" onClick={() => setStudiesOpen(false)}>Back to the model <span aria-hidden="true">×</span></button></div><div className={styles.studyGrid}>{studies.map(study => <article key={study.title}><img src={`/maquette/${study.image}`} width="1280" height="720" alt={`${study.title} architectural material study`} /><h3>{study.title}</h3><p>{study.copy}</p><small>Preview study</small></article>)}</div></>}
    </dialog>
  </main>;
}
