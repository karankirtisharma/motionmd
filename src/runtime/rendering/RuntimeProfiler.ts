import type { WebGPURenderer } from 'three/webgpu';
import { observeShaderBuilds, type ShaderBuildEvent } from './shaderBuildObserver.ts';
/** Opt-in diagnostics: ?debug=1&profile=1. No scene state is changed by capture. */
export class RuntimeProfiler {
  private started = performance.now();
  private phaseName = 'runtime initialization';
  private phaseStarted = this.started;
  private phases: Array<{ phase: string; ms: number }> = [];
  private observer?: PerformanceObserver;
  private longTasks: Array<{ start: number; ms: number }> = [];
  private capture?: { label: string; started: number; frames: number[][]; commits: number; hidden: boolean; shaderEvents: ShaderBuildEvent[]; shaderDetailsDropped: number; programsStart?: number; programsEnd?: number; programsPeak?: number };
  private timer?: ReturnType<typeof setTimeout>;
  private shaderObserver?: ReturnType<typeof observeShaderBuilds>;
  private load?: object;
  private last?: object;
  constructor(private publish: (report: string) => void, private context: () => object) {
    performance.setResourceTimingBufferSize(3000);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      this.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          this.longTasks.push({ start: entry.startTime, ms: entry.duration });
          if (this.longTasks.length > 5000) this.longTasks.shift();
        }
      });
      this.observer.observe({ type: 'longtask', buffered: true });
    }
  }
  attachRenderer(renderer: WebGPURenderer) { this.shaderObserver?.dispose(); this.shaderObserver = observeShaderBuilds(renderer); }
  phase(name: string) {
    if (name === this.phaseName) return;
    const now = performance.now();
    this.phases.push({ phase: this.phaseName, ms: +(now - this.phaseStarted).toFixed(1) });
    this.phaseName = name; this.phaseStarted = now;
  }
  ready() {
    this.phase('ready');
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const assets = resources.filter(entry => new URL(entry.name).pathname.includes('/assets/'));
    const counts = new Map<string, number>();
    for (const entry of assets) counts.set(new URL(entry.name).pathname, (counts.get(new URL(entry.name).pathname) ?? 0) + 1);
    this.load = { runtimeReadyMs: +(performance.now() - this.started).toFixed(1), navigationReadyMs: +performance.now().toFixed(1),
      phases: this.phases, assetRequests: assets.length,
      assetEncodedMiB: +(assets.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1048576).toFixed(2),
      assetTransferredMiB: +(assets.reduce((sum, entry) => sum + entry.transferSize, 0) / 1048576).toFixed(2),
      duplicateRequests: [...counts].filter(([, count]) => count > 1),
      longTasks: this.taskSummary(this.started), shaderBuilds: this.shaderObserver?.totals(), context: this.context() };
    this.emit();
  }
  start(label: string, seconds = 15) {
    if (this.capture) return;
    const now = performance.now();
    const programs = this.shaderObserver?.start();
    this.capture = { label, started: now, frames: [], commits: 0, hidden: document.hidden, shaderEvents: [], shaderDetailsDropped: 0, programsStart: programs, programsEnd: programs, programsPeak: programs };
    this.publish(JSON.stringify({ capturing: label, seconds, load: this.load }, null, 2));
    this.timer = setTimeout(() => this.finish(), seconds * 1000);
  }
  uiCommit() { if (this.capture) this.capture.commits++; }
  frame(intervalMs: number, simulationMs: number, mirrorMs: number, renderMs: number, rendered: boolean) {
    const sample = this.capture;
    if (!sample) return;
    sample.hidden ||= document.hidden;
    const builds = this.shaderObserver?.takeFrame();
    if (builds) {
      sample.programsEnd = builds.activePrograms;
      sample.programsPeak = Math.max(sample.programsPeak ?? 0, builds.activePrograms);
      const available = Math.max(0, 256 - sample.shaderEvents.length);
      sample.shaderEvents.push(...builds.events.slice(0, available));
      sample.shaderDetailsDropped += builds.dropped + Math.max(0, builds.events.length - available);
    }
    sample.frames.push([intervalMs, simulationMs, mirrorMs, renderMs, rendered ? 1 : 0, builds?.builds ?? 0]);
  }
  visibility() { if (this.capture && document.hidden) this.capture.hidden = true; }
  private taskSummary(since: number) {
    const tasks = this.longTasks.filter(task => task.start >= since);
    return { count: tasks.length, totalMs: +tasks.reduce((sum, task) => sum + task.ms, 0).toFixed(1), maxMs: +Math.max(0, ...tasks.map(task => task.ms)).toFixed(1) };
  }
  private finish() {
    const sample = this.capture;
    if (!sample) return;
    this.capture = undefined;
    this.shaderObserver?.stop();
    const distribution = (column: number) => {
      const values = sample.frames.map(frame => frame[column]).sort((a, b) => a - b);
      const percentile = (p: number) => +(values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0).toFixed(3);
      return { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) };
    };
    const sparseCallbacks = sample.frames.filter(frame => frame[0] >= 250);
    const sparseWithLowSubmission = sparseCallbacks.filter(frame => frame[1] + frame[2] + frame[3] < frame[0] * 0.25).length;
    const abnormalCadence = sparseCallbacks.length >= 3 && sparseCallbacks.length >= sample.frames.length * 0.25;
    this.last = { label: sample.label, durationMs: +(performance.now() - sample.started).toFixed(1),
      frames: sample.frames.length, renderedFrames: sample.frames.filter(frame => frame[4]).length,
      frameMs: distribution(0), simulationCpuMs: distribution(1), mirrorCpuMs: distribution(2), renderSubmitCpuMs: distribution(3),
      framesOver25Ms: sample.frames.filter(frame => frame[0] > 25).length,
      framesOver50Ms: sample.frames.filter(frame => frame[0] > 50).length,
      callbackCadence: {
        intervalsAtLeast250Ms: sparseCallbacks.length,
        sparseIntervalsWithLowCpuSubmission: sparseWithLowSubmission,
        suitableForMatchedComparison: !sample.hidden && !abnormalCadence,
        warning: abnormalCadence ? 'Sparse frame callback cadence: possible throttling, scheduling or GPU stall. Not suitable for matched performance comparison.' : sample.hidden ? 'Document was hidden during capture; not suitable for matched performance comparison.' : null,
      },
      uiCommits: sample.commits, hiddenDuringCapture: sample.hidden, longTasks: this.taskSummary(sample.started),
      shaderBuilds: {
        started: sample.frames.reduce((sum, frame) => sum + frame[5], 0),
        framesWithBuilds: sample.frames.filter(frame => frame[5] > 0).length,
        framesOver25MsWithSameOrPriorBuild: sample.frames.filter((frame, i) => frame[0] > 25 && (frame[5] > 0 || (sample.frames[i - 1]?.[5] ?? 0) > 0)).length,
        framesOver25MsWithoutRecentBuild: sample.frames.filter((frame, i) => frame[0] > 25 && frame[5] === 0 && (sample.frames[i - 1]?.[5] ?? 0) === 0).length,
        renderSubmissionsOver25MsWithBuilds: sample.frames.filter(frame => frame[3] > 25 && frame[5] > 0).length,
        activeProgramsStart: sample.programsStart, activeProgramsEnd: sample.programsEnd, activeProgramsPeak: sample.programsPeak,
        programCountNetChange: sample.programsStart !== undefined && sample.programsEnd !== undefined ? sample.programsEnd - sample.programsStart : undefined,
        pipelineCreations: null,
        events: sample.shaderEvents.map(event => ({ ...event, atMs: +(event.atMs - sample.started).toFixed(3) })),
        eventDetailsDropped: sample.shaderDetailsDropped,
        note: 'Public node-build starts and active program counts; no public r186 GPU-pipeline creation callback. RAF intervals include the preceding submission. Event coincidence is not proof of stall causation.',
      },
      gpuTimeMs: null, note: 'CPU submission timings are not GPU timings. Memory is renderer-tracked, not total VRAM.', context: this.context() };
    this.emit();
  }
  private emit() { this.publish(JSON.stringify({ load: this.load, capture: this.last }, null, 2)); }
  dispose() { this.shaderObserver?.dispose(); this.observer?.disconnect(); clearTimeout(this.timer); this.capture = undefined; }
}
