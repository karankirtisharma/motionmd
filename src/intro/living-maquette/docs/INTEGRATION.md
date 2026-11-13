# Connecting the intro to motiondesign.ad

The intro is finished against a simulated host. This page is the remaining work: the site-side adapter, and the decisions only the site can make. Nothing here has been run against the website, because its repository was not supplied.

## What the live site does today

Observed once, read-only, in desktop Chrome with WebGPU on 11 November 2026 (`docs/evidence/site-baseline.json`). This is the baseline the intro must not worsen.

| From the click on "Explore the 3D world" | Site's own label |
| --- | --- |
| 0.3 s | Preparing your visit |
| 0.9 s | Checking the graphics device |
| 5.3 s to 50.4 s | Loading the architecture N% (188.6 MB compressed, 308.2 MB unpacked) |
| 55.8 s | Preparing the light |
| 72.9 s | Preparing exploration |
| 75.9 s | Preparing textures N% (115 textures) |
| 76.8 s | Preparing reflections N% (127 variants) |
| 107.9 s | Finishing the first live reflection |
| **131.2 s** | **The Presentation Lounge is usable** (Explore or Cinematic) |

- Next.js 16.4.3, three.js r186 on a WebGPU canvas, GLB chunks with KTX2 textures.
- 572 MB in 175 requests by the time the room was usable.
- `/assets/scene-manifest.json` publishes one spawn, in the lounge. There is a camera named `MF01_Studio` and a `studio` chunk of 300 MB, but no spawn for the Motion floor.
- The landing page already offers a route with no 3D download: "Open the studio" (`/studio`).

## The adapter the site provides

Five callbacks. The intro calls them; the site reports back through `onSnapshot`. The contract is the kit's (`06_handoff/input_contract.json`, `host_contract`); `src/host/connect.mjs` is the kit's integration example with options and a trace added, and the kit's own 32 controller tests pass against it.

```js
const host = {
  capabilities: { sound: false, lightModes: ['warm', 'soft'] },

  // Called once before attaching, then on every change of room, light, sound or motion.
  // `scope` is { attemptId, destinationId, destinationRequestId }.
  setPreferences(preferences, scope) {
    world.setArrival(preferences, scope); // start (or switch to) the room task for this scope
    return true;                          // false or a rejection is shown as "could not be applied"
  },

  // Subscribe the intro to the current load attempt. Return an unsubscribe function.
  attachToCurrentLoad({ attemptId, destinationId, destinationRequestId, preferences, onSnapshot }) {
    const stop = world.onLoadEvent((event) => onSnapshot(toPatch(event, attemptId)));
    return stop;
  },

  // Start one new attempt. Resolve true when it has begun; false or a rejection shows the failure again.
  retryCurrentLoad(request) { return world.restart(request.attemptId); },

  // The lighter route. Resolve true once navigation is certain.
  openLightVersion(request) { return true; },

  // The visitor pressed Enter. `scope` adds entryRequestId and an AbortSignal.
  async enterDestination(destinationId, preferences, scope) {
    await world.prepareArrival(destinationId, preferences);
    if (scope.signal.aborted) return false;       // check immediately before committing
    world.commitArrival(destinationId, preferences); // spawn, light, input ownership
    return { ok: true, attemptId: scope.attemptId, destinationId, destinationRequestId: scope.destinationRequestId, entryRequestId: scope.entryRequestId };
  },

  onCallbackError(error, source) { report(error, source); }, // optional
};
```

### Patches

Every patch carries `attemptId`. A patch about the whole world carries nothing else. A patch about one room carries `destinationId` and `destinationRequestId` as they were **when that room's task started**, not as they are now. The controller refuses anything from a superseded attempt or selection, which is what makes lounge, Motion floor, lounge safe.

| Site stage | `phase` | `taskLabel` | `download` |
| --- | --- | --- | --- |
| Checking the graphics device | `boot` | `'Checking the graphics device'` | `null` |
| Loading the architecture | `structure` | `'Loading the architecture'` | `{ loadedBytes, totalBytes, scope: 'scene' }` |
| Preparing the light | `light` | `'Preparing the light'` | `null` |
| Preparing exploration, textures, reflections | `details` | the site's label | `null` |
| Finishing the first live reflection (per room) | `preparing-room` | the site's label | `null` |
| Room usable | `ready` | `null` | `null`, plus `readyForEntry: true` and the scope |

