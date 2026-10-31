import { DataUtils, HalfFloatType, RenderTarget, Vector2, type LightShadow, type PerspectiveCamera, type Scene } from 'three';
import { NodeFrame, type WebGPURenderer } from 'three/webgpu';

type Readback = Uint16Array | Float32Array | Float64Array;
export type ShadowAuditCache = {
  setEnabled(enabled: boolean): void;
  readonly stats: { enabled: boolean; [key: string]: unknown };
};

/** Pinned WebGPU readback has 256-byte row alignment; WebGL returns tight rows. */
function componentStride(values: Readback, width: number, height: number) {
  const row = width * 4;
  if (values.length === row * height) return row;
  const padded = Math.ceil(row * values.BYTES_PER_ELEMENT / 256) * 256 / values.BYTES_PER_ELEMENT;
  if (values.length === (height - 1) * padded + row || values.length === height * padded) return padded;
  throw new Error(`Unexpected shadow-audit readback length: ${values.length} for ${width} x ${height} RGBA.`);
}

/** Compare decoded HDR values, never the integer encodings of half floats. */
export function compareShadowReadbacks(before: Readback, after: Readback, width: number, height: number, tolerance = 0.0001) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid shadow-audit dimensions or tolerance.');
  const beforeStride = componentStride(before, width, height), afterStride = componentStride(after, width, height);
  const beforeHalf = before instanceof Uint16Array, afterHalf = after instanceof Uint16Array;
  let total = 0, maximum = 0, differentComponents = 0, differentPixels = 0, componentsAboveTolerance = 0, pixelsAboveTolerance = 0, nonFiniteComponents = 0;
  let stockRgbEnergy = 0, cachedRgbEnergy = 0, stockNonZeroRgbPixels = 0, cachedNonZeroRgbPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let different = false, outsideTolerance = false, stockRgbNonZero = false, cachedRgbNonZero = false;
    for (let channel = 0; channel < 4; channel++) {
      const a = before[y * beforeStride + x * 4 + channel], b = after[y * afterStride + x * 4 + channel];
      const first = beforeHalf ? DataUtils.fromHalfFloat(a) : a, second = afterHalf ? DataUtils.fromHalfFloat(b) : b;
      if (channel < 3) {
        if (Number.isFinite(first)) { stockRgbEnergy += Math.abs(first); stockRgbNonZero ||= first !== 0; }
        if (Number.isFinite(second)) { cachedRgbEnergy += Math.abs(second); cachedRgbNonZero ||= second !== 0; }
      }
      if (!Number.isFinite(first) || !Number.isFinite(second)) { nonFiniteComponents++; outsideTolerance = different = true; continue; }
      const delta = Math.abs(first - second);
      total += delta; maximum = Math.max(maximum, delta);
      if (delta !== 0) { differentComponents++; different = true; }
      if (delta > tolerance) { componentsAboveTolerance++; outsideTolerance = true; }
    }
    if (stockRgbNonZero) stockNonZeroRgbPixels++;
    if (cachedRgbNonZero) cachedNonZeroRgbPixels++;
    if (different) differentPixels++;
    if (outsideTolerance) pixelsAboveTolerance++;
  }
  const components = width * height * 4;
  return { width, height, components, tolerance,
    stockRgbEnergy, cachedRgbEnergy, stockNonZeroRgbPixels, cachedNonZeroRgbPixels,
    stockMeanAbsRgb: stockRgbEnergy / (width * height * 3), cachedMeanAbsRgb: cachedRgbEnergy / (width * height * 3),
    maxAbsDifference: maximum, meanAbsDifference: total / components,
    differentComponents, differentPixels, componentsAboveTolerance, pixelsAboveTolerance, nonFiniteComponents,
    withinTolerance: pixelsAboveTolerance === 0 && nonFiniteComponents === 0 };
}

/** Debug-only fixed-pose QA. Caller suspends normal render submissions and
 * animation/input until completion. Pass the existing temporal scene target/MRT
 * to preserve glass viewport-copy format/context; it is never disposed here.
 * r186 PCF uses screen coordinates, with no frame/time sampling input.
 */
