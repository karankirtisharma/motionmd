import { AgXToneMapping, AnimationMixer, Box3, Clock, Group, Material, MathUtils, Mesh, Object3D, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector3 } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SceneKTX2Loader } from './rendering/SceneKTX2Loader';
import { createReplacedGalleryAlbedoPlugin } from './rendering/replacedGalleryAlbedo';
import { createMeshoptDecoder } from './rendering/meshoptDecode';
import { loadProgressively } from './rendering/progressiveLoad';
import { architectureProgress } from './rendering/loadingProgress';
import type { Quality, RuntimeCallbacks, RuntimeMode, SceneManifest } from '@/types';
import { assetURL, fetchBuffer, resolveAssetDependency } from './rendering/assets';
import { applyMaterialManifest, prepareSourceMaterials } from './rendering/materials';
import { repairArchitecturalJoins } from './rendering/architecturalJoins';
import { repairExteriorWinding, repairExteriorOverlap, repairExteriorGroove } from './rendering/exteriorSurfaces';
import { repairFounderExteriorWinding, installExteriorLighting } from './rendering/exteriorLighting';
import { repairStudioThreshold } from './rendering/floorThreshold';
import { repairEntranceApron } from './rendering/entranceApron';
import { configureLighting } from './rendering/lighting';
import { configureSourceColor } from './rendering/color';
import { RenderDiagnostics, type DiagnosticMode } from './rendering/diagnostics';
import { CinematicPath, CINEMATIC_SECONDS, CINEMATIC_HANDOFF } from './rendering/cinematic';
import { createDesertEnvironment } from './rendering/DesertEnvironment';
import { guardShaderCompilation } from './rendering/shaderValidation';
import { createAssetLoadGuard } from './rendering/loadingGuard';
import { createTemporalRenderer } from './rendering/TemporalRenderer';
import { filterSourceSpecular } from './rendering/specularFiltering';
import { partitionSourceGeometry } from './rendering/spatialVisibility';
import { createGalleryMirror } from './rendering/galleryMirror';
import { freezeArchitectureTransforms } from './rendering/staticTransforms';
import { StaticSunShadowCache } from './rendering/staticSunShadowCache';
import { createDrawingBufferResizer } from './rendering/resizeDrawingBuffer';
import { qualifiesAdaptiveWindow } from './rendering/adaptiveWindow';
import { createInteractionController } from './interaction/InteractionController';

import { RuntimeProfiler } from './rendering/RuntimeProfiler';

// r186 TRAA retains 95% of history per static sample. 128 frames leave <0.15%
// of the initial history before a genuinely frozen view stops drawing.
const TEMPORAL_SETTLE_FRAMES = 128;

type InteractionController = Awaited<ReturnType<typeof createInteractionController>>;

export class SceneRuntime {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(48, 1, 0.1, 1800);
  readonly content = new Group();
  renderer!: WebGPURenderer;
  private rendererReady = false;
  manifest!: SceneManifest;
  private callbacks: RuntimeCallbacks;
  private container: HTMLElement;
  private mode: RuntimeMode = 'loading';
  private disposed = false;
  private abort = new AbortController();
  private observer?: ResizeObserver;
  private controls?: InteractionController;
  private lighting?: Awaited<ReturnType<typeof configureLighting>>;
  private desert?: Awaited<ReturnType<typeof createDesertEnvironment>>;
  private shaderValidation?: ReturnType<typeof guardShaderCompilation>;
  private temporal?: ReturnType<typeof createTemporalRenderer>;
  private galleryMirror?: ReturnType<typeof createGalleryMirror>;
  private staticTransforms?: ReturnType<typeof freezeArchitectureTransforms>;
  private reflectionRevision = 0;
  private staticSunShadowCache?: StaticSunShadowCache;
  private auditBusy = false;
  private textures = new Set<Texture>();
  private ktx2?: SceneKTX2Loader;
  private mixers: Array<{ mixer: AnimationMixer; duration: number }> = [];
  private cinematic?: CinematicPath;
  private cinematicPlaying = false;
  private targetProgress = 0;
  private progress = 0;
  private progressNotified = -1;
  private lastAppliedTourProgress?: number;
  private clock = new Clock(false);
  private quality: Quality = 'auto';
  private resolutionScale = 1;
  private resizeDrawingBuffer = createDrawingBufferResizer();
  private statsFrames = 0;
  private statsTime = 0;
  private statsLongGaps = 0;
  private statsLongGapTime = 0;
  private frameSamples: number[] = [];
  private slowWindows = 0;
  private fastWindows = 0;
  private renderErrorReported = false;
  private sceneTransition?: { elapsed: number; moved: boolean; progress: number; destination: 'tour' | 'explore' };
  private paused = false;
  private reducedMotion = false;
  private diagnostics?: RenderDiagnostics;
  private referenceCamera = '';
  private inspectionEnabled = false;
  private inspectionWalkTime = 0;
  private inspectionRoute?: { points: Vector3[]; index: number; sprint: boolean };
  private profiler?: RuntimeProfiler;
  private settleFrames = TEMPORAL_SETTLE_FRAMES;

