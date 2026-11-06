# Native desktop and display flicker — 6 November 2026

## Scope and implementation

Active workspace: `D:\Motion Design MD BACKUP 26-10-2026`. The protected FINAL copy and original Blender/GLB export masters are unchanged.

The supplied md. desktop is served at `/md-desktop/index.html`. Eighteen measured monitors share one static preview texture and instanced geometry. Using a chair creates exactly one live, 1280×720 native iframe. Leaving removes its browsing context, including app timers and WebGL resources. Both desk orientations use measured screen corners and actual collision-aware approach/exit paths. Existing character rig/clips remain in use.

Retired MD_workflow_01/02 screenshots are excluded from generated delivery, with material/texture/buffer-view references remapped and guarded against shared consumers. Source exports remain intact. Release staging includes the complete `/md-desktop/` directory.

## Flicker diagnosis and targeted fixes

- The supplied six-second video was examined frame by frame. At frames 59→60 and 149→150, the lower wallpaper changes from the photographic swoop to flat orange while the app and screen geometry remain stationary. That is separate from camera projection drift.
- Isolating the wallpaper alone did not resolve the reported problem. Removing nested backdrop sampling in the transformed embedded desktop stopped the observed sharp/flat alternation.
- Embedded desktop windows now use a clipped, window-local blurred copy of the static wallpaper beneath their live DOM. The wallpaper has its own opaque layer. This avoids sampling another compositor surface. Dock, menu and embedded TV controls retain their tint, gold artwork, gradients and shadows without live backdrop sampling.
- The local wallpaper layer is inset inside the window. Background coordinates follow window geometry without extending scrollable layout; verified window scrollTop=0 and scrollHeight=clientHeight after opening Blender. An intermediate oversized pseudo-element was rejected because focus could scroll the window contents.
- The same embedded-only backdrop constraint applies to the presentation TV. The compiled TV stylesheet initially retained only the prefixed override; placing the standard property last fixed the served Chromium rule. Computed backdrop-filter was verified as none on the TV controls and search overlay. Standalone/expanded Studio retains its original effects.
- Native-screen aperture alpha uses the current frame with temporal jitter cancelled, while scene RGB keeps temporal antialiasing. Apertures open only when the iframe is ready and projection is visible; reflection cameras keep an opaque fallback. The original screen materials do not cast aperture shadows.

## Verification

- Focused automated tests: 7/7 passed. Covers all 18 real collision routes, entry/exit, reserved application keys, both orientations, portrait/landscape fit, screen/camera collision, close/oblique projection registration, startup/reflection fallback and temporal offsets on WebGPU/WebGL coordinate systems.
- Production build and TypeScript passed, including asset and Studio dependency verification.
- Browser: After Effects asset insertion and layer reorder; Blender orbit and Move (X changed from 0 to 0.694 m); ComfyUI node drag and prototype Run/preview; repeated chair enter/exit; one active computer iframe; TV search open/Escape dismissal and Automotive/Vanta navigation.
- Before adding the local frosted layer: 16 consecutive monitor screenshots showed stable wallpaper. Final implementation: eight further consecutive frames remained stable. The fixed wallpaper ROI's maximum adjacent mean pixel difference was 0.23043/255; this is a narrow visual stability observation, not a frame-rate benchmark or proof for every browser/GPU.
- Final browser evidence: `desktop-final-00.png` through `desktop-final-07.png` and `tv-final-native.png` under `C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/`.

## Limits and trade-offs

Embedded panels no longer refract or blur arbitrary windows behind them in real time. Their soft orange appearance is derived from the wallpaper locally; application DOM, controls and WebGL remain live. Standalone prototype styling is unchanged. Background browser callbacks were throttled during this pass, so no general FPS increase is claimed. This was an in-app Chromium visual check plus automated WebGPU/WebGL math checks, not a hardware/browser matrix test. ComfyUI Run is the supplied local prototype preview, not a validated external inference backend.

## Monitor housing follow-up (superseded)

The perimeter-only bridge was insufficient in the user's top view. A full-depth box closed the cavity but the user rejected its bulky silhouette. Both versions are superseded by the slim casing below.

## Slim closed monitor casing

- Replaces only the measured wide curved shell/bezel components with 22 mm closed flat panels. Original Blender/GLB masters are untouched. Source counts guard the index removal; stands, hinges, rear electronics, port details and display planes remain.
- Eighteen closed panels and eighteen small rear mounting blocks share one box geometry/material and one draw call (432 triangles). Removes 77,256 original curved shell/bezel triangles. No per-frame geometry processing, textures or additional iframe instances.
- Front casing is 2 mm behind the native display plane. Small rear mounts meet the retained hardware. Top, bottom, back and sides are closed.
- Numerical fixture checks verified all 18 panel dimensions, display clearance, removed triangle count, and preservation of port/status geometry. TypeScript and Next production build pass.
- Debug cameras `QA | Monitor housing top` and `QA | Monitor housing underside` reproduce close inspection views.
- Reloaded localhost and visually checked the close top/rear and underside cameras in WebGPU. Both show closed, slim outer panels and connected retained stands; the row shares the new profile. Evidence: `slim-monitor-top.png` in the external Codex visualizations folder. Background tab throttling invalidates FPS measurement; no FPS claim is made. Live display/input code was not changed by the slim-casing follow-up.