- A percentage is shown only for `download` with a positive `totalBytes`, and it is labelled Scene download. Texture and reflection counts are not bytes: send them as the label (for example `'Preparing textures'`), not as a download.
- `phase` moves the Structure, Light, Details, Welcome rail. Without a mapped phase the rail stays where the host last was.
- Send `lightVersionAvailable: true` with the first patch if `/studio` is the lighter route. The "Choose your version" pair (Immersive Version / Lite Version) is then present from first paint.
- Report a failure with `phase: 'failed'`, `health: 'failed'`, an `error` object and `canRetry`. Report a suspected stall with `health: 'suspected-stall'` only on task-specific evidence. Elapsed time is not evidence: the intro handles a long active wait by itself and never calls it an error.

### Readiness

```js
onSnapshot({
  attemptId, destinationId, destinationRequestId,   // captured when this room's task began
  phase: 'ready',
  readyForEntry: true,
  readiness: {                                      // optional detail; any false keeps Enter back
    criticalAssetsResident: true, firstUsableFrameRendered: true, essentialNavigationReady: true,
    collisionReadyWhereRequired: true, selectedRouteReady: true, accessAllowed: true,
  },
});
```

The site decides what usable means. The intro offers Enter from `snapshot.canEnter` and from nothing else: not elapsed time, not the percentage, not the state of the miniature.

## Decisions for the site

1. **Motion floor.** The manifest has no spawn for it. Either add a spawn and report its readiness separately, or pass `destinations: ['lounge']` and the choice is not shown. If the Motion floor needs the 300 MB `studio` chunk, its readiness will come later than the lounge's; the intro handles that honestly (it returns to "Preparing Motion floor").
2. **Early entry.** Today the room is usable at 131 s because the whole world loads first. The intro can let a visitor into the lounge as soon as the lounge alone is usable, but only the site can decide that the lounge is usable before the remaining chunks arrive. Until then the intro changes what the wait feels like, not how long it is.
3. **Warm and Soft.** The site must apply the chosen light at arrival (for example as an exposure and grade preset). If it cannot yet, set `capabilities.lightModes` to `['warm']` and the control is omitted.
4. **Sound.** Leave `capabilities.sound` false unless there is approved audio. The toggle is then omitted.
5. **Input hint.** Pass `entryHint: 'keyboard'` or `'touch'` once the room's controls are known for the device. Without it no hint is shown.
6. **Expected wait.** Set `expectedWaitMs` from measured sessions (one observation: 131 s). Past it the copy changes to "still preparing"; nothing else happens.
7. **Lite Version.** The "Choose your version" pair (Immersive Version / Lite Version) is shown only when the host reports `lightVersionAvailable: true`. Pressing Lite Version calls `openLightVersion`; the landing then offers "Explore the Lite Version" (calls `onLightVersion`) and "Back to full studio".
8. **Reduced motion.** There is no on-page control since the 2026-11 revision. The intro follows `prefers-reduced-motion`; if the site has its own setting, call `intro.setReducedMotion(true | false)`.
9. **Brand.** The header uses the plain-text name from the copy deck. Pass `brand` (text, or an element such as the logo) to replace it, and confirm the typefaces if exact identity is required.

## Cost and loading order

| Intro asset | File | Over the wire | When |
| --- | --- | --- | --- |
| Interface script | 83.7 KB | 28.3 KB | with the page |
| Styles | 30.7 KB | 7.0 KB | with the page |
| Two font subsets | 33.0 KB | 33.0 KB | with the page |
| First-paint still | 67.9 KB | 67.9 KB | with the page |
| Scene script (three.js r186, the stage, the meshopt decoder) | 672.1 KB | 176.1 KB | idle, after first paint |
| Model, meshopt-compressed (`Living_Maquette_meshopt.glb`) | 692.0 KB | 335.5 KB | idle, after first paint |
| Scene manifest | 181.5 KB | 18.9 KB | idle, after first paint |
| Motion floor furnishings, compressed | 173.6 KB | 45.8 KB | only if Motion floor is chosen |
| Quantized fallbacks (`*_quantized.glb`) | 1.29 MB / 356 KB | 548 KB / 141 KB | only where WebAssembly is refused |

