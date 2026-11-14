import { REVISION, type Material, type Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

type RecordForRender = object & { drawRange: unknown; group: unknown };
type Direct = (object: Object3D & { geometry: { drawRange: unknown } }, material: Material,
  scene: object, camera: object, lights: object, group: unknown, clipping: object, pass?: string) => void;
type PreparationRenderer = WebGPURenderer & {
  _renderObjectDirect: Direct;
  _currentRenderContext: object;
  _currentSourceMaterial: Material | null;
  _isPreCompiling: boolean;
  _objects: { get(...args: unknown[]): RecordForRender };
  _nodes: {
    get(record: RecordForRender): { nodeBuilderState?: unknown };
    getForRenderAsync(record: RecordForRender): Promise<unknown>;
    updateBefore(record: RecordForRender): void;
    updateForRender(record: RecordForRender): void;
    updateAfter(record: RecordForRender): void;
  };
  _geometries: { updateForRender(record: RecordForRender): void };
  _bindings: { updateForRender(record: RecordForRender): void };
  _pipelines: {
    isReady(record: RecordForRender): boolean;
    getForRender(record: RecordForRender, promises: Promise<unknown>[]): unknown;
  };
};

// A partial discovery pass must never become a valid static shadow snapshot.
const discovery = new WeakMap<object, { skipped: number }>();
export const skippedPreparationDraws = (renderer: object) => discovery.get(renderer)?.skipped ?? 0;

const materialFields = ['side', 'colorNode', 'depthNode', 'positionNode', 'alphaTest', 'alphaMap',
  'displacementMap', 'displacementScale', 'displacementBias', 'transparent'] as const;
function captureMaterial(material: Material) {
  const values = material as unknown as Record<string, unknown>;
  return Object.fromEntries(materialFields.filter(key => key in material).map(key => [key, values[key]]));
}
const yieldToBrowser = () => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield() ?? new Promise<void>(resolve => setTimeout(resolve, 0));
};

/** Narrow r186 bridge to its async node/pipeline compiler. Public compileAsync
 * builds at depth zero; TRAA, coverage and shadows use different actual contexts.
 * Discover those exact submissions, prepare them serially with buildAsync's
 * stage yields, then replay until a COMPLETE draw discovers no missing shader.
 * No renderer patch, visibility change, reduced quality or per-frame hook remains.
 */
export async function prepareRenderAsync(renderer: WebGPURenderer, draw: () => Promise<void>, signal?: AbortSignal) {
  const r = renderer as PreparationRenderer;
  if (REVISION !== '186' || !r._objects?.get || !r._nodes?.getForRenderAsync ||
      !r._pipelines?.isReady || !r._renderObjectDirect) return false;
  if (discovery.has(renderer)) throw new Error('Render preparation must run serially.');
  const state = { skipped: 0 }, pending = new Map<RecordForRender, () => Promise<void>>();
  const original = r._renderObjectDirect;
  const pipelineBatch: Promise<unknown>[] = [];
  const finishPipelines = async () => {
    await Promise.all(pipelineBatch); pipelineBatch.length = 0;
    signal?.throwIfAborted();
  };
  const captureState = () => ({ target: r.getRenderTarget(), mrt: r.getMRT(),
    context: r._currentRenderContext, source: r._currentSourceMaterial, lighting: r.lighting, contextNode: r.contextNode,
    tone: r.toneMapping, color: r.outputColorSpace });
  const applyState = (s: ReturnType<typeof captureState>) => {
    r.setRenderTarget(s.target); r.setMRT(s.mrt);
    r._currentRenderContext = s.context; r._currentSourceMaterial = s.source; r.lighting = s.lighting; r.contextNode = s.contextNode;
    r.toneMapping = s.tone; r.outputColorSpace = s.color;
  };
  const precompile = (fn: () => void) => {
    const previous = r._isPreCompiling;
    r._isPreCompiling = true;
    try { fn(); } finally { r._isPreCompiling = previous; }
  };
  discovery.set(renderer, state);
  r._renderObjectDirect = function (...args) {
    const [object, material, scene, camera, lights, group, clipping, pass] = args;
    const record = r._objects.get(object, material, scene, camera, lights, r._currentRenderContext, clipping, pass);
    if (r._nodes.get(record).nodeBuilderState && r._pipelines.isReady(record)) {
      original.apply(this, args); return;
    }
    state.skipped++;
    if (pending.has(record)) return;
    const captured = captureState(), effective = captureMaterial(material);
    // Lighting.finishRender restores the shared node's previous (often empty)
    // light list. Retain the actual lights while compiling after that render.
    const lightNode = (lights ?? {}) as { getLights?(): unknown[]; setLights?(lights: unknown[]): void };
    const lightList = lightNode.getLights?.().slice();
    pending.set(record, async () => {
      signal?.throwIfAborted();
      const previous = captureState(), values = captureMaterial(material), previousLights = lightNode.getLights?.();
      try {
        applyState(captured); Object.assign(material, effective);
        if (lightList) lightNode.setLights?.(lightList);
        record.drawRange = object.geometry.drawRange; record.group = group;
        await r._nodes.getForRenderAsync(record);
        signal?.throwIfAborted();
        // Same order as r186 compileAsync. No await while _isPreCompiling is set.
        precompile(() => {
          // Render-dependent updates (viewport copies, TRAA, shadows) require an open encoder.
          // Run them only in the following real draw, never in async compilation.
          r._geometries.updateForRender(record);
          r._nodes.updateForRender(record);
          r._bindings.updateForRender(record);
        });
        const programs: Promise<unknown>[] = [];
        r._pipelines.getForRender(record, programs);
        // Graph building stays serial (TSL shares context). Driver compilation
        // may overlap, bounded to four promises, without blocking browser work.
        for (const program of programs) {
          void program.catch(() => {}); // Observe rejection until the batch joins.
          pipelineBatch.push(program);
        }
        if (pipelineBatch.length >= 4) await finishPipelines();

      } finally {
        if (previousLights) lightNode.setLights?.(previousLights);
        Object.assign(material, values); applyState(previous);
      }
      await yieldToBrowser();
    });
  };
  try {
    // Each replay reveals the next dependency layer (resolve → beauty → shadow).
    // The limit catches unexpected moving cache keys instead of hanging Enter.
    for (let wave = 0; wave < 32; wave++) {
      signal?.throwIfAborted();
      const before = state.skipped;
      await draw();
      signal?.throwIfAborted();
      if (state.skipped === before) return true;
      for (const [record, prepare] of pending) {
        await prepare(); pending.delete(record);
      }
      await finishPipelines();
      await yieldToBrowser();
    }
    throw new Error('Render preparation did not converge. Please retry.');
  } finally {
    r._renderObjectDirect = original;
    discovery.delete(renderer); pending.clear();
  }
}
