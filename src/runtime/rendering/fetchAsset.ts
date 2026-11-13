type DownloadOptions = {
  signal?: AbortSignal;
  expectedBytes?: number;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  onProgress?: (loaded: number, total: number, headers: Headers) => void;
  /** Idle time, not the total transfer time: slow, progressing downloads remain valid. */
  stallMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

class TransferFailure extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number;
  constructor(message: string, retryable: boolean, retryAfterMs = 0, cause?: unknown) {
    super(message, { cause }); this.name = 'AssetTransferError';
    this.retryable = retryable; this.retryAfterMs = retryAfterMs;
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Retries only transport failures; decoding stays outside this function. A failed
 * attempt releases its reader, timeout and partial buffer before a replacement.
 * The caller's abort cancels both the active request and a pending retry delay. */
export async function fetchAssetBuffer(url: string, options: DownloadOptions = {}): Promise<ArrayBuffer> {
  const { signal, expectedBytes, onProgress } = options;
  const attempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
  const stallMs = Math.max(1, options.stallMs ?? 45000);
  const label = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'asset');
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const pulse = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new TransferFailure(`No data received for ${Math.round(stallMs / 1000)} seconds`, true)), stallMs);
    };
    const network = async <T>(promise: Promise<T>) => {
      try { return await abortable(promise, controller.signal); }
      catch (cause) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (cause instanceof RangeError) throw cause;
        throw new TransferFailure('The connection was interrupted', true, 0, cause);
      }
    };
    let failure: unknown;
    try {
      if (signal?.aborted) abort();
      pulse();
      const response = await network(fetch(url, { cache: process.env.NODE_ENV === 'development' ? 'no-store' : 'default', signal: controller.signal, headers: options.headers, credentials: options.credentials ?? 'same-origin' }));
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const retryAfter = response.headers.get('retry-after');
        const retryAfterMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        throw new TransferFailure(`HTTP ${response.status}`, retryable, Math.max(0, Math.min(10000, retryAfterMs || 0)));
      }
      pulse();
      const encoding = response.headers.get('content-encoding');
      const total = Number(response.headers.get('x-asset-decoded-length')) || expectedBytes ||
        ((!encoding || encoding === 'identity') ? Number(response.headers.get('content-length')) : 0) || 0;
      if (!response.body) return await network(response.arrayBuffer());
      reader = response.body.getReader();
      // Only explicit decoded length is authoritative; Content-Length may describe
      // compressed bytes and expectedBytes is a source-asset allocation hint.
      const declared = Number(response.headers.get('x-asset-decoded-length')) || 0;
      let direct = total > 0 && total <= 512 * 1024 * 1024 ? new Uint8Array(total) : undefined;
      const parts: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await network(reader.read());
        controller.signal.throwIfAborted();
        if (done) break;
        if (!value.byteLength) continue;
        pulse();
        if (direct && loaded + value.byteLength <= direct.length) direct.set(value, loaded);
        else {
          if (direct) { parts.push(direct.subarray(0, loaded)); direct = undefined; }
          parts.push(value);
        }
        loaded += value.byteLength;
        onProgress?.(loaded, total, response.headers);
      }
      if (declared && loaded !== declared) throw new TransferFailure(`Incomplete download (${loaded} of ${declared} bytes)`, true);
      if (direct) return loaded === direct.length ? direct.buffer : direct.buffer.slice(0, loaded);
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return bytes.buffer;
    } catch (error) { failure = error; }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Cancelling an errored reader is harmless; it also releases a stalled body.
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      controller.abort();
    }
    signal?.throwIfAborted();
    if (!(failure instanceof TransferFailure)) throw failure;
    if (!failure.retryable || attempt + 1 === attempts) {
      throw new Error(`Could not load ${label}: ${failure.message}${attempt ? ` after ${attempt + 1} attempts` : ''}.`, { cause: failure });
    }
    await wait(Math.max(failure.retryAfterMs, (options.retryDelayMs ?? 600) * 2 ** attempt), signal);
  }
  throw new Error(`Could not load ${label}.`);
}
