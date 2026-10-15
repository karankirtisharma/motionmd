import { AgXToneMapping, AnimationMixer, Box3, Clock, Group, Material, MathUtils, Mesh, Object3D, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector3 } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Quality, RuntimeCallbacks, RuntimeMode, SceneManifest } from '@/types';
import { assetURL, fetchBuffer, resolveAssetDependency } from './rendering/assets';
import { applyMaterialManifest, prepareSourceMaterials } from './rendering/materials';
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
import { createInteractionController } from './interaction/InteractionController';

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
  private textures = new Set<Texture>();
  private ktx2?: KTX2Loader;
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
  private statsFrames = 0;
  private statsTime = 0;
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
      await this.loadSource();
      if (this.disposed) return;
      // Source clips are available only after loading; apply their initial pose once.
      this.applyTourCamera(0, true);
      // Canonicalize glTF UV-channel clones before node graphs capture their texture references.
      prepareSourceMaterials(this.content, this.renderer).forEach(t => this.textures.add(t));

      this.callbacks.onProgress?.({ phase: 'Preparing the light', detail: 'Loading source materials and room illumination' });
      const materialTextures = await applyMaterialManifest(this.content, this.manifest, this.abort.signal);
      materialTextures.forEach(t => this.textures.add(t));
      this.abort.signal.throwIfAborted();
      prepareSourceMaterials(this.content, this.renderer).forEach(t => this.textures.add(t));
      const bounds = new Box3().setFromObject(this.content);
      this.lighting = await configureLighting(this.scene, this.renderer, this.manifest, bounds, this.abort.signal);
      if (this.disposed || this.abort.signal.aborted) { this.lighting.dispose(); return; }
      // Preserve each source material's complete probe graph before subdividing
      // its visibility bounds; every cell then shares that same final shader.
      partitionSourceGeometry(this.content);
      this.desert = await createDesertEnvironment(this.scene, { signal: this.abort.signal, sunDirection: this.manifest.sun?.position });
      if (this.disposed || this.abort.signal.aborted) { this.desert.dispose(); return; }
      this.setQuality(this.quality);

      this.callbacks.onProgress?.({ phase: 'Preparing exploration', detail: 'Loading movement, collisions and interactions' });
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
      const compileStarted = performance.now();
      this.callbacks.onProgress?.({ phase: 'Preparing materials', detail: 'Compiling the scene for your graphics device' });
      console.info('[MD warmup] shader compilation started');
      this.temporal = createTemporalRenderer(this.renderer, this.scene, this.camera);
      await this.temporal.warmup(event => {
        if (this.disposed || this.abort.signal.aborted) return;
        this.callbacks.onProgress?.({ phase: 'Preparing materials', detail: `Compiled ${event.loaded} of ${event.total} render objects`, progress: event.lengthComputable && event.total ? event.loaded / event.total : undefined });
        if (event.loaded % 12 === 0 || event.loaded === event.total) console.info('[MD warmup] shader compilation', { loaded: event.loaded, total: event.total, seconds: ((performance.now() - compileStarted) / 1000).toFixed(1) });
      });
      console.info('[MD warmup] shader compilation complete', { seconds: ((performance.now() - compileStarted) / 1000).toFixed(1) });
      this.shaderValidation.assertCompiled();
      this.abort.signal.throwIfAborted();
      // Source architecture and sunset are fixed. Reuse their shadow map throughout the
      // cinematic; character motion invalidates it during exploration below.
      this.lighting.sun.shadow.autoUpdate = false;
      this.setMode('tour');
      this.callbacks.onProgress?.({ phase: 'Ready', progress: 1 });
      this.callbacks.onReady?.();
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
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.ktx2 = new KTX2Loader(loadGuard.manager).setTranscoderPath(assetURL('/assets/basis/')).setWorkerLimit(2).detectSupport(this.renderer);
    loader.setKTX2Loader(this.ktx2);
    const chunks = [...this.manifest.chunks].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const bytes = new Map<string, number>();
    const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    let next = 0;
    let lastProgressAt = 0;
    const worker = async () => {
      while (next < chunks.length && !this.disposed) {
        const chunk = chunks[next++];
        const buffer = await fetchBuffer(chunk.url, this.abort.signal, loaded => {
          bytes.set(chunk.id, loaded);
          const now = performance.now();
          if (now - lastProgressAt < 80) return;
          lastProgressAt = now;
          const received = [...bytes.values()].reduce((sum, value) => sum + value, 0);
          this.callbacks.onProgress?.({ phase: 'Loading the architecture', progress: total > 0 ? Math.min(received / total, 1) : undefined, detail: `${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}` });
        });
        if (this.disposed) return;
        const absolute = new URL(assetURL(chunk.url), window.location.href).href;
        const gltf = await loader.parseAsync(buffer, absolute.slice(0, absolute.lastIndexOf('/') + 1));
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
      }
    };
    await Promise.all([worker(), worker()]);
    loadGuard.assertLoaded();
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
    if (this.disposed || this.mode === 'error') return;
    const elapsed = this.clock.getDelta();
    if (document.hidden) return;
    const dt = Math.min(elapsed, 0.05);
    let characterAdvanced = false;
    if (this.sceneTransition) this.updateSceneTransition(dt);
    else if (!this.paused && !this.referenceCamera) {
      if (this.mode === 'tour') this.applyTourCamera(dt);
      else characterAdvanced = this.controls?.update(dt) ?? false;
    }
    // Idle breathing and seated motion still cast changing shadows. Frozen reference
    // views, menus and fades reuse the map until an explicit scene change below.
    if (characterAdvanced && this.lighting) this.lighting.sun.shadow.needsUpdate = true;
    try { if (this.temporal) this.temporal.render(); else this.renderer.render(this.scene, this.camera); }
    catch (error) { if (!this.renderErrorReported) { this.renderErrorReported = true; console.error(error); this.fail('The graphics device could not finish rendering the scene. Close other graphics-heavy tabs and try again.'); } return; }
    this.statsFrames++; this.statsTime += elapsed;
    if (this.inspectionEnabled) this.frameSamples.push(elapsed * 1000);
    if (this.statsTime > 2) {
      try { this.shaderValidation?.assertCompiled(); }
      catch { return; }
      const fps = this.statsFrames / this.statsTime;
      if (this.quality === 'auto' && !this.paused) this.adaptResolution(fps);
      const samples = this.frameSamples.sort((a, b) => a - b);
      this.callbacks.onStats?.({ fps: Math.round(fps), drawCalls: this.renderer.info.render.drawCalls, triangles: this.renderer.info.render.triangles, renderer: this.renderer.backend.constructor.name.includes('WebGPU') ? 'WebGPU' : 'WebGL 2', quality: this.quality, resolutionScale: this.resolutionScale,
        frameP50Ms: samples[Math.floor(samples.length * .5)], frameP95Ms: samples[Math.floor(samples.length * .95)],
        resourceMiB: (this.renderer.info.memory.texturesSize + this.renderer.info.memory.attributesSize) / 1048576 });
      this.frameSamples.length = 0;
      this.statsFrames = 0; this.statsTime = 0;
    }
  };

  private adaptResolution(fps: number) {
    this.slowWindows = fps < 35 ? this.slowWindows + 1 : 0;
    this.fastWindows = fps > 56 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.resolutionScale > 0.65) { this.resolutionScale = Math.max(0.65, this.resolutionScale - 0.1); this.slowWindows = 0; this.resize(); }
    if (this.fastWindows >= 4 && this.resolutionScale < 1) { this.resolutionScale = Math.min(1, this.resolutionScale + 0.05); this.fastWindows = 0; this.resize(); }
  }

  private resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    const cap = this.quality === 'balanced' ? 1.25 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap) * this.resolutionScale);
    this.renderer.setSize(width, height);
  }
  private onVisibility = () => { this.clock.getDelta(); this.statsFrames = 0; this.statsTime = 0; this.frameSamples.length = 0; this.slowWindows = this.fastWindows = 0; };
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

  setTourProgress(progress: number) {
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
    if (!this.inspectionEnabled || !this.manifest) return;
    this.diagnostics ??= new RenderDiagnostics(this.content);
    this.diagnostics.setMode(mode);
    // Keep the cached ShadowNode/render target alive when comparing modes.
    if (this.lighting) this.lighting.sun.shadow.intensity = mode === 'no-shadows' ? 0 : 1;
    this.temporal?.reset();
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
  }
  setReferenceCamera(id: string) {
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
  inspectMovement(location: 'entrance' | 'studio' | 'founder-lift' | 'bridge' | 'gallery' | 'founder-room' | 'founder-balcony' | 'gallery-return') {
    if (!this.inspectionEnabled || !this.controls || this.mode === 'loading' || this.mode === 'error' || this.sceneTransition) return;
    const positions = { entrance: [-8, -.355, -17.1], studio: [16.4, .03, -30.7], 'founder-lift': [13.35, .035, -3.35], bridge: [-1.3, 4.2, -17], gallery: [12, 3.675, -24.05], 'founder-room': [16, 4.23, -8.7], 'founder-balcony': [11, 4.23, -10.25], 'gallery-return': [8.14, 3.675, -24.63] };
    const spawn = { position: positions[location] as [number, number, number], yaw: location === 'founder-lift' ? Math.PI : location === 'gallery-return' ? -Math.PI / 2 : location === 'gallery' || location === 'founder-room' || location === 'founder-balcony' ? 0 : -Math.PI / 2 };
    this.referenceCamera = ''; this.setDiagnosticMode('full'); this.setCinematicPlaying(false);
    this.controls.exitExplore(); this.paused = false;
    this.camera.position.fromArray(spawn.position).add(new Vector3(-2.45, 1.85, 0));
    this.camera.lookAt(new Vector3(...spawn.position).add(new Vector3(0, 1.35, 0)));
    this.controls.enterExplore(undefined, spawn); this.setMode('explore'); this.temporal?.reset();
    if (this.lighting) this.lighting.sun.shadow.needsUpdate = true;
  }
  setPaused(value: boolean) { this.paused = value; this.controls?.setEnabled(!value && (this.mode === 'explore' || this.mode === 'seated')); }
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
      if (this.lighting.sun.shadow.mapSize.x !== size) this.lighting.sun.shadow.mapSize.set(size, size);
      this.lighting.sun.shadow.needsUpdate = true;
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
    this.disposed = true; this.abort.abort(); this.observer?.disconnect();
    this.shaderValidation?.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.diagnostics?.dispose();
    this.controls?.dispose(); this.desert?.dispose(); this.lighting?.dispose();
    this.temporal?.dispose();
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
