import { DepthFormat, Matrix4, PCFShadowMap, type DirectionalLight, type Object3D, type RenderTarget } from 'three';
import { ShadowNode, type NodeFrame, type Renderer } from 'three/webgpu';

// r186 documents renderShadow as its custom-shadow hook; @types/three 0.186.0
// omits that public method and shadowMap. Keep this narrow declaration local.
const ShadowNodeWithRender = ShadowNode as unknown as new (light: DirectionalLight, shadow: DirectionalLight['shadow']) => ShadowNode & {
  shadowMap: RenderTarget | null;
  renderShadow(frame: NodeFrame): void;
};

type RenderObject = NonNullable<ReturnType<Renderer['getRenderObjectFunction']>>;
export type StaticSunShadowCacheOptions = {
  /** Exactly the immutable set returned by freezeArchitectureTransforms().has. */
  isStatic: (object: Object3D) => boolean;
  enabled?: boolean;
};

/** Cache immutable caster rasterization, never the complete moving shadow.
 *
 * The original full-resolution color AND depth attachments are copied, then the
 * stock shadow shaders draw moving casters against that depth. This preserves
 * cutouts, reverse-Z, overlap and PCF filtering without combining shadow factors.
 * Only WebGPU's single-layer PCF directional path is enabled. Unsupported paths
 * and synchronous failures use the complete stock pass, preserving fidelity.
 *
 * Call invalidate() for static material/visibility/geometry changes, and before
 * reparenting/removing a frozen caster. Dynamic objects need no invalidation.
 */
export class StaticSunShadowCache extends ShadowNodeWithRender {
  private readonly sun: DirectionalLight;
  private readonly isStatic: (object: Object3D) => boolean;
  private enabled: boolean;
  private failed: string | null = null;
  private reason = 'initial';
  private revision = 0;
  private cachedRevision = -1;
  private snapshot: RenderTarget | null = null;
  private source: RenderTarget | null = null;
  private sceneIdentity: object | null = null;
  private signature = '';
  private view = new Matrix4();
  private projection = new Matrix4();
  private staticPasses = 0;
  private dynamicPasses = 0;
  private cacheHits = 0;
  private stockPasses = 0;
  private stockRender: RenderObject | null = null;
  private renderStatic: RenderObject = (...args) => {
    if (this.isStatic(args[0])) this.stockRender!(...args);
  };
  private renderDynamic: RenderObject = (...args) => {
    if (!this.isStatic(args[0])) this.stockRender!(...args);
  };

  constructor(light: DirectionalLight, options: StaticSunShadowCacheOptions) {
    super(light, light.shadow);
    this.sun = light;
    this.isStatic = options.isStatic;
    this.enabled = options.enabled ?? true;
  }

  get stats() {
    return { enabled: this.enabled, failed: this.failed, reason: this.reason, revision: this.revision,
      staticPasses: this.staticPasses, dynamicPasses: this.dynamicPasses,
      cacheHits: this.cacheHits, stockPasses: this.stockPasses,
      // RGBA8 + depth24plus (implementation-defined storage), not a VRAM claim.
      cachedWidth: this.snapshot?.width ?? 0, cachedHeight: this.snapshot?.height ?? 0 };
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.invalidate(enabled ? 'enabled' : 'disabled');
  }

  invalidate(reason = 'static scene changed') {
    this.reason = reason;
    this.revision++;
    this.cachedRevision = -1;
    this.sun.shadow.needsUpdate = true;
  }

  private releaseSnapshot() {
    this.snapshot?.dispose();
    this.snapshot = null;
    this.source = null;
    this.cachedRevision = -1;
  }

