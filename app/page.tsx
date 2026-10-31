'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import LoungeInterface, { type LoungeMode } from '@/components/LoungeInterface';
import type { SceneRuntime } from '@/runtime/SceneRuntime';
import { createLoadingProgressPublisher } from '@/runtime/loadingProgressPublisher';
import type { DiagnosticMode } from '@/runtime/rendering/diagnostics';
import type { LoadingProgress, Quality, RuntimeHint, RuntimeMode, RuntimeStats } from '@/types';

export default function Home() {
  const viewport = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const loadingPublisher = useRef<ReturnType<typeof createLoadingProgressPublisher> | null>(null);
  const modeRef = useRef<RuntimeMode>('loading');
  const menuRef = useRef(false);
  const transitionRef = useRef(false);
  const welcomeRef = useRef(true);
  const touch = useRef({ x: 0, y: 0, sprint: false });
  const [generation, setGeneration] = useState(0);
  const [mode, setMode] = useState<RuntimeMode>('loading');
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState<LoadingProgress>({ phase: 'Preparing your visit' });
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState<RuntimeHint | null>(null);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<Quality>('auto');
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [profileReport, setProfileReport] = useState('');
  const [profiling, setProfiling] = useState(false);
  useEffect(() => { runtime.current?.noteUICommit(); });
  const [debug, setDebug] = useState(false);
  const [routeReverse,setRouteReverse]=useState(false),[routeSprint,setRouteSprint]=useState(false);
  const [referenceCameras, setReferenceCameras] = useState<string[]>([]);
  const [referenceCamera, setReferenceCamera] = useState('');
  const [diagnosticMode, setDiagnosticMode] = useState<DiagnosticMode>('full');
  const [transitioning, setTransitioning] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(58);
  const [cameraView, setCameraView] = useState<'thirdPerson' | 'bodyCam'>('thirdPerson');

  useEffect(() => {
    let cancelled = false;
    const progressUpdates = createLoadingProgressPublisher(value => { if (!cancelled) setLoading(value); });
    loadingPublisher.current = progressUpdates;
    setMode('loading'); setLoading({ phase: 'Preparing your visit' }); setError(''); setProgress(0);
    setReferenceCameras([]); setReferenceCamera(''); setDiagnosticMode('full');
    transitionRef.current = false; setTransitioning(false);
    welcomeRef.current = true; setWelcome(true); setPlaying(false);
    menuRef.current = false; setMenu(false);
    modeRef.current = 'loading';
    const preferredReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReducedMotion(preferredReduced);
    setProfiling(new URLSearchParams(window.location.search).get('profile') === '1');
    const diagnosticsEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
    setDebug(diagnosticsEnabled);
    import('@/runtime/SceneRuntime').then(async ({ SceneRuntime }) => {
      if (cancelled || !viewport.current) return;
      const instance = new SceneRuntime(viewport.current, {
        onProgress: progressUpdates.push,
        onReady: () => { progressUpdates.flush(); progressUpdates.dispose(); if (!cancelled) { setReferenceCameras(instance.manifest.cameras.map(camera => camera.id)); setDuration(instance.getCinematicDuration()); } },
        onModeChange: value => { if (!cancelled) { modeRef.current = value; setMode(value); if (value === 'error') { progressUpdates.dispose(); menuRef.current = false; setMenu(false); } } },
        onTourProgress: value => { if (!cancelled) setProgress(value); },
        onHint: value => { if (!cancelled) setHint(value); },
        onProfile: value => { if (!cancelled) setProfileReport(value); },
        onStats: diagnosticsEnabled ? value => { if (!cancelled) setStats(value); } : undefined,
        onError: value => { progressUpdates.dispose(); if (!cancelled) setError(value); },
        onScreenMode: value => { if (!cancelled) setScreenActive(value); },
        onTransition: value => { if (!cancelled) { transitionRef.current = value; setTransitioning(value); } },
        onPlaybackChange: value => { if (!cancelled) setPlaying(value); },
        onCameraViewChange: value => { if (!cancelled) setCameraView(value); },
      });
      runtime.current = instance;
      instance.setQuality(quality);
      instance.setReducedMotion(preferredReduced);
      await instance.init();
      if (cancelled) instance.dispose();
    }).catch(reason => { progressUpdates.dispose(); if (!cancelled) { setMode('error'); setError(reason instanceof Error ? reason.message : 'The experience could not start.'); } });
    return () => { cancelled = true; progressUpdates.dispose(); if (loadingPublisher.current === progressUpdates) loadingPublisher.current = null; runtime.current?.dispose(); runtime.current = null; };
  }, [generation]);

  const openMenu = useCallback(() => {
    if (modeRef.current === 'loading' || modeRef.current === 'error' || transitionRef.current || welcomeRef.current) return;
    menuRef.current = true; setMenu(true); runtime.current?.setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);
  const resume = useCallback(() => { menuRef.current = false; setMenu(false); runtime.current?.setPaused(false); }, []);

  useEffect(() => {
    const isField = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, button, [role="dialog"], [contenteditable="true"]');
    const keydown = (event: KeyboardEvent) => {
      if (transitionRef.current || welcomeRef.current) return;
      if (event.key === 'Escape') {
        if (menuRef.current || isField(event.target)) return;
        openMenu(); return;
      }
      if (isField(event.target) || menuRef.current || modeRef.current !== 'tour') return;
      if (event.key === ' ' && !event.repeat) { event.preventDefault(); runtime.current?.toggleCinematicPlayback(); }
    };
    const unlock = () => {
      if (!document.pointerLockElement && runtime.current?.consumeIntentionalUnlock()) return;
      if (!document.pointerLockElement && modeRef.current === 'explore') openMenu();
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('pointerlockchange', unlock);
    return () => { window.removeEventListener('keydown', keydown); document.removeEventListener('pointerlockchange', unlock); };
  }, [openMenu]);

  const dismissWelcome = useCallback(() => { welcomeRef.current = false; setWelcome(false); setReferenceCamera(''); }, []);
  const tour = useCallback(() => { dismissWelcome(); resume(); runtime.current?.startCinematic(); }, [dismissWelcome, resume]);
  const explore = useCallback(() => { dismissWelcome(); resume(); runtime.current?.explore(); }, [dismissWelcome, resume]);
  const exploreDirect = useCallback(() => { dismissWelcome(); resume(); runtime.current?.exploreDirectly(); }, [dismissWelcome, resume]);
  const changeQuality = (value: Quality) => { setQuality(value); runtime.current?.setQuality(value); };
  const sendTouch = (lookX = 0, lookY = 0) => runtime.current?.setVirtualInput(touch.current.x, touch.current.y, lookX, lookY, touch.current.sprint);
  const uiMode: LoungeMode = menu ? 'menu' : mode === 'tour' ? (welcome ? 'welcome' : progress === 1 ? 'handoff' : 'cinematic') : mode;
  const qualityLabel = debug && stats ? `${stats.renderer} · ${quality === 'auto' ? 'Adaptive' : quality === 'high' ? 'High detail' : 'Balanced'}` : undefined;

  return <main className="lounge-experience" data-mode={mode} data-screen-active={screenActive}>
    <div ref={viewport} className="scene-viewport" />
    <div hidden={transitioning}><LoungeInterface mode={uiMode} loading={loading} progress={progress} playing={playing} duration={duration}
      onCinematic={tour} onTogglePlayback={() => runtime.current?.toggleCinematicPlayback()}
      cameraView={cameraView} onToggleCameraView={() => runtime.current?.toggleCameraView()} onTogglePointerLock={() => runtime.current?.togglePointerLock()}
      onExplore={explore} onGoBack={tour} onMenu={openMenu} onResume={resume}
      onRestart={tour}
      onExploreDirect={exploreDirect}
      onRetry={() => { loadingPublisher.current?.dispose(); resume(); setGeneration(value => value + 1); }}
      onInteract={() => runtime.current?.interact()} onLeaveSeat={() => runtime.current?.stand()}
      interactionLabel={hint?.text} seatedChair={mode === 'seated' ? hint?.target : undefined}
      error={error} quality={quality} qualityLabel={qualityLabel} onQualityChange={changeQuality}
      reducedMotion={reducedMotion} onReducedMotionChange={value => { setReducedMotion(value); runtime.current?.setReducedMotion(value); }}
      onToggleFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}
      onTouchMove={value => { touch.current.x = value.x; touch.current.y = value.y; sendTouch(); }}
      onTouchLook={value => sendTouch(value.x, value.y)}
      onTouchSprint={value => { touch.current.sprint = value; sendTouch(); }} onTouchExit={openMenu}
    /></div>
    <noscript>This experience needs JavaScript and a browser with WebGPU or WebGL 2 to display the original architectural scene.</noscript>
    {debug && <aside aria-label="Render diagnostics" style={{ position: 'fixed', left: 16, top: 92, zIndex: 100, pointerEvents: 'auto', padding: '10px 14px', background: 'rgba(0,0,0,.82)', color: '#eee', font: '12px/1.6 monospace', border: '1px solid #777', borderRadius: 8 }}>
      <div>Render diagnostics</div>
      {profiling && <details><summary>Performance capture</summary>
        <button onClick={() => changeQuality("high")}>Lock full quality</button>
        <button onClick={() => runtime.current?.startProfile(referenceCamera || mode)}>Capture 15 seconds</button>
        <button onClick={() => { dismissWelcome(); resume(); setReferenceCamera(""); runtime.current?.setReferenceCamera(""); runtime.current?.returnToTour(); runtime.current?.setTourProgress(0); runtime.current?.setCinematicPlaying(true); runtime.current?.startProfile("tour first 15s"); }}>Capture tour</button>
        <div><button onClick={() => runtime.current?.inspectShadowCaching(false)}>Use full shadow pass</button><button onClick={() => runtime.current?.inspectShadowCaching(true)}>Use cached static shadows</button><button onClick={() => void runtime.current?.inspectShadowParity()}>Verify shadow pixels</button></div>
        <pre data-testid="performance-report" style={{ maxHeight: 210, maxWidth: 420, overflow: "auto", fontSize: 10 }}>{profileReport}</pre>
      </details>}
      <div>Phase: {mode}</div>
      <div>Renderer: {stats?.renderer ?? 'Preparing'}</div>
      <div>FPS: {stats?.fps ?? '—'} · Draw calls: {stats?.drawCalls ?? '—'}</div>
      <div>Triangles: {stats?.triangles.toLocaleString() ?? '—'}</div>
      <div>Resolution: {stats ? `${Math.round(stats.resolutionScale * 100)}%` : '—'} · Quality: {quality}</div>
      {stats?.frameP50Ms !== undefined && <div>Frame ms p50 / p95: {stats.frameP50Ms.toFixed(1)} / {stats.frameP95Ms?.toFixed(1)}</div>}
      {stats?.resourceMiB !== undefined && <div>Tracked buffers/textures: {Math.round(stats.resourceMiB)} MiB</div>}
      <div>Camera: {(progress * 100).toFixed(1)}%</div>
      {mode === 'tour' && <label style={{ display: 'block' }}>Tour preview (seconds)
        <input aria-label="Tour preview seconds" type="range" min={0} max={duration} step={0.5} value={progress * duration} style={{ width: '100%' }} onChange={event => { dismissWelcome(); runtime.current?.setCinematicPlaying(false); runtime.current?.setReferenceCamera(''); runtime.current?.setTourProgress(Number(event.target.value) / duration); }} />
      </label>}
      <label style={{ display: 'block', marginTop: 8 }}>Reference camera
        <select aria-label="Reference camera" value={referenceCamera} disabled={!referenceCameras.length} onChange={event => { dismissWelcome(); setReferenceCamera(event.target.value); runtime.current?.setReferenceCamera(event.target.value); }} style={{ display: 'block', color: '#fff', background: '#222', width: '100%', maxWidth: 290 }}>
          <option value="">Tour</option>
          {referenceCameras.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label style={{ display: 'block', marginTop: 6 }}>Material diagnostic
        <select aria-label="Material diagnostic" value={diagnosticMode} disabled={!referenceCameras.length} onChange={event => { const value = event.target.value as DiagnosticMode; setDiagnosticMode(value); runtime.current?.setDiagnosticMode(value); }} style={{ display: 'block', color: '#fff', background: '#222', width: '100%' }}>
          <option value="full">Full</option><option value="albedo">Albedo — unlit base</option><option value="baked">Baked diffuse only</option><option value="no-normals">Normals disabled</option><option value="no-shadows">Sun shadows disabled</option><option value="no-gi">Baked lighting disabled</option><option value="no-reflections">Environment reflections disabled</option><option value="no-ao">Ambient occlusion disabled</option>
        </select>
      </label>
      {diagnosticMode === 'baked' && <div style={{ maxWidth: 290 }}>No live sun or specular. Glass stays intact.</div>}
      {!!referenceCameras.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, maxWidth: 420 }}>{(['entrance', 'studio', 'founder-lift', 'bridge', 'gallery', 'founder-room', 'founder-balcony', 'gallery-return', 'founder-desk', 'exterior-east', 'exterior-west', 'lounge-chair', 'spiral-stair', 'rounded-stair'] as const).map(location => <button type="button" key={location} onClick={() => { dismissWelcome(); resume(); setDiagnosticMode('full'); runtime.current?.inspectMovement(location); }}>Test {location} movement</button>)}</div>}
      {debug && mode === 'explore' && <details><summary>Character inspection</summary>
        <div><label><input type="checkbox" checked={routeReverse} onChange={e=>setRouteReverse(e.target.checked)}/>Descending route</label><label><input type="checkbox" checked={routeSprint} onChange={e=>setRouteSprint(e.target.checked)}/>Running route</label>{(['spiral','rounded','entrance'] as const).map(kind=><button key={kind} onClick={()=>runtime.current?.inspectStairRoute(kind,routeReverse,routeSprint)}>Prepare {kind} route</button>)}<button onClick={()=>runtime.current?.playInspectionRoute()}>Play prepared route</button></div>
        <button onClick={()=>runtime.current?.inspectStepMotion()}>Walk +0.1 s / freeze</button><button onClick={()=>runtime.current?.inspectStepMotion(true)}>Run +0.1 s / freeze</button>
        <output aria-label="Character motion diagnostics" style={{display:'block',maxWidth:420,maxHeight:90,overflow:'auto',fontSize:10}}>{JSON.stringify(runtime.current?.getInteractionState()?.locomotion)}</output>
        {(['third-person', 'side', 'front'] as const).map(view => <button key={view} onClick={() => runtime.current?.inspectCharacterView(view)}>Character {view} view</button>)}
        <div>{([['Forward', 0, 1], ['Back', 0, -1], ['Left', -1, 0], ['Right', 1, 0], ['Stop', 0, 0]] as const).map(([label,x,y]) => <button key={label} onClick={() => runtime.current?.inspectWalk(x,y)}>{label} {label === 'Stop' ? '' : '1 s'}</button>)}<button onClick={() => runtime.current?.inspectWalk(0,1,true)}>Sprint 1 s</button></div>
      </details>}
      {debug && runtime.current?.getInteractionState()?.deskStage && <details><summary>Chair inspection</summary><output style={{ display: 'block', maxWidth: 320, overflowWrap: 'anywhere' }}>{JSON.stringify(runtime.current?.getInteractionState())}</output>{(['third-person', 'side', 'front'] as const).map(view => <button key={view} onClick={() => runtime.current?.inspectDeskView(view)}>Chair {view} view</button>)}</details>}
    </aside>}
  </main>;
}
