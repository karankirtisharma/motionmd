'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export type LoungeMode = 'loading' | 'welcome' | 'cinematic' | 'handoff' | 'explore' | 'seated' | 'menu' | 'error';
export type Quality = 'auto' | 'high' | 'balanced';
export interface LoungeInterfaceProps {
  mode: LoungeMode;
  loading?: { phase: string; detail?: string; progress?: number };
  progress?: number;
  onProgressChange?: (progress: number) => void;
  playing?: boolean;
  duration?: number;
  onCinematic?: () => void;
  onTogglePlayback?: () => void;
  cameraView?: 'thirdPerson' | 'bodyCam';
  onToggleCameraView?: () => void;
  onTogglePointerLock?: () => void;
  onExplore: () => void;
  onExploreDirect?: () => void;
  onGoBack: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onRetry?: () => void;
  onMenu?: () => void;
  onInteract?: () => void;
  onLeaveSeat?: () => void;
  interactionLabel?: string | null;
  seatedChair?: string | number;
  error?: string;
  qualityLabel?: string;
  quality?: Quality;
  onQualityChange?: (quality: Quality) => void;
  reducedMotion?: boolean;
  onReducedMotionChange?: (reduced: boolean) => void;
  onToggleFullscreen?: () => void;
  onTouchMove?: (input: { x: number; y: number }) => void;
  onTouchLook?: (input: { x: number; y: number }) => void;
  onTouchSprint?: (sprinting: boolean) => void;
  onTouchExit?: () => void;
}

type IconName = 'arrow' | 'back' | 'close' | 'menu' | 'fullscreen' | 'move' | 'mouse' | 'sun' | 'up' | 'down' | 'left' | 'right' | 'look' | 'play' | 'pause' | 'replay';
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const lines: Record<IconName, ReactNode> = {
    play: <path d="m9 5 10 7-10 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    replay: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    back: <><path d="M20 12H5m6-6-6 6 6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    menu: <><path d="M4 8h16M4 16h16" /></>,
    fullscreen: <><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" /></>,
    move: <><path d="M12 3v18M3 12h18m-12-6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" /></>,
    mouse: <><rect x="6" y="2.5" width="12" height="19" rx="6" /><path d="M12 6v4" /></>,
    sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    left: <path d="m15 6-6 6 6 6" />,
    right: <path d="m9 6 6 6-6 6" />,
    look: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{lines[name]}</svg>;
}

function Key({ children }: { children: ReactNode }) { return <kbd>{children}</kbd>; }

function FocusPanel({ children, label, onDismiss, className = '' }: { children: ReactNode; label: string; onDismiss?: () => void; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const getFocusable = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]') ?? []);
    getFocusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismiss.current) { event.preventDefault(); dismiss.current(); }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); node?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !node?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className={`lounge-panel ${className}`} ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>;
}

