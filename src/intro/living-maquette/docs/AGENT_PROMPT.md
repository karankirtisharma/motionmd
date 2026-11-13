Replace the site's current loading page with the Living Maquette intro in `living-maquette/` (unzipped from living-maquette-intro.zip). The design, copy and behaviour are final: integrate, don't redesign.

READ FIRST: living-maquette/README.md ("Use it in the site") and living-maquette/docs/INTEGRATION.md (adapter contract, decisions, CSP, cost). The look to match is docs/reference/2026-11_desktop_reference.png and docs/evidence/captures/.

DO
1. Copy `living-maquette/` into the repo (e.g. `src/intro/living-maquette/`). Serve its `assets/` folder statically (models, stills, study images, fonts) and pass that URL as `assetBase`. Serve .glb/.json/.js/.css with gzip or brotli.
2. Mount it where the old loader mounted, before the world starts drawing:
   `import { mountLivingMaquette } from '.../living-maquette/src/index.mjs'; import '.../living-maquette/src/ui/intro.css';`
   `const intro = mountLivingMaquette(el, { host, assetBase, destinations, expectedWaitMs, sound: false, entryHint, onEntered, onExit, onLightVersion, onEvent });`
   If the site's three.js is not 0.186.x, import `dist/living-maquette.js` + `dist/intro.css` instead (they carry their own three r186).
3. Write the `host` adapter (5 callbacks: setPreferences, attachToCurrentLoad, retryCurrentLoad, openLightVersion, enterDestination) from the site's real loader, following docs/INTEGRATION.md and `src/host/connect.mjs`. Report progress as patches through `onSnapshot` (each with `attemptId`; room patches also carry the `destinationId` + `destinationRequestId` captured when that room's task began). Send `download: { loadedBytes, totalBytes, scope: 'scene' }` only for measured bytes. Send `phase: 'ready', readyForEntry: true` only when the chosen room is really usable. Check `scope.signal.aborted` right before committing entry.
4. Send `lightVersionAvailable: true` in the first patch only if the site has a Lite Version route (otherwise the "Choose your version" row hides). Pass only rooms that have a spawn in `destinations` (today the manifest has a lounge spawn only). Leave `sound: false` unless there is approved audio. If the site has its own reduced-motion setting, call `intro.setReducedMotion(bool)`; otherwise the OS setting is followed.
5. Apply the arrival preferences (room, Warm/Soft light, sound, reduced motion) in `onEntered`, then let the world take input. The intro removes itself and calls `onExit`.
6. Remove the old loading page, its assets and styles once the new one works. Start the world's own download before mounting the intro so the intro never competes with it.
7. CSP: allow the intro's origin for script/style/font/connect/img, `blob:` in img-src, and `'wasm-unsafe-eval'` in script-src (meshopt decoder). Without wasm it falls back to `*_quantized.glb` automatically.

DON'T
- Don't change layout, copy, colours, motion timings, or the model look/lighting values (`src/scene/look.mjs`).
- Don't delete `*_quantized.glb` fallbacks, the stills, or `models/scene_manifest.json`; don't re-export or re-compress the models (use `npm run models` from models-source/ if ever needed).
- Don't drive Enter from timers or the decorative animation; only from the host's readiness.

VERIFY
- `cd living-maquette && npm install && npm test` (57 tests: 56 pass, 1 skipped without the kit).
- In the site: loading → Preparing lighting at desktop 1440x900 matches the reference; phone 390x844 has no page scroll; Enter appears only when the lounge is usable; switching Lounge → Motion floor → Lounge never shows a stale Enter; Retry and Lite Version work; reduced motion (OS setting) shows a still model with every choice working; one copy of three.js in the bundle.
- Report time to the usable room with and without the intro (onEvent gives intro_first_paint, intro_scene_ready, world_ready).
