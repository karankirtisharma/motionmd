"use client";
import { useEffect, useState, type ReactNode } from 'react';

export function rememberEntry(value: '3d' | 'light') {
  try { localStorage.setItem('md-entry', value); } catch { /* Private browsing still supports direct links. */ }
}

/** This gate must mount before the lounge effect imports the 3D runtime. */
export default function LoungeEntry({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<'pending' | 'choose' | '3d'>('pending');
  const [recommendLight, setRecommendLight] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('mode') === '3d') { rememberEntry('3d'); setChoice('3d'); return; }
    let saved: string | null = null;
    try { saved = localStorage.getItem('md-entry'); } catch {}
    if (saved === 'light') { location.replace('/studio'); return; }
    if (saved === '3d') { setChoice('3d'); return; }
    let graphics = 'gpu' in navigator;
    if (!graphics) {
      const probe = document.createElement('canvas'); probe.width = probe.height = 1;
      const gl = probe.getContext('webgl2'); graphics = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    setRecommendLight(!graphics || (memory !== undefined && memory < 4) || /Android|iPhone|iPod/i.test(navigator.userAgent));
    setChoice('choose');
  }, []);
  if (choice === '3d') return children;
  return <main className="welcome-layer" style={{ minHeight: '100dvh', background: 'var(--ink)', overflowY: 'auto' }}>
    <section className="lounge-panel welcome-panel" aria-label="Choose how to visit" style={{ width: 'min(760px, calc(100% - 32px))', margin: 'auto' }}>
      <p className="eyebrow">Motion Design</p><h1>Your way in.</h1>
      <p className="panel-copy">Step into the lounge, or go straight to the films and ideas.</p>
      {choice === 'pending' ? <p role="status">Preparing your visit.</p> : <div className="entry-options">
        <a className="entry-option" href="/studio" onClick={() => rememberEntry('light')}>
          <span className="eyebrow">{recommendLight ? 'Recommended for your device' : 'The studio'}</span>
          <strong>Go straight to the work <span aria-hidden="true">↗</span></strong><span>Fast, works on any device.</span>
        </a>
        <button className="entry-option" type="button" onClick={() => { rememberEntry('3d'); setChoice('3d'); }}>
          <span className="eyebrow">The experience</span><strong>Explore the 3D lounge <span aria-hidden="true">→</span></strong>
          <span>Needs a dedicated graphics card and about an 800 MB download.</span>
        </button>
      </div>}
      <p className="panel-note">Your choice is remembered on this device. You can switch any time.</p>
      <noscript><a href="/studio">Go straight to the work</a></noscript>
    </section>
    <style>{`.entry-options{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:30px}.entry-option{display:flex;flex-direction:column;gap:15px;padding:26px;text-align:left;text-decoration:none;color:var(--ivory);background:var(--ink-soft);border:1px solid var(--line);border-radius:8px;font:inherit;line-height:1.6}.entry-option strong{font-size:21px;font-weight:500;line-height:1.3}.entry-option>span:last-child{font-size:13px;color:var(--muted)}.entry-option:hover{border-color:var(--gold)}.entry-option .eyebrow{font-size:10px;margin:0;color:var(--gold)}@media(max-width:600px){.entry-options{grid-template-columns:1fr}.entry-option{padding:20px}.welcome-panel:has(.entry-options){padding:28px}}`}</style>
  </main>;
}