function TouchControls({ onMove, onLook, onSprint, onInteract, interactionLabel }: {
  onMove?: LoungeInterfaceProps['onTouchMove']; onLook?: LoungeInterfaceProps['onTouchLook'];
  onSprint?: LoungeInterfaceProps['onTouchSprint']; onInteract?: () => void; interactionLabel?: string | null;
}) {
  const held = useRef(new Set<string>());
  const lastLook = useRef<{ id: number; x: number; y: number } | null>(null);
  const moveCallback = useRef(onMove);
  const sprintCallback = useRef(onSprint);
  moveCallback.current = onMove;
  sprintCallback.current = onSprint;
  useEffect(() => () => { moveCallback.current?.({ x: 0, y: 0 }); sprintCallback.current?.(false); }, []);
  function move(direction: string, pressed: boolean) {
    if (pressed) held.current.add(direction); else held.current.delete(direction);
    const x = Number(held.current.has('right')) - Number(held.current.has('left'));
    const y = Number(held.current.has('up')) - Number(held.current.has('down'));
    const magnitude = Math.max(1, Math.hypot(x, y));
    onMove?.({ x: x / magnitude, y: y / magnitude });
  }
  function endLook(event: ReactPointerEvent<HTMLDivElement>) { if (lastLook.current?.id === event.pointerId) lastLook.current = null; }
  return <div className="touch-controls" aria-label="Touch exploration controls">
    <div className="touch-dpad" role="group" aria-label="Walk">
      {(['up', 'left', 'down', 'right'] as const).map(direction => <button key={direction} type="button" className={`touch-key touch-${direction}`} aria-label={`Walk ${direction === 'up' ? 'forward' : direction === 'down' ? 'backward' : direction}`} onContextMenu={event => event.preventDefault()} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); move(direction, true); }} onPointerUp={() => move(direction, false)} onPointerCancel={() => move(direction, false)} onLostPointerCapture={() => move(direction, false)}><Icon name={direction} /></button>)}
      {onSprint && <button type="button" className="touch-sprint" onContextMenu={event => event.preventDefault()} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onSprint(true); }} onPointerUp={() => onSprint(false)} onPointerCancel={() => onSprint(false)} onLostPointerCapture={() => onSprint(false)}>Hold to run</button>}
    </div>
    <div className="touch-right">
      {interactionLabel && onInteract && <button className="button button-small button-primary" type="button" onClick={onInteract}>{interactionLabel.replace(/^E\s*[—–-]\s*/i, '')}</button>}
      <div className="touch-look" aria-label="Drag to look around" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); lastLook.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }} onPointerMove={event => { const previous = lastLook.current; if (!previous || previous.id !== event.pointerId) return; onLook?.({ x: event.clientX - previous.x, y: event.clientY - previous.y }); lastLook.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }} onPointerUp={endLook} onPointerCancel={endLook} onLostPointerCapture={endLook}><Icon name="look" /><span>Drag to look</span></div>
    </div>
  </div>;
}

