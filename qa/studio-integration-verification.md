# Studio and original motion review - 31 October 2026

Work was performed in the active BACKUP. Protected FINAL and the original Screen1 source were not edited. The GitHub review branch is `codex/studio-and-original-motion`; this is not a main-branch merge or production release.

## Behavior

- The root entry gate mounts before the dynamic lounge runtime import; remembers `md-entry` and supports direct `/?mode=3d` and `/studio` links.
- Screen1 was copied with scoped CSS, local source fonts, original media and portal containers. Its original animated layout is retained. The All 50 focus ring now clips at the cell radius.
- Seated presentation visitors can click the TV or press Enter. The rendered room zooms toward the TV over 700 ms, then the retained same-origin studio iframe fades in; reduced motion uses a 180 ms fade. A validated ready handshake keeps the escape fallback available on load errors. Closing pauses studio playback and restores the seated lounge focus/pose.
- The presentation TV permanently shows centered `motiondesign.ad` and `Click to open` over the studio plate. The original founder dashboard is a separate material and remains unchanged.
- Covered-scene suspension unregisters the Three render loop, skips queued callbacks and flushes the clock before resumption; it does not destroy/reload the lounge. No per-frame TV canvas uploads remain.
- Next is pinned to 16.4.3; the final installed dependency audit reports zero vulnerabilities. The scene assets, model/texture bytes, lighting, collision geometry and loading algorithm were not changed by this integration.

## Completed verification

- `npm test`: 198 passed, zero failed. This includes fresh/re-entry pose checks at the exact visibility transition, hand and palm contacts, runtime suspension, real Three raycasting, click-versus-drag, cancellation, persistent presentation artwork, untouched founder materials and resource cleanup.
- `npm run verify:assets`, `npm run verify:studio`, and the isolated production build pass.
- Side-by-side source and copied studio screenshots at 1600 x 900 and 390 x 844 retain the same layout, type and imagery; the copied page adds the requested small lounge link.
- Browser entry flow: fresh root shows choice; light choice opens the original splash/studio; returning to root redirects to the remembered light choice; explicit mode=3d loads the lounge.
- Browser TV flow: an actual click on the seated presentation TV opens the studio; browse and inner-dialog Escape work, top-level return restores chair-04, and reopening retains the selected film. Hidden playback is suspended. The latest centered TV and opened studio were captured from the production build.
- Browser-observed studio and entry inventories contain no `/assets`, GLB, KTX2 or EXR resources. Production studio bundle/manifest inspection has no Three or lounge-runtime entry. See `studio-deployment-ledger.md` for the approximately 1.24 MB studio and 154 kB entry local response-body estimates and exclusions.
- Character runtime matches the original locomotion formulas. Initial feet are checked numerically at 1-10 mm above ordinary floors; the strict stair shoe-contact audit remains a known failure, up to 20.81 cm on a source walk sample. See `original-animation-restore-2026-10-31.md`. The restored gait is not a new stair-animation solution.

## Review limits

The studio source still uses simulated poster playback, placeholder catalog/case content, mailto brief submission and label-only language switching. Production videos, content approval and real-device/remote-network measurements remain before a large public launch. No FPS improvement or cross-device performance improvement is claimed from screenshots or background-tab callbacks.

Vercel must enable Git LFS in project Settings > Git and then redeploy, with Node 24.x and the normal npm build lifecycle. This review did not change hosting settings or deploy/merge the branch.

External screenshots and browser asset inventories: `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/studio-original-motion-2026-10-31`.
