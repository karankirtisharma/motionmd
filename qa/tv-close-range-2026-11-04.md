# Curved TV close-range repair — 2026-11-04

Scope: presentation TV only. No Blender geometry, scene textures, character animation, collision or broad asset-pipeline changes.

## Confirmed faults and repairs

- Chromium backdrop filtering inside the sixteen projectively transformed visual fragments produced wide black/missing bands during nearby camera movement. Reproduced in recorded baseline sweeps. Removing only backdrop-filter from the inert TV copies eliminated those bands. The live iframe, expanded Studio, images, gold borders, gradients and normal highlights remain intact. The in-world copies deliberately omit backdrop blur/refraction sampling; this is the visual trade-off.
- A 16-source-pixel overlap projected duplicate UV edges from adjacent facets. Reduced to one pixel. The authored-geometry regression measured maximum duplicate edge separation dropping from 3.31 to 0.202 screen pixels on its close-camera test poses.
- Motion popLayout inserts transient position rules into head CSSOM. These were missing in visual copies. Mirror the transient rules separately and dispose the observer/sheet with the view.
- TV-only title/footer/minimap safe areas now avoid the physical bezel without resizing standalone Studio cards.

## Validation

- npm test: 303 passed, zero failed.
- npm run build: passed, including TypeScript. Local production build ID: uUPFri7FrOoK9vnHNccee.
- Recorded 10-second continuous close-range camera sweeps in both WebGPU and WebGL; reviewed 36 captured frames per renderer. No wide black strips in the repaired captures.
- Checked left/right oblique views, extreme close-up, pitch up/down, and an actual character walk to the screen.
- Native projected clicks selected Automotive, Consumer Tech, Food & Beverage and Beauty & Fragrance; checked intermediate transitions, expanded screen and return to TV.
- Checked 1280x720, 1920x1080 and 2560x1254 viewports.
- Evidence directory: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0. Files use tv-repair-* prefixes. Baseline and repaired WebGPU/WebGL contact sheets are retained there, outside the project.

## Performance limits

Alternating 12-second browser frame-timing trials were noisy: warm runs had similar median (18.2ms) and p95 (about 36.4ms), with no repeatable overall FPS improvement. Screencast timings are not benchmarks. This repair removes the identified failing backdrop-compositing work but does not prove an 80% speed increase or eliminate every whole-scene stall. No actual low-end hardware test was available. Broader asset streaming/geometry optimization remains a separate approval and measurement task.