  constructor(container: HTMLElement, callbacks: RuntimeCallbacks = {}) {
    this.container = container; this.callbacks = callbacks;
    this.content.name = 'MD | original Blender architecture';
    this.scene.add(this.content);
  }

  async init(): Promise<void> {
    try {
      this.callbacks.onProgress?.({ phase: 'Preparing your visit', detail: 'Checking the graphics device' });
      const query = new URLSearchParams(window.location.search);
      this.inspectionEnabled = query.get('debug') === '1';
      if (this.inspectionEnabled && query.get('profile') === '1') {
        this.profiler = new RuntimeProfiler(report => this.callbacks.onProfile?.(report), () => ({
          backend: this.renderer && 'isWebGPUBackend' in this.renderer.backend ? 'WebGPU' : 'WebGL 2', mode: this.mode, reference: this.referenceCamera, progress: this.progress, quality: this.quality, scale: this.resolutionScale,
          viewport: [this.container.clientWidth, this.container.clientHeight], dpr: window.devicePixelRatio,
          drawingBuffer: this.renderer ? [this.renderer.domElement.width, this.renderer.domElement.height] : [],
          trackedMiB: this.renderer ? (this.renderer.info.memory.texturesSize + this.renderer.info.memory.attributesSize) / 1048576 : 0,
          shadowCache: this.staticSunShadowCache?.stats, draws: this.renderer?.info.render.drawCalls, triangles: this.renderer?.info.render.triangles, userAgent: navigator.userAgent, visibility: document.visibilityState
        }));
      }
      const forceWebGL = this.inspectionEnabled && query.get('renderer') === 'webgl';
      this.renderer = new WebGPURenderer({ antialias: false, alpha: false, samples: 0, reversedDepthBuffer: true, forceWebGL });
      this.renderer.toneMapping = AgXToneMapping;
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFShadowMap;
      this.renderer.onDeviceLost = info => {
        if (this.disposed) return;
        console.error('[MD device lost]', { api: info.api, reason: info.reason, message: info.message, textureMemoryBytes: this.renderer.info.memory.texturesSize, geometryMemoryBytes: this.renderer.info.memory.attributesSize });
        this.fail('The graphics device was interrupted. Reload the experience to continue.');
      };
      await this.renderer.init();
      console.info('[MD depth]', { reversed: this.renderer.reversedDepthBuffer, near: this.camera.near, far: this.camera.far });
      this.rendererReady = true;
      if (this.disposed) { void this.renderer.dispose().catch(error => console.warn('[MD cleanup]', error)); return; }
      this.shaderValidation = guardShaderCompilation(this.renderer, message => this.fail(message));
      this.profiler?.attachRenderer(this.renderer);
      const canvas = this.renderer.domElement as HTMLCanvasElement;
      canvas.className = 'scene-canvas';
      canvas.setAttribute('aria-label', 'Live 3D architectural scene');
      canvas.tabIndex = 0;
      this.container.appendChild(canvas);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.container);
      this.resize();
      document.addEventListener('visibilitychange', this.onVisibility);

      const response = await fetch(assetURL('/assets/scene-manifest.json'), { signal: this.abort.signal });
      if (!response.ok) throw new Error('The architectural scene is not available. Please try again.');
      this.manifest = await response.json() as SceneManifest;
      this.validateManifest();
      this.renderer.toneMappingExposure = Math.pow(2, this.manifest.exposure ?? 0.1);
      const colorLUT = await configureSourceColor(this.renderer, this.manifest.colorPipeline, this.abort.signal);
      if (colorLUT) this.textures.add(colorLUT);
      this.abort.signal.throwIfAborted();
      this.prepareCamera();
      this.applyTourCamera(1 / 60, true);
      this.profiler?.phase('geometry and embedded textures');
      await this.loadSource();
      if (this.disposed) return;
      repairExteriorWinding(this.content);
      repairExteriorOverlap(this.content);
      repairExteriorGroove(this.content);
      repairFounderExteriorWinding(this.content);
      repairArchitecturalJoins(this.content);
      repairStudioThreshold(this.content);
      repairEntranceApron(this.content);
      // Source clips are available only after loading; apply their initial pose once.
      this.applyTourCamera(0, true);
      // Canonicalize glTF UV-channel clones before node graphs capture their texture references.
      prepareSourceMaterials(this.content, this.renderer).forEach(t => this.textures.add(t));

      this.callbacks.onProgress?.({ phase: 'Preparing the light', detail: 'Loading source materials and room illumination' });
      this.profiler?.phase('material maps and lightmaps');
      const materialTextures = await applyMaterialManifest(this.content, this.manifest, this.abort.signal);
      materialTextures.forEach(t => this.textures.add(t));
      const exteriorTextures = await installExteriorLighting(this.content, this.abort.signal);
      exteriorTextures.forEach(t => this.textures.add(t));
      this.abort.signal.throwIfAborted();
      prepareSourceMaterials(this.content, this.renderer).forEach(t => this.textures.add(t));
      const bounds = new Box3().setFromObject(this.content);
      this.profiler?.phase('lighting and reflection probes');
      this.lighting = await configureLighting(this.scene, this.renderer, this.manifest, bounds, this.abort.signal);
      if (this.disposed || this.abort.signal.aborted) { this.lighting.dispose(); return; }
      this.profiler?.phase('spatial preparation and desert');
      this.galleryMirror = createGalleryMirror(this.content);
      // Preserve each source material's complete probe graph before subdividing
      // its visibility bounds; every cell then shares that same final shader.
      partitionSourceGeometry(this.content);
      this.desert = await createDesertEnvironment(this.scene, { signal: this.abort.signal, sunDirection: this.manifest.sun?.position });
      if (this.disposed || this.abort.signal.aborted) { this.desert.dispose(); return; }
      this.setQuality(this.quality);

      this.callbacks.onProgress?.({ phase: 'Preparing exploration', detail: 'Loading movement, collisions and interactions' });
      this.profiler?.phase('movement, collisions and avatar');
      this.controls = await createInteractionController({
        scene: this.scene, camera: this.camera, renderer: this.renderer,
        canvas, manifest: this.manifest, signal: this.abort.signal,
        onStateChange: (mode: 'explore' | 'seated') => this.setMode(mode),
        onPrompt: (hint: {text: string; target?: string} | null) => this.callbacks.onHint?.(hint),
        onScreenMode: (active: boolean) => this.callbacks.onScreenMode?.(active),
        onCameraViewChange: view => this.callbacks.onCameraViewChange?.(view),
      });
      if (this.disposed || this.abort.signal.aborted) { this.controls.dispose(); return; }
      this.controls.setEnabled(false);
      this.lighting.refreshProbeLighting(this.controls.player, true);
      filterSourceSpecular(this.scene);
      this.staticTransforms = freezeArchitectureTransforms(this.content, this.mixers.map(({ mixer }) => mixer.getRoot() as Object3D));
      console.info('[MD static transforms]', { cached: this.staticTransforms.count });
      this.staticSunShadowCache = new StaticSunShadowCache(this.lighting.sun, { isStatic: this.staticTransforms.has, enabled: query.get('shadowCache') !== '0' });
      this.lighting.sun.shadow.shadowNode = this.staticSunShadowCache;

      this.profiler?.phase('texture upload');
      const warmStarted = performance.now();
      const activeTextures = prepareSourceMaterials(this.scene, this.renderer);
      activeTextures.forEach(texture => this.textures.add(texture));
      const uploadTextures = [...activeTextures].filter(texture => !texture.userData.mdSkipUpload);
      console.info('[MD warmup] texture upload started', { count: uploadTextures.length, visibility: document.visibilityState });
      this.callbacks.onProgress?.({ phase: 'Preparing textures', detail: `Uploading 0 of ${uploadTextures.length} textures to your graphics device`, progress: 0 });
      let uploaded = 0;
      for (const texture of uploadTextures) {
        this.renderer.initTexture(texture);
        uploaded++;
        if (uploaded % 8 === 0 || uploaded === uploadTextures.length) {
          this.callbacks.onProgress?.({ phase: 'Preparing textures', detail: `Uploaded ${uploaded} of ${uploadTextures.length} textures`, progress: uploaded / uploadTextures.length });
          console.info('[MD warmup] uploaded textures', { uploaded, total: uploadTextures.length, seconds: ((performance.now() - warmStarted) / 1000).toFixed(1) });
          // Upload preparation must finish even when the browser throttles animation frames.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        this.abort.signal.throwIfAborted();
      }
      this.profiler?.phase('shader compilation');
      const compileStarted = performance.now();
      this.callbacks.onProgress?.({ phase: 'Preparing materials', detail: 'Compiling the scene for your graphics device' });
      console.info('[MD warmup] shader compilation started');
      this.temporal = createTemporalRenderer(this.renderer, this.scene, this.camera);
      await this.temporal.warmup(event => {
        if (this.disposed || this.abort.signal.aborted) return;
        this.callbacks.onProgress?.({ phase: 'Preparing materials', detail: `Compiled ${event.loaded} of ${event.total} render objects`, progress: event.lengthComputable && event.total ? event.loaded / event.total : undefined });
        if (event.loaded % 12 === 0 || event.loaded === event.total) console.info('[MD warmup] shader compilation', { loaded: event.loaded, total: event.total, seconds: ((performance.now() - compileStarted) / 1000).toFixed(1) });
      });
      this.callbacks.onProgress?.({ phase: 'Preparing reflections', detail: 'Finishing the first live reflection' });
      this.profiler?.phase('first reflection frame');
      this.galleryMirror?.update(this.renderer, this.scene, this.camera);
      this.temporal.render();
      this.profiler?.phase('first GPU frame completion');
      await this.temporal.finishFirstFrame();
      console.info('[MD warmup] shader compilation complete', { seconds: ((performance.now() - compileStarted) / 1000).toFixed(1) });
      this.shaderValidation.assertCompiled();
      this.abort.signal.throwIfAborted();
      // Source architecture and sunset are fixed. Reuse their shadow map throughout the
      // cinematic; character motion invalidates it during exploration below.
      this.lighting.sun.shadow.autoUpdate = false;
      this.setMode('tour');
      this.callbacks.onProgress?.({ phase: 'Ready', progress: 1 });
      this.callbacks.onReady?.();
      this.profiler?.ready();
      this.clock.start();
      this.renderer.setAnimationLoop(this.tick);
    } catch (error) {
      if (this.disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      console.error('[MD scene]', error);
      this.fail(error instanceof Error ? error.message : 'The scene could not be loaded.');
    }
  }

  private validateManifest() {
    if (this.manifest.coordinateSystem !== 'three-y-up' || this.manifest.units !== 'meters') throw new Error('Scene coordinates are not compatible with this build.');
    if (!this.manifest.chunks?.length) throw new Error('No exported source geometry is available.');
    if (!(this.manifest.tour?.length || this.manifest.cameras?.length)) throw new Error('The cinematic camera path is missing.');
  }

  private async loadSource() {
    const loadGuard = createAssetLoadGuard(resolveAssetDependency);
    const loader = new GLTFLoader(loadGuard.manager);
    const decoder = createMeshoptDecoder(this.abort.signal);
    loader.setMeshoptDecoder(decoder);
    this.ktx2 = new SceneKTX2Loader(loadGuard.manager, this.abort.signal).setTranscoderPath(assetURL('/assets/basis/')).setWorkerLimit(2).detectSupport(this.renderer);
    loader.setKTX2Loader(this.ktx2);
    const chunks = [...this.manifest.chunks].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const bytes = new Map<string, number>();
    const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    let lastProgressAt = 0;
    try { await loadProgressively(chunks, this.abort.signal, (chunk, signal) => fetchBuffer(chunk.url, signal, (loaded, _decodedTotal, delivery) => {
          bytes.set(chunk.id, loaded);
          const now = performance.now();
          if (now - lastProgressAt < 80) return;
          lastProgressAt = now;
          const received = [...bytes.values()].reduce((sum, value) => sum + value, 0);
          this.callbacks.onProgress?.(architectureProgress(received, total, delivery));
        }, chunk.bytes), async (chunk, buffer) => {
        if (this.disposed) return;
        const absolute = new URL(assetURL(chunk.url), window.location.href).href;
        const omitSuperseded = createReplacedGalleryAlbedoPlugin(chunk.url);
        loader.register(omitSuperseded);
        const gltf = await loader.parseAsync(buffer, absolute.slice(0, absolute.lastIndexOf('/') + 1))
          .finally(() => loader.unregister(omitSuperseded));
        if (this.disposed || this.abort.signal.aborted) { this.disposeObject(gltf.scene, true); return; }
        try { loadGuard.assertLoaded(); }
        catch (error) { this.disposeObject(gltf.scene, true); throw error; }
        gltf.scene.name = `MD source | ${chunk.id}`;
        // Manifest lighting is authoritative; exported lights would otherwise be duplicated.
        const lights: Object3D[] = [];
        gltf.scene.traverse(object => { if ('isLight' in object) lights.push(object); });
        lights.forEach(light => light.removeFromParent());
        this.content.add(gltf.scene);
        if (gltf.animations.length) {
          const mixer = new AnimationMixer(gltf.scene);
          let duration = 0;
          for (const clip of gltf.animations) { mixer.clipAction(clip).play(); duration = Math.max(duration, clip.duration); }
          this.mixers.push({ mixer, duration });
        }
      });
      loadGuard.assertLoaded();
    } finally { decoder.dispose(); }
  }

  private prepareCamera() {
    this.cinematic = new CinematicPath(this.manifest);
  }

  private applyTourCamera(dt: number, immediate = false) {
    if (!this.cinematic) return;
    if (!immediate && this.cinematicPlaying) this.targetProgress = Math.min(1, this.targetProgress + dt / CINEMATIC_SECONDS);
    this.progress = this.targetProgress;
    if (this.progress === 1 && this.cinematicPlaying) this.setCinematicPlaying(false);
    if (!immediate && this.lastAppliedTourProgress === this.progress) return;
    this.lastAppliedTourProgress = this.progress;
    const pose = this.cinematic.sample(this.progress);
    if (this.controls?.setCinematicLiftPose(pose.lift) && this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    for (const { mixer, duration } of this.mixers) mixer.setTime(this.progress * Math.max(duration - 0.0001, 0));
    if (this.mixers.length && this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    if (Math.abs(this.progress - this.progressNotified) > 0.001 || this.progress === 0 || this.progress === 1) {
      if (this.progress !== this.progressNotified) { this.progressNotified = this.progress; this.callbacks.onTourProgress?.(this.progress); }
    }
  }

  private tick = () => {
    if (this.disposed || this.mode === 'error' || this.auditBusy) return;
    const elapsed = this.clock.getDelta();
    if (document.hidden) return;
    const profileStart = this.profiler ? performance.now() : 0;
    const priorProgress = this.progress;
    const dt = Math.min(elapsed, 0.05);
    let characterAdvanced = false;
    if (this.sceneTransition) this.updateSceneTransition(dt);
    else if (!this.paused && !this.referenceCamera) {
      if (this.mode === 'tour') this.applyTourCamera(dt);
      else {
        if (this.inspectionWalkTime > 0) {
          this.inspectionWalkTime = Math.max(0, this.inspectionWalkTime - dt);
          if (!this.inspectionWalkTime) this.controls?.setVirtualInput(0, 0);
        }
        this.advanceInspectionRoute();
        characterAdvanced = this.controls?.update(dt) ?? false;
      }
    }
    // Idle breathing and seated motion still cast changing shadows. Frozen reference
    // views, menus and fades reuse the map until an explicit scene change below.
    if (characterAdvanced && this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    if (characterAdvanced || this.sceneTransition || priorProgress !== this.progress || this.lighting?.sun.shadow.needsUpdate) this.invalidate();
    const shouldRender = this.settleFrames > 0;
    const simulationDone = this.profiler ? performance.now() : 0;
    let mirrorDone = simulationDone;
    try { if (shouldRender) { this.settleFrames--; this.galleryMirror?.update(this.renderer, this.scene, this.camera, this.reflectionRevision); mirrorDone = this.profiler ? performance.now() : 0; if (this.temporal) this.temporal.render(); else this.renderer.render(this.scene, this.camera); } }
    catch (error) { if (!this.renderErrorReported) { this.renderErrorReported = true; console.error(error); this.fail('The graphics device could not finish rendering the scene. Close other graphics-heavy tabs and try again.'); } return; }
    this.profiler?.frame(elapsed * 1000, simulationDone - profileStart, mirrorDone - simulationDone, shouldRender ? performance.now() - mirrorDone : 0, shouldRender);
    this.statsFrames++; this.statsTime += elapsed;
    if (elapsed >= .25) { this.statsLongGaps++; this.statsLongGapTime += elapsed; }
    if (this.inspectionEnabled) this.frameSamples.push(elapsed * 1000);
    if (this.statsTime > 2) {
      try { this.shaderValidation?.assertCompiled(); }
      catch { return; }
      const fps = this.statsFrames / this.statsTime;
      if (!qualifiesAdaptiveWindow(this.statsFrames, this.statsTime, this.statsLongGaps, this.statsLongGapTime)) this.slowWindows = this.fastWindows = 0;
      else if (this.quality === 'auto' && !this.paused && shouldRender) this.adaptResolution(fps);
      const samples = this.frameSamples.sort((a, b) => a - b);
      this.callbacks.onStats?.({ fps: Math.round(fps), drawCalls: this.renderer.info.render.drawCalls, triangles: this.renderer.info.render.triangles, renderer: 'isWebGPUBackend' in this.renderer.backend ? 'WebGPU' : 'WebGL 2', quality: this.quality, resolutionScale: this.resolutionScale,
        frameP50Ms: samples[Math.floor(samples.length * .5)], frameP95Ms: samples[Math.floor(samples.length * .95)],
        resourceMiB: (this.renderer.info.memory.texturesSize + this.renderer.info.memory.attributesSize) / 1048576 });
      this.frameSamples.length = 0;
      this.statsFrames = 0; this.statsTime = 0; this.statsLongGaps = 0; this.statsLongGapTime = 0;
    }
  };

  private adaptResolution(fps: number) {
    // Auto should recover toward 60 Hz, rather than accepting sustained 40 Hz.
    // Separate thresholds and small changes avoid resolution oscillation.
    this.slowWindows = fps < 55 ? this.slowWindows + 1 : 0;
    this.fastWindows = fps > 68 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.resolutionScale > 0.65) { this.resolutionScale = Math.max(0.65, this.resolutionScale - 0.05); this.slowWindows = 0; this.resize(); }
    if (this.fastWindows >= 4 && this.resolutionScale < 1) { this.resolutionScale = Math.min(1, this.resolutionScale + 0.05); this.fastWindows = 0; this.resize(); }
  }

  private invalidate() { this.reflectionRevision++; this.settleFrames = TEMPORAL_SETTLE_FRAMES; }

  private resize() {
    if (!this.renderer || this.disposed || this.auditBusy) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    const cap = this.quality === 'balanced' ? 1.25 : 2;
    const changed = this.resizeDrawingBuffer(this.renderer, width, height, Math.min(window.devicePixelRatio, cap) * this.resolutionScale);
    const projectionChanged = this.camera.aspect !== width / height;
    if (!changed && !projectionChanged) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  private onVisibility = () => { this.profiler?.visibility(); this.invalidate(); this.clock.getDelta(); this.statsFrames = 0; this.statsTime = 0; this.statsLongGaps = 0; this.statsLongGapTime = 0; this.frameSamples.length = 0; this.slowWindows = this.fastWindows = 0; };
  private setMode(mode: RuntimeMode) { if (!this.disposed) { this.mode = mode; this.callbacks.onModeChange?.(mode); } }
  private fail(message: string) {
    if (this.disposed || this.mode === 'error') return;
    this.abort.abort(); this.controls?.setEnabled(false);
    this.sceneTransition = undefined;
    if (this.renderer) (this.renderer.domElement as HTMLCanvasElement).style.opacity = '1';
    this.callbacks.onTransition?.(false);
    if (this.rendererReady) void this.renderer.setAnimationLoop(null);
    this.setMode('error'); this.callbacks.onError?.(message);
    if (document.pointerLockElement === this.renderer?.domElement) document.exitPointerLock();
  }

  startProfile(label: string) { if (!this.auditBusy) this.profiler?.start(label); }
  inspectShadowCaching(enabled: boolean) {
    if (!this.inspectionEnabled || this.auditBusy) return;
    this.staticSunShadowCache?.setEnabled(enabled); this.invalidate();
  }
  async inspectShadowParity() {
    if (!this.inspectionEnabled || this.auditBusy || !this.staticSunShadowCache || !this.lighting || !this.temporal) return;
    const paused = this.paused;
    this.setPaused(true); this.auditBusy = true;
    this.callbacks.onProfile?.(JSON.stringify({ shadowAudit: 'Comparing fixed-pose GPU output' }));
    try {
      const { auditShadowCache } = await import('./rendering/shadowCacheAudit');
      const result = await auditShadowCache({ renderer: this.renderer, scene: this.scene, camera: this.camera,
        cache: this.staticSunShadowCache, shadow: this.lighting.sun.shadow, signal: this.abort.signal,
        pass: this.temporal.getAuditTarget(), benchmarkFrames: 16 });
      this.callbacks.onProfile?.(JSON.stringify({ shadowAudit: result }, null, 2));
    } catch (error) {
      if (!this.disposed) this.callbacks.onProfile?.(JSON.stringify({ shadowAuditError: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.auditBusy = false;
      if (!this.disposed) {
        this.clock.getDelta(); this.lighting.sun.shadow.needsUpdate = true;
        this.temporal?.reset(); this.setPaused(paused); this.resize();
      }
    }
  }
  noteUICommit() { this.profiler?.uiCommit(); }

  setTourProgress(progress: number) {
    this.invalidate();
    if (Math.abs(progress - this.targetProgress) > 0.01) this.temporal?.reset();
    this.targetProgress = MathUtils.clamp(progress, 0, 1);
    if (this.sceneTransition?.destination === 'tour') this.sceneTransition.progress = this.targetProgress;
  }
  getTourProgress() { return this.targetProgress; }
  getCinematicDuration() { return CINEMATIC_SECONDS; }
  setCinematicPlaying(value: boolean) {
    this.cinematicPlaying = value;
    this.callbacks.onPlaybackChange?.(value);
  }
  toggleCinematicPlayback() {
    if (this.mode !== 'tour' || this.sceneTransition) return;
    if (this.targetProgress === 1) this.startCinematic();
    else this.setCinematicPlaying(!this.cinematicPlaying);
  }
  startCinematic(restart = true) {
    if (this.mode === 'loading' || this.mode === 'error' || this.disposed) return;
    const requiresTransition = this.mode !== 'tour' || (restart && this.targetProgress > 0) || !!this.referenceCamera;
    this.setCinematicPlaying(true);
    if (requiresTransition) this.beginSceneTransition('tour', restart ? 0 : this.targetProgress);
    else { this.targetProgress = restart ? 0 : this.targetProgress; this.paused = false; }
  }
  setReducedMotion(value: boolean) { this.reducedMotion = value; }
  setDiagnosticMode(mode: DiagnosticMode) {
    this.invalidate();
    if (!this.inspectionEnabled || !this.manifest) return;
    // Interactive furniture is reparented into the scene after loading.
    this.diagnostics ??= new RenderDiagnostics(this.scene);
    this.diagnostics.setMode(mode);
    this.staticSunShadowCache?.invalidate('material diagnostic');
    // Keep the cached ShadowNode/render target alive when comparing modes.
    if (this.lighting) this.lighting.sun.shadow.intensity = mode === 'no-shadows' ? 0 : 1;
    this.temporal?.reset();
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
  }
  setReferenceCamera(id: string) {
    this.invalidate();
    if (!this.inspectionEnabled || !this.manifest) return;
    this.temporal?.reset();
    if (!id) {
      this.referenceCamera = '';
      if (this.mode === 'tour') this.applyTourCamera(0, true);
      if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
      return;
    }
    const frame = this.manifest.cameras.find(camera => camera.id === id);
    if (!frame) return;
    this.referenceCamera = id;
    this.camera.position.fromArray(frame.position);
    this.camera.lookAt(new Vector3().fromArray(frame.target));
    this.camera.fov = frame.fov; this.camera.updateProjectionMatrix();
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
  }
  inspectMovement(location: 'entrance' | 'studio' | 'founder-lift' | 'bridge' | 'gallery' | 'founder-room' | 'founder-balcony' | 'gallery-return' | 'founder-desk' | 'exterior-east' | 'exterior-west' | 'lounge-chair' | 'spiral-stair' | 'rounded-stair') {
    if (!this.inspectionEnabled || !this.controls || this.mode === 'loading' || this.mode === 'error' || this.sceneTransition) return;
    const positions = { 'spiral-stair': [20.31, .7, -20.2], 'rounded-stair': [8.3, 3.675, -23], 'exterior-east': [23, -.01, -25], 'exterior-west': [-1.6, -.01, -28], 'lounge-chair': [11.9, 4.265, -3.8], entrance: [-8, -.355, -17.1], studio: [16.4, .03, -30.7], 'founder-lift': [13.35, .035, -3.35], bridge: [-1.3, 4.2, -17], gallery: [12, 3.675, -24.05], 'founder-room': [16, 4.23, -8.7], 'founder-balcony': [11, 4.23, -10.25], 'gallery-return': [8.14, 3.675, -24.48], 'founder-desk': [14.8, 4.265, -6.1] };
    const spawn = { position: positions[location] as [number, number, number], yaw: location === 'rounded-stair' ? Math.PI / 2 : location === 'spiral-stair' ? Math.PI : location === 'founder-lift' ? Math.PI : location === 'gallery-return' ? -Math.PI / 2 : location === 'gallery' || location === 'founder-room' || location === 'founder-balcony' ? 0 : -Math.PI / 2 };
    this.inspectionRoute=undefined; this.inspectionWalkTime = 0; this.referenceCamera = ''; this.setDiagnosticMode('full'); this.setCinematicPlaying(false);
    this.controls.exitExplore(); this.paused = false;
    this.camera.position.fromArray(spawn.position).add(new Vector3(-2.45, 1.85, 0));
    this.camera.lookAt(new Vector3(...spawn.position).add(new Vector3(0, 1.35, 0)));
    this.controls.enterExplore(undefined, spawn); this.setMode('explore'); this.temporal?.reset();
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
  }
  inspectWalk(x: number, y: number, sprint = false) {
    if (!this.inspectionEnabled || this.mode !== 'explore') return;
    this.inspectionRoute=undefined; this.paused=false; this.controls?.setEnabled(true);
    this.inspectionWalkTime = (x || y) ? 1 : 0;
    this.controls?.setVirtualInput(x, y, 0, 0, sprint);
  }
  inspectStepMotion(sprint = false) {
    if(!this.inspectionEnabled || this.mode!=='explore' || !this.controls)return;
    this.inspectionWalkTime=0; this.controls.setEnabled(true);
    if(!this.inspectionRoute)this.controls.setVirtualInput(0,1,0,0,sprint);
    for(let i=0;i<6;i++){this.advanceInspectionRoute();this.controls.update(1/60);}
    this.controls.setVirtualInput(0,0); this.paused=true;
    this.invalidate(); if(this.lighting)this.lighting.sun.shadow.needsUpdate=true;
  }
  private advanceInspectionRoute() {
    const route=this.inspectionRoute;if(!route || !this.controls)return;
    while(route.index<route.points.length && this.controls.inspectWorldTarget(route.points[route.index],route.sprint)<.045)route.index++;
    if(route.index>=route.points.length)this.controls.setVirtualInput(0,0);
  }
  inspectStairRoute(kind: 'spiral' | 'rounded' | 'entrance', reverse: boolean, sprint: boolean) {
    if(!this.inspectionEnabled || !this.controls || this.mode!=='explore')return;
    let points: number[][];
    if(kind==='rounded')points=Array.from({length:36},(_,i)=>[8.3-i*.09,3.675,-23]);
    else if(kind==='entrance')points=Array.from({length:29},(_,i)=>[-7+i*.09,-.355,-17.1]);
    else points=Array.from({length:81},(_,i)=>{const a=(60+315/46)-(315+315/46)*i/80,r=a*Math.PI/180;return[18.76+1.55*Math.cos(r),3.67/24*((60-a)/(315/23)+.5),-(20.2+1.55*Math.sin(r))]});
    if(reverse)points.reverse();
    const direction=new Vector3(...points[1]).sub(new Vector3(...points[0]));
    this.referenceCamera='';this.inspectionWalkTime=0;this.controls.exitExplore();
    this.controls.enterExplore(undefined,{position:points[0] as [number,number,number],yaw:Math.atan2(-direction.x,-direction.z)});
    for(let i=0;i<60;i++)this.controls.update(1/60);
    this.inspectionRoute={points:points.map(p=>new Vector3(...p)),index:1,sprint};
    this.paused=true;this.invalidate();
  }
  playInspectionRoute(){if(this.inspectionEnabled && this.inspectionRoute){this.paused=false;this.controls?.setEnabled(true);}}
  inspectCharacterView(view:'third-person'|'side'|'front'){if(this.inspectionEnabled){this.controls?.inspectCharacterView(view);this.invalidate();}}
  inspectDeskView(view: 'third-person' | 'side' | 'front') { if (this.inspectionEnabled) this.controls?.inspectDeskView(view); }
  getInteractionState() { return this.inspectionEnabled ? this.controls?.diagnostics.state : undefined; }
  setPaused(value: boolean) { this.invalidate(); this.paused = value; this.controls?.setEnabled(!value && (this.mode === 'explore' || this.mode === 'seated')); }
  explore() {
    if (!this.controls || this.mode !== 'tour' || this.sceneTransition) return;
    if (this.progress < 0.999) { this.exploreDirectly(); return; }
    this.setCinematicPlaying(false);
    this.controls.enterExplore({ position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() }, this.progress >= 0.999 ? CINEMATIC_HANDOFF : undefined);
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    this.controls.setEnabled(true); this.setMode('explore');
  }
  returnToTour(restart = false) {
    if (this.mode === 'loading' || this.mode === 'error' || this.disposed) return;
    if (restart || this.mode !== 'tour') this.beginSceneTransition('tour', restart ? 0 : this.targetProgress);
    else { this.paused = false; this.referenceCamera = ''; this.applyTourCamera(0, true); }
  }
  exploreDirectly() {
    if (!this.controls || this.mode === 'loading' || this.mode === 'error' || this.disposed) return;
    this.setCinematicPlaying(false);
    this.beginSceneTransition('explore', 1);
  }
  private beginSceneTransition(destination: 'tour' | 'explore', progress: number) {
    this.sceneTransition = { elapsed: 0, moved: false, progress, destination };
    this.paused = true; this.referenceCamera = '';
    this.controls?.setEnabled(false);
    this.callbacks.onTransition?.(true);
    // Set the mode before releasing pointer lock so the website does not reopen its menu.
    this.setMode('tour');
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }
  private updateSceneTransition(dt: number) {
    const transition = this.sceneTransition!;
    const duration = this.reducedMotion ? 0.35 : 0.7;
    transition.elapsed = Math.min(duration, transition.elapsed + dt);
    const phase = transition.elapsed / duration;
    const alpha = phase < 0.5 ? 1 - phase * 2 : phase * 2 - 1;
    (this.renderer.domElement as HTMLCanvasElement).style.opacity = String(alpha * alpha * (3 - 2 * alpha));
    if (!transition.moved && phase >= 0.5) {
      transition.moved = true;
      this.temporal?.reset();
      (this.renderer.domElement as HTMLCanvasElement).style.opacity = '0';
      this.controls?.exitExplore();
      this.targetProgress = transition.progress;
      this.applyTourCamera(0, true);
      if (transition.destination === 'explore' && this.controls) {
        // Direct exploration still starts in the lounge; the completed tour hands
        // off upstairs instead. Avoid flying the camera through the whole house.
        this.controls.exitExplore();
        const handoff = this.manifest.tour?.find(frame => frame.id === 'Explore handoff');
        if (handoff) { this.camera.position.fromArray(handoff.position); this.camera.lookAt(new Vector3(...handoff.target)); }
        this.controls.enterExplore({ position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() });
        this.controls.update(0.001); this.controls.setEnabled(false); this.setMode('explore');
      }
      if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    }
    if (phase === 1) {
      this.sceneTransition = undefined; this.paused = false;
      (this.renderer.domElement as HTMLCanvasElement).style.opacity = '1';
      this.controls?.setEnabled(this.mode === 'explore' || this.mode === 'seated');
      this.callbacks.onTransition?.(false);
    }
  }
  interact() { this.controls?.handleInteract(); }
  toggleCameraView() { this.controls?.toggleCameraView(); }
  togglePointerLock() { this.controls?.togglePointerLock(); }
  consumeIntentionalUnlock() { return this.controls?.consumeIntentionalUnlock() ?? false; }
  stand() { this.controls?.leaveSeat?.(); }
  setScreenAction(action: string) { this.controls?.setScreenAction?.(action); }
  setVirtualInput(moveX: number, moveY: number, lookX = 0, lookY = 0, sprint = false) { this.controls?.setVirtualInput?.(moveX, moveY, lookX, lookY, sprint); }
  setQuality(quality: Quality) {
    this.quality = quality; this.resolutionScale = 1; this.slowWindows = this.fastWindows = 0;
    if (this.lighting) {
      const size = quality === 'balanced' ? 2048 : 4096;
      if (this.lighting.sun.shadow.mapSize.x !== size) {
        this.lighting.sun.shadow.mapSize.set(size, size);
        this.lighting.sun.shadow.needsUpdate = true;
        this.staticSunShadowCache?.invalidate('shadow quality'); this.invalidate();
      }
    }
    this.resize();
  }
  private disposeObject(root: Object3D, disposeTextures = false) {
    const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>();
    const textures = new Set<Texture>();
    root.traverse(object => { if (object instanceof Mesh) { geometries.add(object.geometry); const list = Array.isArray(object.material) ? object.material : [object.material]; list.forEach(material => { materials.add(material); Object.values(material).forEach(value => { if (value instanceof Texture) { this.textures.add(value); textures.add(value); } }); }); } });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    if (disposeTextures) textures.forEach(texture => texture.dispose());
  }
  dispose() {
    if (this.disposed) return;
    this.profiler?.dispose();
    this.disposed = true; this.abort.abort(); this.observer?.disconnect();
    this.shaderValidation?.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.diagnostics?.dispose();
    this.staticSunShadowCache?.dispose();
    this.staticTransforms?.restore();
    this.controls?.dispose(); this.desert?.dispose(); this.lighting?.dispose();
    this.temporal?.dispose();
    this.galleryMirror?.dispose();
    this.ktx2?.dispose();
    this.mixers.forEach(({ mixer }) => mixer.stopAllAction());
    this.disposeObject(this.scene); this.textures.forEach(texture => texture.dispose());
    if (this.renderer) {
      if (this.rendererReady) {
        void this.renderer.setAnimationLoop(null);
        void this.renderer.dispose().catch(error => console.warn('[MD cleanup]', error));
      }
      (this.renderer.domElement as HTMLCanvasElement).remove();
    }
  }
}
