"use client";
import { useEffect, useState, type ReactNode } from 'react';

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
  return <main className="welcome-layer" style={{ minHeight: '100dvh', background: 'var(--ink)', overflowY: 'auto' }}>
    <section className="lounge-panel welcome-panel" aria-label="Choose how to visit" style={{ width: 'min(760px, calc(100% - 32px))', margin: 'auto' }}>
      <p className="eyebrow">Motion Design</p><h1>How would you like to visit?</h1>
      <p className="panel-copy">Open the studio instantly, or explore the full 3D world.</p>
      {choice === 'pending' ? <p role="status">Preparing your visit.</p> : <div className="entry-options">
        <a className="entry-option" href="/studio?entry=direct">
          <span className="eyebrow">{recommendLight ? 'Recommended for your device' : 'The studio'}</span>
          <strong>Open the studio <span aria-hidden="true">↗</span></strong><span>Films, projects and ideas. No 3D download.</span>
        </a>
        <button className="entry-option" type="button" onClick={() => setChoice('3d')}>
          <span className="eyebrow">The experience</span><strong>Explore the 3D world <span aria-hidden="true">→</span></strong>
          <span>The complete interactive lounge. A large download; best on a desktop or laptop.</span>
        </button>
      </div>}
      <p className="panel-note">The 3D world downloads only when you choose to explore it.</p>
      <noscript><a href="/studio">Open the studio</a></noscript>
    </section>
    <style>{`.entry-options{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:30px}.entry-option{display:flex;flex-direction:column;gap:15px;padding:26px;text-align:left;text-decoration:none;color:var(--ivory);background:var(--ink-soft);border:1px solid var(--line);border-radius:8px;font:inherit;line-height:1.6}.entry-option strong{font-size:21px;font-weight:500;line-height:1.3}.entry-option>span:last-child{font-size:13px;color:var(--muted)}.entry-option:hover{border-color:var(--gold)}.entry-option .eyebrow{font-size:10px;margin:0;color:var(--gold)}@media(max-width:600px){.entry-options{grid-template-columns:1fr}.entry-option{padding:20px}.welcome-panel:has(.entry-options){padding:28px}}`}</style>
  </main>;
}
