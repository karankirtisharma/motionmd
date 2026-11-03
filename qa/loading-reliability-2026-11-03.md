# Loading reliability — 3 November 2026

Active workspace: `D:\Motion Design MD BACKUP 26-10-2026`. The protected FINAL folder and original scene/Blender/character assets are unchanged.

## Causes and changes

- GLB/LUT, explicit texture and EXR-worker downloads previously had one attempt and no idle-stall recovery. `fetchAsset.ts` now retries recoverable transport errors and HTTP 408/425/429/500/502/503/504, at most three attempts with bounded backoff. Permanent HTTP failures and image/model decode failures are not retried.
- The 45-second watchdog measures **time without response data**, resetting when bytes arrive. There is no total-duration deadline that would reject a large but steadily downloading scene on a slow connection.
- Each failed attempt cancels its reader/request and releases its timer and partial-buffer references before retrying. The caller abort also interrupts retry backoff. Explicit decoded-length mismatches are detected; source-size hints and compressed Content-Length are not treated as exact decoded sizes.
- PNG/JPEG loading now fetches through the same recovery path and uses the existing Three TextureLoader for decoding. Temporary Blob URLs are revoked on success, error and abort; a late texture completing after cancellation is disposed. Color-space, vertical orientation and image pixels are unchanged.
- Exterior illumination metadata and UV-buffer downloads share the same recovery path.
- The bronze restoration now disposes its just-loaded source texture if material-node setup fails before the texture reaches the runtime ownership list.

## Checks

`node --test qa/loading-reliability.test.mjs qa/decoded-progress.test.mjs qa/performance.test.mjs`: 19 passed. Faults cover transient/permanent HTTP statuses, failed fetch, interrupted/truncated body, stalled headers and body, a slow progressing transfer, caller cancellation during fetch and backoff, decode errors, byte identity, EXR pixel/sampler parity and image URL/late-texture cleanup.

`node --test qa/material-failure-cleanup.test.mjs qa/exterior-lighting.test.mjs qa/replaced-gallery-albedo.test.mjs`: 10 passed. Material prefetch cleanup was already implemented; the new fault test verifies it waits for outstanding work and disposes all successful maps before surfacing failure. Exterior source geometry/material parity remains intact.

`node --test qa/ktx2-network.test.mjs qa/ktx2-lifecycle.test.mjs qa/loading-reliability.test.mjs`: 25 passed. Additional tests cover KTX2 request/decode sharing, retry recovery, permanent/decode errors, URL modifiers and request options, progress fan-out, scene/manager cancellation and late decode disposal.

`node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.

## Limits

These are deterministic recovery and cleanup checks, not FPS, VRAM or provider-availability measurements. Retries restart the failed resource from byte zero; HTTP range-resume is not introduced. Successful downloads do not become smaller from retry handling. External glTF KTX2 images now use the same transfer recovery through SceneKTX2Loader. Its scene-local in-flight map shares one transfer and decode for identical URL/credential/header requests. LoadingManager counters stay balanced, only terminal failures reach its error hook, and scene/manager cancellation releases pending consumers. Basis transcoder JS/WASM initialization remains Three-owned; the loader guard still rejects missing required maps. Browser/backend visual validation is performed by the integrating task.

Before-file rollback snapshots: `%TEMP%\md-loading-reliability-20261103`. No source asset changes or Git push were made by this task.
