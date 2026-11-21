type DownloadOptions = {
  signal?: AbortSignal;
  expectedBytes?: number;
  retryUrl?: string;
  /** Hash of the full decoded content served by the static retry URL. */
  resumeSHA256?: string;
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
 * attempt releases its reader and timeout. A verified identity fallback can
 * finish an interrupted GLB in the buffer already allocated for its first request.
 * The caller's abort cancels both the active request and a pending retry delay. */
export async function fetchAssetBuffer(url: string, options: DownloadOptions = {}): Promise<ArrayBuffer> {
  const { signal, expectedBytes, onProgress } = options;
  const attempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
  const stallMs = Math.max(1, options.stallMs ?? 45000);
  const label = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'asset');
  const exactBytes = options.resumeSHA256 && options.retryUrl && globalThis.crypto?.subtle ? expectedBytes : undefined;
  let retained: Uint8Array<ArrayBuffer> | undefined;
  let received = 0;
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
      // Immutable asset URLs are marked cacheable before the server has produced the
      // body, so a one-off 500 or cut transfer can be stored for a year. A retry must
      // go back to the network, or every attempt (and every later visit) replays it.
      const cache = process.env.NODE_ENV === 'development' ? 'no-store' : attempt ? 'reload' : 'default';
      const requestUrl = attempt > 0 ? options.retryUrl ?? url : url;
      // A studio cold-load lost the connection after 118.6 MB on the wire.
      // Fetch only its missing decoded bytes from the static identity file,
      // reserving the final attempt for an ordinary full retry on older hosts.
      const rangeStart = attempt === 1 && attempt + 1 < attempts && retained && received < retained.length ? received : 0;
      const headers = new Headers(options.headers);
      if (rangeStart) headers.set('Range', `bytes=${rangeStart}-`);
      const response = await network(fetch(requestUrl, { cache, signal: controller.signal, headers, credentials: options.credentials ?? 'same-origin' }));
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const retryable = rangeStart > 0 || [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const retryAfter = response.headers.get('retry-after');
        const retryAfterMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        throw new TransferFailure(`HTTP ${response.status}`, retryable, Math.max(0, Math.min(10000, retryAfterMs || 0)));
      }
      pulse();
      const encoding = response.headers.get('content-encoding');
      const partial = exactBytes && response.status === 206;
      if (partial && (!rangeStart || (encoding && encoding !== 'identity') ||
          response.headers.get('content-range') !== `bytes ${rangeStart}-${exactBytes - 1}/${exactBytes}`)) {
        void response.body?.cancel().catch(() => {});
        throw new TransferFailure('Invalid identity byte range', true);
      }
      const total = exactBytes || Number(response.headers.get('x-asset-decoded-length')) || expectedBytes ||
        ((!encoding || encoding === 'identity') ? Number(response.headers.get('content-length')) : 0) || 0;
      if (!response.body) {
        if (exactBytes) throw new TransferFailure('Missing model body', true);
        return await network(response.arrayBuffer());
      }
      reader = response.body.getReader();
      // Raw source sizes are allocation hints; only a decoded-length header or
      // the content-addressed delivery manifest is authoritative.
      const declared = exactBytes || Number(response.headers.get('x-asset-decoded-length')) || 0;
      let direct = retained ?? (total > 0 && total <= 512 * 1024 * 1024 ? new Uint8Array(total) : undefined);
      if (exactBytes && direct && !response.redirected) retained = direct;
      const parts: Uint8Array[] = [];
      // An origin that ignores Range returns 200; overwrite the prefix from byte zero.
      let loaded = partial ? rangeStart : 0;
      received = loaded;
      for (;;) {
        const { done, value } = await network(reader.read());
        controller.signal.throwIfAborted();
        if (done) break;
        if (!value.byteLength) continue;
        pulse();
        if (exactBytes && loaded + value.byteLength > exactBytes) throw new TransferFailure('Unexpected model length', true);
        if (direct && loaded + value.byteLength <= direct.length) direct.set(value, loaded);
        else {
          if (direct) { parts.push(direct.subarray(0, loaded)); direct = undefined; }
          parts.push(value);
        }
        loaded += value.byteLength;
        received = loaded;
        onProgress?.(loaded, total, response.headers);
      }
      if (declared && loaded !== declared) throw new TransferFailure(`Incomplete download (${loaded} of ${declared} bytes)`, true);
      if (partial && direct) {
        // Check the joined bytes once, off the hot path. A stale or corrupted prefix
        // must never reach the GLB parser even if both responses had the right length.
        const digest = await abortable(crypto.subtle.digest('SHA-256', direct.buffer), controller.signal);
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== options.resumeSHA256) throw new TransferFailure('Model digest mismatch after byte range', true);
      }
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