export async function auditShadowCache(options: {
  renderer: WebGPURenderer; scene: Scene; camera: PerspectiveCamera;
  cache: ShadowAuditCache; shadow: LightShadow; signal?: AbortSignal; tolerance?: number;
  pass?: { target: RenderTarget; mrt: ReturnType<WebGPURenderer['getMRT']> | null };
  benchmarkFrames?: number;
}) {
  const { renderer, scene, camera, cache, shadow, signal } = options;
  signal?.throwIfAborted();
  const benchmarkFrames = options.benchmarkFrames ?? 0;
  if (!Number.isInteger(benchmarkFrames) || benchmarkFrames < 0 || benchmarkFrames > 32) throw new Error('Shadow audit benchmarkFrames must be an integer from 0 to 32.');
  // Pinned r186 documents updateShadow as public; its matching @types omits it.
  const shadowNode = cache as ShadowAuditCache & { updateShadow(frame: NodeFrame): void };
  if (typeof shadowNode.updateShadow !== 'function') throw new Error('Shadow audit needs the installed ShadowNode updateShadow hook.');
  const size = options.pass ? new Vector2(options.pass.target.width, options.pass.target.height) : renderer.getDrawingBufferSize(new Vector2());
  const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
  const owned = !options.pass;
  const target = options.pass?.target ?? new RenderTarget(width, height, { type: HalfFloatType, samples: 0, depthBuffer: true });
  if (owned) target.texture.name = 'MD | temporary shadow parity audit';
  const auditMRT = options.pass?.mrt ?? null;
  const previous = { target: renderer.getRenderTarget(), mrt: renderer.getMRT(), autoClear: renderer.autoClear, enabled: cache.stats.enabled, shadowDirty: shadow.needsUpdate, shadowAutoUpdate: shadow.autoUpdate };
  const beforeStats = { ...cache.stats };
  const frame = new NodeFrame(); frame.renderer = renderer; frame.scene = scene; frame.camera = camera;
  const draw = () => {
    const draws = renderer.info.render.drawCalls, triangles = renderer.info.render.triangles;
    // A manual render does not advance r186 NodeFrame.frameId, so needsUpdate
    // alone would skip shadow work in a synchronous batch. Invoke the public
    // shadow hook once, then suppress its automatic second invocation.
    shadowNode.updateShadow(frame);
    shadow.needsUpdate = false;
    renderer.render(scene, camera);
    return { drawCalls: renderer.info.render.drawCalls - draws, triangles: renderer.info.render.triangles - triangles };
  };
  const capture = async (enabled: boolean) => {
    signal?.throwIfAborted();
    cache.setEnabled(enabled);
    shadow.needsUpdate = false; shadow.autoUpdate = false;
    renderer.setRenderTarget(target); renderer.setMRT(auditMRT); renderer.autoClear = true;
    await renderer.compileAsync(scene, camera);
    signal?.throwIfAborted();
    draw();
    const render = draw();
    const values = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    signal?.throwIfAborted();
    if (!(values instanceof Uint16Array || values instanceof Float32Array || values instanceof Float64Array)) throw new Error('Shadow audit requires half/float HDR readback.');
    return { values, render, stats: { ...cache.stats } };
  };
  const benchmark = async () => {
    const batches = [];
    for (const enabled of [false, true, true, false]) {
      signal?.throwIfAborted();
      cache.setEnabled(enabled);
      shadow.needsUpdate = false; shadow.autoUpdate = false;
      const startStats = { ...cache.stats }, submissions = [], counts = [];
      const started = performance.now();
      for (let index = 0; index < benchmarkFrames; index++) {
        signal?.throwIfAborted();
        const submittedAt = performance.now();
        const render = draw();
        submissions.push(performance.now() - submittedAt); counts.push(render);
      }
      const submissionTotalMs = performance.now() - started;
      // One tiny public readback fences the batch. This includes readback/wait
      // and scheduling overhead: it is neither a GPU timestamp nor RAF FPS.
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
      const completionWithReadbackMs = performance.now() - started;
      signal?.throwIfAborted();
      batches.push({ path: enabled ? 'cached' : 'stock', frames: benchmarkFrames,
        cpuSubmissionMsPerFrame: submissions, submissionTotalMs, completionWithReadbackMs,
        renderCountsPerFrame: counts, beforeStats: startStats, afterStats: { ...cache.stats } });
    }
    return { batches, note: 'Fixed-pose synchronous ABBA submissions, not display FPS. CPU timings include explicit shadow and main scene submissions. Batch completion includes 1-pixel readback, GPU wait and scheduling; not GPU timestamp timing. The first cached batch may rebuild its static snapshot.' };
  };
  try {
    const stock = await capture(false), cached = await capture(true);
    const comparison = compareShadowReadbacks(stock.values, cached.values, width, height, options.tolerance);
    const throughput = benchmarkFrames ? comparison.withinTolerance ? await benchmark() : { skipped: 'Pixel parity failed; no throughput measurement run.' } : undefined;
    return { ...comparison, stockRender: stock.render, cachedRender: cached.render,
      stockStats: stock.stats, cachedStats: cached.stats, beforeStats, throughput,
      context: owned ? 'temporary HDR target' : 'existing scene-pass target and MRT',
      note: 'Fixed-pose HDR RGBA comparison before temporal resolve; caller suspended animation and normal rendering. Explicit ShadowNode updates prevent same-frame shadow skipping. PCF sampling has no frame-dependent jitter in pinned r186.' };
  } finally {
    try { cache.setEnabled(previous.enabled); }
    finally {
      shadow.needsUpdate = previous.shadowDirty; shadow.autoUpdate = previous.shadowAutoUpdate;
      renderer.setRenderTarget(previous.target); renderer.setMRT(previous.mrt); renderer.autoClear = previous.autoClear;
      if (owned) target.dispose();
    }
  }
}