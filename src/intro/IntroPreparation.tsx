'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import styles from './IntroPreparation.module.css';

const PreparedContext = createContext<() => void>(() => {});
export const useIntroPrepared = () => useContext(PreparedContext);

/** One splash survives every asynchronous startup boundary. */
export function IntroPreparationBoundary({ children }: { children: ReactNode }) {
  const [prepared, setPrepared] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [finished, setFinished] = useState(false);
  const markPrepared = useCallback(() => setPrepared(true), []);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setMinimumElapsed(true), reduced ? 0 : 3000);
    return () => clearTimeout(timer);
  }, []);
  const leaving = prepared && minimumElapsed;
  return <PreparedContext.Provider value={markPrepared}>
    {children}
    {!finished && <IntroPreparation leaving={leaving} onFinished={() => setFinished(true)} />}
  </PreparedContext.Provider>;
}

export default function IntroPreparation({ leaving = false, onFinished }: { leaving?: boolean; onFinished?: () => void }) {
  return <section className={styles.screen} data-leaving={leaving} role="status" aria-label="Preparing your visit"
    onAnimationEnd={event => { if (leaving && event.target === event.currentTarget) onFinished?.(); }}>
    <span className={styles.brand}>motiondesign.ad</span>
  </section>;
}
