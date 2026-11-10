"use client";
import { useEffect, useState, type ReactNode } from 'react';

import MaquetteIntro from '@/components/maquette/MaquetteIntro';
import styles from '@/components/maquette/MaquetteIntro.module.css';

import { isAndroidPhone } from '../lib/entryDevice';

/** This gate must mount before the lounge effect imports the 3D runtime. */
export default function LoungeEntry({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<'pending' | 'choose' | '3d'>('pending');
  const [recommendLight, setRecommendLight] = useState(false);
  useEffect(() => {
    // Never read a remembered choice or URL mode before this decision. Loading
    // the 3D world requires a fresh click, even on a bookmarked debug/3D URL.
    if (isAndroidPhone(navigator)) { location.replace('/studio?entry=direct'); return; }
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    setRecommendLight((memory !== undefined && memory < 4) || /iPhone|iPod/i.test(navigator.userAgent));
    setChoice('choose');
  }, []);
  if (choice === '3d') return children;
  return <MaquetteIntro state="choose" choices={<>
    <p className={styles.eyebrow}>CHOOSE YOUR EXPERIENCE</p>
    <div className={styles.choices}>
      {choice === 'choose' && <button className={styles.primary} type="button" onClick={() => setChoice('3d')}>3D environment <span aria-hidden="true">→</span></button>}
      <a className={styles.secondary} href="/studio?entry=direct">Light version <span aria-hidden="true">↗</span></a>
    </div>
    {recommendLight && <p className={styles.subtitle}>The light version is recommended for your device.</p>}
    <noscript><p>Open the light version to visit without JavaScript.</p></noscript>
  </>} />;
}