export function LoungeInterface(props: LoungeInterfaceProps) {
  const { mode, loading, progress = 0, onExplore, onExploreDirect, onGoBack, onResume, onRestart, onRetry, onMenu, onInteract, onLeaveSeat, interactionLabel, seatedChair, error, qualityLabel, quality = 'auto', onQualityChange, reducedMotion = false, onReducedMotionChange, onToggleFullscreen, onTouchMove, onTouchLook, onTouchSprint } = props;
  const { playing = false, duration = 58, onCinematic, onTogglePlayback, cameraView = 'thirdPerson', onToggleCameraView, onTogglePointerLock } = props;
  const [isTouch, setIsTouch] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { const query = window.matchMedia('(pointer: coarse)'); const update = () => setIsTouch(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  const cinematic = mode === 'cinematic' || mode === 'handoff';
  const active = mode === 'explore' || mode === 'seated';
  const modal = mode === 'loading' || mode === 'welcome' || mode === 'menu' || mode === 'error' || mode === 'handoff';
  const measuredProgress = typeof loading?.progress === 'number' && Number.isFinite(loading.progress) ? Math.max(0, Math.min(1, loading.progress)) : null;
  const safeProgress = Math.max(0, Math.min(1, progress));
  return <div className={`lounge-interface mode-${mode}${reducedMotion ? ' reduced-motion' : ''}`}>
    <header className="lounge-header" aria-hidden={modal ? true : undefined}>
      <div className="lounge-brand"><span className="brand-mark">md.</span><span className="brand-rule" /><span className="brand-name">The Lounge<span>motiondesign.ad</span></span></div>
      <div className="header-actions">
        <span className="live-badge"><span />Live 3D</span>
        {!modal && onToggleFullscreen && <button type="button" className="icon-button fullscreen-button" aria-label="Toggle fullscreen" title="Fullscreen" onClick={onToggleFullscreen}><Icon name="fullscreen" /></button>}
        {!modal && onMenu && <button type="button" className="icon-button" aria-label="Open experience menu" title="Menu" onClick={onMenu}><Icon name="menu" /></button>}
      </div>
    </header>

    {mode === 'loading' && <div className="loading-layer"><div className="loading-content" role="status" aria-live="polite">
      <div className="loading-emblem" aria-hidden="true"><span>md.</span><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" /><circle className={measuredProgress === null ? 'loading-orbit' : 'loading-measured'} cx="60" cy="60" r="56" style={measuredProgress !== null ? { strokeDasharray: 352, strokeDashoffset: 352 * (1 - measuredProgress) } : undefined} /></svg></div>
      <p className="eyebrow">A space worth experiencing</p><h1>Preparing your visit.</h1>
      <p className="loading-phase">{loading?.phase || 'Preparing the scene'}{measuredProgress !== null && <span className="loading-percentage" aria-hidden="true">{Math.round(measuredProgress * 100)}%</span>}</p>
      {loading?.detail && <p className="loading-detail">{loading.detail}</p>}
      {measuredProgress !== null && <progress className="visually-hidden" aria-label={loading?.phase || 'Loading scene'} value={measuredProgress} max={1} />}
      <div className="loading-footnote"><Icon name="sun" size={14} /><span>Architecture, light, and a little time to take it in.</span></div>
    </div><p className="loading-bottom">Preparing the space for your visit.</p></div>}

    {mode === 'error' && <div className="modal-layer"><FocusPanel label="Scene could not load" className="error-panel"><p className="eyebrow">The lounge</p><h1>A moment, please.</h1><p className="panel-copy">{error || 'The scene could not be loaded. Check your connection and try again.'}</p><div className="panel-actions">{onRetry && <button className="button button-primary" type="button" onClick={onRetry}>Try again<Icon name="arrow" /></button>}</div><p className="panel-note">A recent browser with hardware acceleration gives this space its best light.</p></FocusPanel></div>}

    {mode === 'welcome' && <div className="welcome-layer"><FocusPanel label="Choose your experience" className="welcome-panel">
      <p className="eyebrow">The presentation lounge</p><h1>Come on in.</h1><p className="panel-copy">Find your own perspective, or let the architecture lead the way.</p>
      <div className="welcome-choices">
        <button type="button" className="experience-choice" onClick={onExploreDirect || onExplore}><span className="choice-icon"><Icon name="move" size={22} /></span><span><strong>Explore</strong><small>Walk freely through the space.</small></span><Icon name="arrow" /></button>
        <button type="button" className="experience-choice" onClick={onCinematic || onRestart}><span className="choice-icon"><Icon name="play" size={22} /></span><span><strong>Cinematic</strong><small>A {duration}-second guided perspective.</small></span><Icon name="arrow" /></button>
      </div><p className="panel-note">Take your time.</p>
    </FocusPanel></div>}

    {cinematic && <div className="cinematic-hud" aria-hidden={mode === 'handoff' ? true : undefined}>
      <div className="tour-caption"><p className="eyebrow">A guided perspective</p><p className="tour-title">Space. Light. Possibility.</p></div>
      {mode === 'cinematic' && <div className="cinematic-actions">
        <button type="button" className="button button-small button-quiet" onClick={onTogglePlayback} aria-label={playing ? 'Pause cinematic' : 'Resume cinematic'}><Icon name={playing ? 'pause' : 'play'} size={16} />{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="icon-button replay-button" onClick={onCinematic || onRestart} aria-label="Replay cinematic" title="Replay"><Icon name="replay" size={17} /></button>
        <button type="button" className="button button-small button-primary" onClick={onExploreDirect || onExplore}>Explore<Icon name="arrow" size={16} /></button>
      </div>}
      <div className="tour-timeline"><span className="timeline-index">{String(Math.floor(safeProgress * duration)).padStart(2, '0')}s</span><progress className="cinematic-progress" aria-label="Cinematic progress" max={1} value={safeProgress} /><span className="timeline-end">{duration}s</span></div>
    </div>}

    {mode === 'handoff' && <div className="handoff-layer"><FocusPanel label="Explore freely" className="handoff-panel" onDismiss={onGoBack}><p className="eyebrow">Make yourself at home</p><h1>Explore freely?</h1><p className="panel-copy">Take your own path through the lounge.</p><div className="panel-actions"><button type="button" className="button button-primary" onClick={onExplore}>Explore<Icon name="arrow" /></button><button type="button" className="button button-quiet" onClick={onGoBack}><Icon name="back" size={17} />Go back</button></div><p className="panel-note">{isTouch ? 'Touch controls will appear when you enter.' : 'W A S D to walk · Mouse to look · E to interact'}</p></FocusPanel></div>}

    {active && <>
      <div className="exploration-status"><span className="status-dot" /><span>{mode === 'seated' ? seatedChair === 'founder-desk' ? 'At the founder’s desk' : `Presentation view${seatedChair ? ` · ${typeof seatedChair === 'number' ? `Chair ${seatedChair}` : seatedChair}` : ''}` : 'Your own perspective'}</span></div>
      {(mode === 'explore' || seatedChair === 'founder-desk') && <div className="view-controls">{onToggleCameraView && <button type="button" className="button button-small button-quiet" onClick={onToggleCameraView}><Icon name="look" size={15} />{cameraView === 'thirdPerson' ? 'First person' : 'Third person'}{!isTouch && <Key>V</Key>}</button>}{mode === 'explore' && !isTouch && onTogglePointerLock && <button type="button" className="button button-small button-quiet" onClick={onTogglePointerLock}><Icon name="mouse" size={15} />Cursor<Key>L</Key></button>}</div>}
      {!isTouch && mode === 'explore' && <div className="aim-point" aria-hidden="true" />}
      {!isTouch && interactionLabel && <button type="button" className={`interaction-prompt${mode === 'seated' ? ' interaction-prompt-seated' : ''}`} onClick={onInteract}><Key>E</Key><span>{interactionLabel.replace(/^E\s*[—–-]\s*/i, '')}</span></button>}
      {mode === 'seated' && onLeaveSeat && <button type="button" className="leave-seat button button-small button-quiet" onClick={onLeaveSeat}><Icon name="back" size={16} />Stand up</button>}
      {!isTouch && <div className="explore-help"><button type="button" className="help-toggle" onClick={() => setHelpOpen(open => !open)} aria-expanded={helpOpen} aria-controls="movement-help">{helpOpen ? 'Hide controls' : 'Controls'}<span>?</span></button>{helpOpen && <div className="controls-popover" id="movement-help"><ControlInstructions /></div>}</div>}
      {isTouch && mode === 'explore' && <TouchControls onMove={onTouchMove} onLook={onTouchLook} onSprint={onTouchSprint} onInteract={onInteract} interactionLabel={interactionLabel} />}
    </>}

    {mode === 'menu' && <div className="modal-layer"><FocusPanel label="Experience menu" onDismiss={onResume} className="menu-panel"><div className="panel-heading"><p className="eyebrow">Take your time</p>{onResume && <button type="button" className="icon-button" aria-label="Close menu and resume" onClick={onResume}><Icon name="close" /></button>}</div><h1>The lounge is yours.</h1><ControlInstructions />
      {onQualityChange && <fieldset className="quality-setting"><legend>Rendering quality</legend><div className="quality-options">{(['auto', 'high', 'balanced'] as const).map(value => <label key={value} className={quality === value ? 'selected' : ''}><input type="radio" name="quality" value={value} checked={quality === value} onChange={() => onQualityChange(value)} />{value === 'auto' ? 'Automatic' : value === 'high' ? 'High' : 'Balanced'}</label>)}</div></fieldset>}
      {onReducedMotionChange && <label className="motion-setting"><span>Reduce camera motion<span>Shorter transitions and restrained movement.</span></span><input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotionChange(event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label>}
      <div className="panel-actions">{onResume && <button type="button" className="button button-primary" onClick={onResume}>Continue<Icon name="arrow" /></button>}{onExploreDirect && <button type="button" className="button button-quiet" onClick={onExploreDirect}>Explore directly</button>}<button type="button" className="button button-quiet" onClick={onCinematic || onRestart || onGoBack}>Replay cinematic</button></div>
    </FocusPanel></div>}

    {!modal && <footer className="lounge-footer"><span>MD / PRESENTATION LOUNGE</span>{qualityLabel && <span className="quality-status">{qualityLabel}</span>}</footer>}
  </div>;
}

function ControlInstructions() {
  return <dl className="control-instructions"><div><dt><Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key></dt><dd>Walk</dd></div><div><dt><Key>Shift</Key></dt><dd>Hold to run</dd></div><div><dt><Icon name="mouse" size={17} /></dt><dd>Look around</dd></div><div><dt><Key>L</Key></dt><dd>Lock / release cursor</dd></div><div><dt><Key>V</Key></dt><dd>First / third person</dd></div><div><dt><Key>E</Key></dt><dd>Sit or interact</dd></div><div><dt><Key>Esc</Key></dt><dd>Release cursor / menu</dd></div></dl>;
}

export default LoungeInterface;
