import { LoadingManager, type CompressedTexture } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { fetchAssetBuffer } from './fetchAsset.ts';

type TextureCallbacks = { onLoad?: (texture: CompressedTexture) => void; onProgress?: (event: ProgressEvent) => void; onError?: (error: unknown) => void };

/** Close a scene's KTX jobs as well as its workers. In r186, the base loader's
 * dispose does not settle parses or stop an in-flight init from creating a new
 * worker URL. Keep that lifecycle guard outside the pinned dependency.
 */
export class SceneKTX2Loader extends KTX2Loader {
  private closed = false;
  private downloads = new AbortController();
  private pendingLoads = new Map<string, TextureCallbacks[]>();
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

  /** FileLoader does not retry failed transfers. Keep its request semantics and
   * in-flight sharing while routing only the network phase through recovery. The
   * scene loader owns this cache, so cancelled scenes cannot poison later visits. */
  override load(url: string, onLoad?: (texture: CompressedTexture) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    if (this.closed) { onError?.(this.cancellation()); return; }
    if (this.workerConfig === null) throw new Error('THREE.KTX2Loader: Missing initialization with `.detectSupport( renderer )`.');
    const resolved = this.manager.resolveURL(this.path + url);
    const headers = new Headers(this.requestHeader);
    const credentials = this.withCredentials ? 'include' : 'same-origin';
    const key = JSON.stringify([resolved, credentials, [...headers.entries()].sort()]);
    const callbacks = { onLoad, onProgress, onError };
    const existing = this.pendingLoads.get(key);
    if (existing) { existing.push(callbacks); return; }
    const listeners = [callbacks]; this.pendingLoads.set(key, listeners);
    const controller = new AbortController(), sceneSignal = this.downloads.signal, managerSignal = this.manager.abortController.signal;
    let settled = false;
    const cleanup = () => {
      sceneSignal.removeEventListener('abort', abort); managerSignal.removeEventListener('abort', abort);
      if (this.pendingLoads.get(key) === listeners) this.pendingLoads.delete(key);
    };
    const fail = (error: unknown) => {
      if (settled) return; settled = true; cleanup();
      try {
        for (const callback of listeners) {
          try { callback.onError?.(error); } catch (callbackError) { console.error('[MD texture error callback]', callbackError); }
        }
      } finally { try { this.manager.itemError(resolved); } finally { this.manager.itemEnd(resolved); } }
    };
    const abort = () => {
      const reason = sceneSignal.aborted ? sceneSignal.reason : managerSignal.reason;
      controller.abort(reason); fail(reason ?? this.cancellation());
    };
    this.manager.itemStart(resolved);
    sceneSignal.addEventListener('abort', abort, { once: true }); managerSignal.addEventListener('abort', abort, { once: true });
    if (sceneSignal.aborted || managerSignal.aborted) { abort(); return; }
    void fetchAssetBuffer(resolved, { signal: controller.signal, headers, credentials,
      onProgress: (loaded, total) => {
        if (settled || !listeners.some(callback => callback.onProgress)) return;
        const event = new ProgressEvent('progress', { loaded, total, lengthComputable: total > 0 });
        for (const callback of listeners) callback.onProgress?.(event);
      },
    }).then(buffer => {
      if (settled) return;
      this.parse(buffer, texture => {
        if (settled) { texture.dispose(); return; }
        settled = true; cleanup();
        try { for (const callback of listeners) {
          try { callback.onLoad?.(texture); } catch (callbackError) { console.error('[MD texture load callback]', callbackError); }
        } }
        finally { this.manager.itemEnd(resolved); }
      }, fail);
    }).catch(fail);
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
    this.downloads.abort(this.cancellation());
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