  renderShadow(frame: NodeFrame) {
    const renderer = frame.renderer, scene = frame.scene, map = this.shadowMap;
    const shadow = this.sun.shadow;
    const backend = renderer?.backend as { isWebGPUBackend?: boolean } | undefined;
    const supported = this.enabled && !this.failed && renderer && scene && map &&
      backend?.isWebGPUBackend === true && renderer.shadowMap.type === PCFShadowMap &&
      renderer.shadowMap.transmitted === false && this.sun.isDirectionalLight &&
      map.samples === 0 && map.depth === 1 && map.textures.length === 1 &&
      !map.stencilBuffer && !map.multiview && !map.useArrayDepthTexture &&
      map.depthTexture?.isDepthTexture === true && map.depthTexture.format === DepthFormat &&
      map.depthTexture.renderTarget === map && renderer.getRenderObjectFunction() !== null;
    if (!supported) {
      this.stockPasses++;
      // A period in the unsupported path may include arbitrary scene edits.
      this.cachedRevision = -1;
      if (this.enabled && !this.failed) this.reason = 'unsupported renderer or shadow target';
      super.renderShadow(frame);
      return;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousRender = renderer.getRenderObjectFunction();
    const previousName = scene.name;
    let didFail = false;
    this.stockRender = previousRender;
    try {
      shadow.updateMatrices(this.sun);
      map.setSize(shadow.mapSize.width, shadow.mapSize.height, map.depth);
      const depth = map.depthTexture!;
      const signature = [map.width, map.height, map.texture.type, map.texture.format, map.texture.internalFormat,
        map.texture.colorSpace, depth.type, depth.format, depth.internalFormat, depth.compareFunction,
        shadow.camera.layers.mask, shadow.camera.coordinateSystem, shadow.camera.reversedDepth,
        renderer.reversedDepthBuffer].join(':');
      if (this.source !== map || this.signature !== signature) {
        this.releaseSnapshot();
        renderer.initRenderTarget(map);
        this.snapshot = map.clone();
        this.snapshot.texture.name = 'Static sun shadow color';
        this.snapshot.depthTexture!.name = 'Static sun shadow depth';
        this.source = map;
        this.signature = signature;
      }
      const snapshot = this.snapshot!;
      const hit = this.cachedRevision === this.revision && this.sceneIdentity === scene &&
        this.view.equals(shadow.camera.matrixWorldInverse) && this.projection.equals(shadow.camera.projectionMatrix);
      if (!hit) {
        renderer.setRenderTarget(snapshot);
        renderer.autoClear = true;
        renderer.setRenderObjectFunction(this.renderStatic);
        scene.name = `Static Shadow Map [ ${this.sun.name || this.sun.id} ]`;
        renderer.render(scene, shadow.camera);
        this.staticPasses++;
        this.cachedRevision = this.revision;
        this.sceneIdentity = scene;
        this.view.copy(shadow.camera.matrixWorldInverse);
        this.projection.copy(shadow.camera.projectionMatrix);
      } else {
        this.cacheHits++;
      }
      // Whole matching subresources: same resolution/format, no filtering or
      // conversions. Depth is replaced every frame, so departing casters cannot
      // leave a stale silhouette in the architecture cache.
      renderer.copyTextureToTexture(snapshot.texture, map.texture);
      renderer.copyTextureToTexture(snapshot.depthTexture!, depth);
      renderer.setRenderTarget(map);
      renderer.autoClear = false;
      renderer.setRenderObjectFunction(this.renderDynamic);
      scene.name = `Dynamic Shadow Map [ ${this.sun.name || this.sun.id} ]`;
      renderer.render(scene, shadow.camera);
      this.dynamicPasses++;
      this.reason = 'cached';
    } catch (caught) {
      didFail = true;
      this.failed = caught instanceof Error ? caught.message : String(caught);
      this.reason = 'stock fallback after error';
      this.releaseSnapshot();
    } finally {
      this.stockRender = null;
      renderer.setRenderObjectFunction(previousRender);
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
      scene.name = previousName;
    }
    if (didFail) {
      // Rebuild the FULL original map in the same frame. A sticky failure avoids
      // retrying an unsupported device operation every animation frame.
      this.stockPasses++;
      super.renderShadow(frame);
    }
  }

  dispose() {
    this.releaseSnapshot();
    super.dispose();
  }
}
