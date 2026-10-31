# Explicit entry and Android phone routing — 31 October 2026

Supersedes the remembered-choice and direct mode=3d behavior in the earlier studio integration checkpoint.

- Every root visit on desktop/tablet shows the existing two-option entry UI. Neither localStorage md-entry nor mode=3d mounts the scene. Only the Explore button mounts LoungeHome and its existing dynamic runtime import.
- Android phones redirect to /studio?entry=direct before displaying an exploration option or mounting the scene. Android tablets keep the chooser. Detection uses Android plus the Mobile marker or Client Hints, excluding known tablet markers; UA spoofing remains a detection limitation.
- The standalone studio hides its 3D link on Android phones, including its first render. Direct entry skips the studio intro splash. The existing studio UI, scene, animations and assets are otherwise unchanged.
- The existing cream/gold/dark entry design was reused. 21st lookup returned HTTP 401; its local review reported zero findings. No new dependency or generated UI was installed.

## Verification

202 regression tests pass, including actual entry-component rendering with controlled hook lifecycle: old saved 3d/light values, direct mode=3d links, Android phone redirect, tablet choice, and hidden studio links. Production build (.next-entry-review), TypeScript, asset and studio isolation checks pass.

Live production browser checks: old direct-3D URL shows the chooser; the studio link opens the film UI immediately without the splash; its return link shows the chooser again; clicking Explore starts the 3D loading flow. Browser-observed inventories show no /assets, /asset-delivery, GLB, KTX2 or EXR resources on the chooser or studio route. Android routing is covered by component tests, not a claimed physical Android-device run.

External screenshots and inventories: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/entry-opt-in-2026-10-31.

## Deployment

User explicitly authorized pushing the studio integration and this entry follow-up into main. The previous commit dedbe21 was only on a review branch: GitHub reported a successful preview for motionmd-6ipx, failed previews for motionmd and motionmd-fu45, and production still referencing 5b991a9. Failure logs require Vercel login; no root cause is inferred solely from a failed status. Hosting settings have not been changed.