About 0.67 MB over the wire in the usual case (gzip for text and the models; fonts and images as they are), against 188.6 MB for the world's architecture download: 0.35 %. The previous delivery needed 1.05 MB; the model alone went from 0.72 MB to 0.34 MB (`tools/compress-model.mjs`: EXT_meshopt_compression over 14-bit positions, 12-bit texture coordinates and 8-bit octahedral normals; same geometry, names, materials and textures, and stills rendered from both differ by less than one level in 255 on average). To keep it from competing with entry-critical requests:

- Start the world's own download first, then mount the intro. The intro already waits for an idle callback before fetching its scene.
- The site bundles three.js r186 already. Import `src/index.mjs` rather than `dist/` so the bundler shares one copy; the intro uses the classic `three` entry (WebGLRenderer) in its own small canvas and disposes of it at hand-off.
- The intro stops drawing when the tab is hidden, when nothing is moving, and after entry. It caps its drawing buffer at 2.4 megapixels and 30 frames a second.

These sizes are measured from this build. The effect on time to the usable room has **not** been measured: that needs the site. Frame cost is covered in [EVIDENCE.md](EVIDENCE.md).

## Content security policy

The intro needs no inline script or style and evaluates no strings. Checked under `default-src 'none'` with only these allowed (`dev/csp.html`, and the `strict-content-security-policy` check):

| Directive | Needs | For |
| --- | --- | --- |
| `script-src` | the origin that serves the intro | modules, loaded on demand |
| `style-src` | the same | one stylesheet |
| `font-src` | the same | two font subsets |
| `connect-src` | the same | the model, the scene manifest |
| `img-src` | the same, and `blob:` | stills and study images; the model's four embedded images |
| `script-src` | `'wasm-unsafe-eval'` (recommended) | the meshopt decoder |

Without `'wasm-unsafe-eval'` the decoder cannot start; the intro notices before downloading the compressed model and loads `*_quantized.glb` instead (about 210 KB more for the main model). Nothing else changes.

If `connect-src` allows `blob:`, the model's images decode off the main thread; if it does not, the intro notices and decodes them through image elements, which is why `img-src` needs `blob:`. With neither, the model appears in plain material colours.

Scene files with fingerprinted names or on another origin: pass `sceneAssets: { manifest, mainModel, workspaceModel }`. A model entry may also be a function that resolves to the file's bytes.

## Hand-off sequence

1. Visitor activates Enter. The intro rechecks `canEnter`, then calls `enterDestination` with the current scope, `entryRequestId` and an `AbortSignal`. The button shows "Entering the lounge" and is busy.
2. If the visitor changes room, retries, or readiness is withdrawn before the site answers, the signal aborts. The site must check it immediately before committing the spawn or taking input.
3. On a current acknowledgement the intro announces the room, calls `onEntered`, plays a short push towards the room (a 240 ms crossfade under reduced motion), removes itself and calls `onExit`.
4. On `false` the page stays as it was with a recoverable message. A stale or aborted answer is ignored silently.

## Measuring it on the site

`onEvent(name, detail)` reports `intro_first_paint`, `intro_first_control_usable`, `intro_scene_ready`, `real_phase_changed`, `world_ready`, `optional_interaction`, `destination_selected`, `light_selected`, `work_opened`, `entry_requested`, `entry_completed`, `retry_requested`, `fallback_requested` and `load_failed`, each with a timestamp. Compare `world_ready` with the 131.2 s baseline on the same device and network, with and without the intro mounted.

## Still needed from the site

| Input | Why |
| --- | --- |
| Website repository and its loader events | To write the adapter above against real code |
| A definition of "usable" per room, with scope | Readiness and early entry |
| A Motion floor spawn, or confirmation that only the lounge is offered | The second destination |
| How Warm and Soft are applied in the world | Preference hand-off |
| Logo and typeface confirmation | Exact brand identity, if required |
| Approved films and audio | Optional; the studies and silence are the defaults |
