import { LoadingManager, type CompressedTexture } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/** Close a scene's KTX jobs as well as its workers. In r186, the base loader's
 * dispose does not settle parses or stop an in-flight init from creating a new
 * worker URL. Keep that lifecycle guard outside the pinned dependency.
 */
export class SceneKTX2Loader extends KTX2Loader {
  private closed = false;
  private pendingParses = new Set<(error: unknown) => void>();
  private signal?: AbortSignal;
  private onAbort = () => this.dispose();

  constructor(manager?: LoadingManager, signal?: AbortSignal) {
    super(manager);
    this.signal = signal;
    if (signal?.aborted) this.dispose();
    else signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private cancellation() {
    return this.signal?.reason ?? new DOMException('Texture decode cancelled', 'AbortError');
  }

  private releaseLateResources() {
    this.workerPool.dispose();
    if (this.workerSourceURL) URL.revokeObjectURL(this.workerSourceURL);
    this.workerSourceURL = '';
    this.transcoderBinary = null;
  }

  override init(): Promise<void> {
    if (this.closed) return Promise.reject(this.cancellation());
    return super.init().then(() => {
      if (this.closed) {
        this.releaseLateResources();
        throw this.cancellation();
      }
    });
  }

  override parse(buffer: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void, onError?: (error: unknown) => void): void {
    if (this.closed) { onError?.(this.cancellation()); return; }
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      this.pendingParses.delete(fail);
      onError?.(error);
    };
    this.pendingParses.add(fail);
    try {
      super.parse(buffer, texture => {
        if (settled || this.closed) { texture.dispose(); return; }
        settled = true;
        this.pendingParses.delete(fail);
        onLoad?.(texture);
      }, fail);
    } catch (error) { fail(error); }
  }

  override dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener('abort', this.onAbort);
    // r186 increments its active-loader count in init, not the constructor.
    // Calling its dispose on a never-initialized instance decrements incorrectly.
    if (this.transcoderPending) {
      super.dispose();
      this.workerSourceURL = '';
      this.transcoderBinary = null;
      // The base init promise can still finish after its loader was disposed.
      void this.transcoderPending.then(() => this.releaseLateResources(), () => this.releaseLateResources());
    } else this.releaseLateResources();
    const failures = [...this.pendingParses];
    this.pendingParses.clear();
    for (const fail of failures) fail(this.cancellation());
  }
}
