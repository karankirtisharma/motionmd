# Evidence

What was checked, how, and what it does and does not show. Produced on 11 November 2026 from this folder; revised on 13 November 2026 for the 2026-11 design revision (next section).

There are two kinds of evidence here and they are kept apart throughout.

- **Simulated host.** The intro running on `src/host/simulated-host.mjs`, in Node or in headless Chrome. Headless Chrome draws the scene with a software renderer (SwiftShader), so pictures are faithful and frame timings are not.
- **Actual site.** One read-only observation of the live loader at motiondesign.ad, used as the baseline. Nothing in this folder has been run inside the website, because its repository was not part of the kit.

## 2026-11 revision

Requested from the desktop reference `docs/reference/2026-11_desktop_reference.png`:

| Change | Where | Checked by |
| --- | --- | --- |
| Light control (Shape the light: Warm / Soft) moved into the header, right of Sound | `src/ui/view.mjs`, `intro.css` | `keyboard-order-desktop`, `system-motion-setting-followed`, capture R01 |
| "Choose your version": Immersive Version (current) / Lite Version replaces the "Use light version" link; Lite opens the host's lighter route | view, `present.mjs` | `light-version-route` |
| Reduce-motion control and its panel removed; the system setting still applies, and the site can call `intro.setReducedMotion()` | `index.mjs` | `system-reduced-motion-first-paint`, `system-motion-setting-followed` |
| "Choose your first stop" eyebrow removed from view (kept for screen readers); the pills keep their place | view, `intro.css` | capture R01 |
| Light phase body: "Explore a little while the studio prepares." | `present.mjs` | Node test |
| "light version" reads "Lite Version" in every shown string | `copy.mjs` (`renameLite`) | Node test |
| Model compressed with meshopt, with a quantized fallback | `tools/compress-model.mjs`, `stage.mjs` | stills diff, `strict-content-security-policy` |

At 1440 x 900 the selected pills were measured in the reference and in capture R01 (left, top, right, bottom, in px):

| Pill | Reference | Runtime |
| --- | --- | --- |
| Warm (header) | 1174, 28, 1278, 64 | 1173, 27, 1272, 66 |
| The lounge | 55, 520, 223, 564 | 57, 520, 220, 568 |
| Immersive Version | 56, 633, 222, 670 | 56, 631, 220, 672 |

Every edge agrees within 6 px, most within 2. The model is the real-time kit model, not the reference's generated plate, as before.

On a phone the light control takes a row under the name and Sound, and the version pair sits under the room pair. The recovery screens hide the light control so their actions stay on one screen.

**Compression.** Stills rendered from the compressed and the float model differ by 0.46 to 0.66 levels in 255 on average; under 0.3 % of pixels differ by more than 24 levels. Every one of the 79 meshes lands at the same place with the same material.

## Acceptance, item by item

The ids are the kit's (`06_handoff/production_requirements.json`).

| Id | Shown on the simulated host | On the actual site |
| --- | --- | --- |
| CANONICAL-LOOK | 23 runtime captures at 1440 x 900 and 390 x 844, each beside its approved screen. Type, positions and controls follow the approved screens to within a few pixels. Rotation and Warm/Soft are exercised by the checks and shown in the recorded transition. The miniature is a real-time rendering of the kit geometry and is visibly not the generated plates: see "Known differences". | Needs the owner's eye on a real display. Not a host question. |
| EARLY-ENTRY | With the host reporting the room usable about 4 s into the load, Enter was offered while the decorative sequence stood at 8.3 s of its 80 s, and the entry was acknowledged and handed over. With the room already usable on arrival, Enter was offered 11 ms after mount (measured on the static fallback, so the figure is the interface alone). | Not run. Needs the site adapter and a per-room definition of usable. |
| STALE-RESULTS | The kit's 32 controller tests pass against the shipped adapter. Lounge, Motion floor, lounge: the first lounge result is refused as `superseded-scope` and Enter stays back until the third request reports. Duplicate activation is one request; a room change or a retry aborts a pending entry. | Not run. The same checks apply once real callbacks exist. |
| LOADING-RECOVERY | Measured bytes shown as a floored percentage labelled Scene download; no percentage without a total; slow, stall, failure, retry and the lighter route each rendered and exercised. Choices survive retry and the studies sheet. | Not run. |
| RESPONSIVE-ACCESS | Keyboard order, visible focus, 44 px targets, rotation by button, drag and touch, studies focus return, system reduced motion (at first paint and switched on mid-session), the static fallback, loss of the WebGL context, a strict content security policy, 23 viewport and text-size cases. | Mostly independent of the host. Not tried on physical devices or with a screen reader. |
| ARRIVAL-PREFERENCES | The acknowledged entry carries the room, light, sound and motion choices; the simulated arrival screen states what it received. | Not run. The site must apply them. |
| RUNTIME-COST | Transfer sizes measured from the build. Draws only when something changes, never in a hidden tab (checked). Frame cost measured on one real desktop GPU: see "Runtime cost". | Baseline observed once: 131.2 s to the usable room. A comparable trace with the intro mounted needs the site. |

## Commands and results

```bash
LM_KIT=<kit> npm test                    # 57 tests, 57 pass (without LM_KIT: 56 pass, the kit comparison is skipped)
npm run test:kit -- --kit <kit>          # supplied 47/47, adapter 32/32, shipped copies 15/15
npm run check                            # 21 of 21 browser checks pass
npm run capture -- --kit <kit>           # 23 states captured, no page errors
node tools/record-transition.mjs         # 551 frames, 36.7 s at 15 fps
```

- `npm test` runs without a browser: the presentation rules (22), the host path on a manual clock (15), the decorative plan (11) and the copy (7). With `LM_KIT` set it also compares every generated or copied file with the kit's.
- `npm run test:kit` runs the kit's own command three ways: as supplied, with the controller tests pointed at `src/host/connect.mjs`, and with the scene-adapter tests pointed at the copy in `src/kit/`. Results: `evidence/kit-tests.json`.
- `npm run check` results, with what each check observed: `evidence/browser-checks.json`.
- Captures and their record: `evidence/captures/`, `evidence/captures/captures.json`.
- Transition: `evidence/transition/transition.mp4` and `storyboard.json`. It shows the model only (no interface) and was recorded on 11 November from the uncompressed model; the compressed model draws the same picture (see "Compression" above).

## What the browser checks establish

All on the simulated host, in headless Chrome.

| Check | What it shows |
| --- | --- |
| `keyboard-order-desktop` | Tab order is Sound, light (header), room, Immersive, Lite, rotation, studies; Enter follows when ready. |
| `keyboard-choices-and-entry` | Arrow keys choose the room and the light; Enter on the keyboard hands over lounge and Soft. |
| `focus-visible` | Every control shows a 2 px ring, offset 4 px, on keyboard focus. |
| `target-sizes` | No control is under 44 x 44 px on desktop, phone, or the phone failure screen. |
| `rotation-buttons-and-drag` | Buttons and mouse drag turn the model, take over from the passive turn, and stop at the 22 degree limit. |
| `touch-rotation-and-scroll` | A horizontal touch drag turns the model; vertical scrolling stays with the page (`touch-action: pan-y`). |
| `studies-focus-return-and-ready-in-sheet` | The sheet takes focus, the page behind is inert, readiness is announced and offered inside the sheet, the sheet stops saying that loading continues, and closing returns focus to the link. |
| `system-reduced-motion-first-paint` | With the system setting on, the first frame is a composed still; two frames six seconds apart are identical; every choice still works. |
| `system-motion-setting-followed` | No reduce-motion control on the page; the light control is in the header; the version pair reads Immersive (current) and Lite. Turning on the system setting mid-session reduces motion, hides rotation, returns the model to its still pose and reaches the host. |
| `graphics-fallback-still` | Without WebGL the still stands in, three.js is never fetched, choices swap the still, rotation is not offered. |
| `graphics-context-loss` | Losing the intro's renderer swaps to the still and is not treated as a load failure. |
| `strict-content-security-policy` | Under `default-src 'none'` with only this origin's scripts, styles, fonts and requests, and images from this origin, `data:` and `blob:`: the scene starts, fonts load, and every surface keeps its image (decoded through image elements once `fetch()` of `blob:` is refused). |
| `viewports-and-enlarged-text` | 23 cases from 360 x 640 to 1920 x 1080, text at 150 % and 200 %, browser zoom 200 %: nothing off the page, nothing under the rail, focus never left under the pinned rail. At the approved viewports loading, ready, failure and a three-action stall all fit without scrolling. |
| `early-entry-while-decoration-unfinished` | See EARLY-ENTRY. |
| `already-ready-on-arrival` | Enter is available within milliseconds of mount when the room is already usable (measured on the static fallback). |
| `route-change-rejects-stale-readiness` | See STALE-RESULTS. |
| `failure-retry-keeps-choices` | One retry request, late results from the old attempt refused, Motion floor and the light kept, ready on attempt 1. |
| `stall-keep-waiting` | A host-reported stall offers only supported actions; Keep waiting returns the choices; the state clears when the host reports progress. |
| `entry-declined-then-retried` | A declined entry is announced, leaves the page as it was, and the next request succeeds. |
| `light-version-route` | Offered from the first host report; the landing takes focus; Back returns to loading with choices intact. |
| `hidden-tab-pauses-decoration` | Hidden: no frames, the decorative clock stops, the host keeps reporting. |

## Captures

`evidence/captures/<id>.jpg` is the runtime; `<id>_vs_approved.jpg` puts the approved screen on the left. The host is held at the moment the approved screen depicts, and the miniature is composed at a matching decorative time. Composition never changes readiness.

| Id | State | Id | State |
| --- | --- | --- | --- |
| D01 | First arrival | M01 | Mobile arrival |
| D02 | Structure download, measured | M02 | Motion floor and Soft |
| D03 | Lighting (the look anchor) | M03 | Ready |
| D04 | Details | M04 | Slow preparation |
| D05 | Motion floor selected | M05 | Studies |
| D06 | Soft light confirmation | M06 | Light study, ready |
| D07 | Studies | M07 | Failure |
| D08 | Ready to enter | M08 | Retry in progress |
| D09 | Slow, still active | M09 | Lite Version landing |
| D10 | Failure and recovery | T01 | Arrival (simulated room) |
| D11 | Lite Version landing | R01 | The D03 moment beside the 2026-11 reference |
| D12 | System reduced motion (the on-page control is gone) | | |
| D13 | Light study detail | | |

Since the 2026-11 revision the kit's approved screens differ from the runtime in the header (light control, no reduce-motion control) and the version row; R01 is the comparison that matters for those.

## Known differences from the approved screens

The 2026-11 reference overrides the kit's approved screens wherever the two differ: the header (light control, no reduce-motion control), the version row, the hidden "Choose your first stop" eyebrow and the light-phase body all follow the reference. The differences below are the ones that remain.

**The miniature.** The approved screens use generated plates. The kit names its own geometry as the authority, and the two disagree in places the runtime cannot reconcile:

- The plates show stone walls around the lounge shelving and a stepped stone plinth top. The kit model has open bronze frames there and a plain plinth top.
- The plates look down on the model more steeply than the kit's canonical camera (about 9 degrees of elevation). The runtime sits between the two, with upright verticals as in the plates.
- Stone veining, the glow under the ceiling light lines and the leaf shadows are present but simpler than in the plates.

Palette, materials and composition were tuned against D03 and M01: champagne-bronze plinth, rose-ivory stone, dark bronze frames, visible glass, the ceiling light line. Whether this is close enough to "the intended design" is the owner's call, and the reason CANONICAL-LOOK is not marked as met.

**Copy.** Where an approved screen and the copy deck differ, the deck wins, since the kit names it as the source of exact copy:

| Screen text | Runtime (deck) |
| --- | --- |
| D02 "Downloading structure" | "Preparing the structure" |
| D09 rail "Still preparing the room" | "Still preparing the studio" |

**Numbers.** The percentage is floored, so 63 % appears where the screen shows 64 %, and 99.6 % is never shown as 100.

**Controls.**

- The light control is in the header in every state that has a choice to make. On a phone it takes a row under the name, and steps aside on the recovery screens and while the studies sheet is open, so those still fit one screen.
- The version pair shows only when the host reports a lighter route. "Immersive Version" marks the experience on screen; pressing it does nothing.
- On desktop the hint line sits beside the version pair.
- The model's box starts under the header so the lifted roof never sits behind Sound or the light control. The reference's generated plate is larger and wider than the kit geometry allows at that height.
- The sound toggle appears only when the host declares sound. The preview's simulated host declares it so the control can be reviewed.
- The compact ready screens show one line under the Enter button ("Movement controls appear inside.") when the host confirms the input scheme. M03 and M06 show none.
- M08's headline is drawn one pixel smaller and four pixels higher than M01's. The runtime keeps M01's type and keeps the two actions exactly where they were in M07, which is what M08 is for.
- M07: the headline and copy match to the pixel. Below the model, the note, the two actions and the link sit about nine pixels higher than drawn, because the link keeps a 44 px target clear of the rail.

**T01.** The arrival is a stand-in: the kit's arrival still with a card that says so and lists what was handed over. The real room is the site's.

## Runtime cost

Sizes are from this build (1 KB = 1,000 bytes; "over the wire" is gzip where the server would compress, and the file size for fonts, images and WebP).

| Asset | File | Over the wire | When |
| --- | --- | --- | --- |
| Interface script (4 files) | 83.7 KB | 28.3 KB | with the page |
| Styles | 30.7 KB | 7.0 KB | with the page |
| Two font subsets | 33.0 KB | 33.0 KB | with the page |
| First-paint still | 67.9 KB | 67.9 KB | with the page |
| Scene script: three.js r186, the stage, the meshopt decoder | 672.1 KB | 176.1 KB | idle, after first paint |
| Model, meshopt | 692.0 KB | 335.5 KB | idle, after first paint |
| Scene manifest | 181.5 KB | 18.9 KB | idle, after first paint |
| Motion floor furnishings, meshopt | 173.6 KB | 45.8 KB | only if Motion floor is chosen |
| Quantized fallbacks (main / furnishings) | 1.29 MB / 356 KB | 548 KB / 141 KB | only where WebAssembly is refused |
| Other stills (8) | 1.01 MB | 1.01 MB | only under reduced motion or without WebGL, one at a time |

The usual case is about 0.67 MB over the wire (1.05 MB before the 2026-11 compression), against 188.6 MB for the world's architecture download: 0.35 %.

**Choice of model.** Measured from the kit's four candidates:

| Candidate | File | gzip |
| --- | --- | --- |
| `Living_Maquette.glb` (quality) | 13.66 MB | 9.42 MB |
| `Living_Maquette_LOD.glb` | 3.11 MB | 1.99 MB |
| LOD with its four images as WebP (`models-source/`) | 1.85 MB | 0.78 MB |
| **The same, meshopt-compressed (shipped)** | **0.69 MB** | **0.34 MB** |
| The same, quantized only (fallback) | 1.29 MB | 0.55 MB |
| `MotionFloor_Furnishings_LOD.glb` / meshopt (shipped, on demand) | 0.66 / 0.17 MB | 0.23 / 0.05 MB |

The LOD model holds every named part the scene adapter needs. Re-encoding its four base-colour images, then meshopt compression over quantized attributes (14-bit positions, 12-bit texture coordinates, 8-bit octahedral normals), cut the main model's transfer from 1.99 MB to 0.34 MB with no change to geometry, names, materials or extras. Quantization moves each mesh's offset and scale onto its node; the runtime restores the original node transforms and float positions on load, so the scene code is unchanged.

**How it draws.** One WebGL canvas, three.js r186. It draws only when something moved, at most 30 times a second, with the buffer capped at 2.4 megapixels and a pixel ratio of 1.5. It stops in a hidden tab, stops once the model has settled, and releases the renderer at hand-off.

**Renderer observations.** Headless Chrome with its software renderer manages one to two frames a second, which is useful for pictures only.

**One real device.** The hosted preview in desktop Chrome on Windows, NVIDIA GeForce RTX 5080 (ANGLE, Direct3D 11), drawing buffer 1832 x 1172:

- A full frame with the shadow pass took 4.1 ms (median of 11 frames, slowest 12.8 ms). Each frame was timed until the GPU had finished it.
- A frame with the shadow pass is 147 draw calls and 79 thousand triangles; without it, 95 and 40 thousand.
- Only 11 animation frames arrived in the 2.5 s window, so that browser window was probably not in the foreground. The cost of a frame is not affected; a frame rate cannot be read from it.

This is a high-end desktop GPU. Phones and integrated graphics are not measured. The preview's panel has a "Measure frame cost on this device" button for exactly that.

**Baseline (actual site).** One cold visit in desktop Chrome, 11 November 2026: the Presentation Lounge was usable 131.2 s after the click on "Explore the 3D world", after 572 MB in 175 requests (`evidence/site-baseline.json`). The simulated "site" scenario replays those stages.

**Not measured.** Time to the usable room with the intro mounted, on the same device and network. That is the comparison RUNTIME-COST asks for, and it needs the site. `onEvent` reports `intro_first_paint`, `intro_scene_ready` and `world_ready` for it.

## The hosted preview

`npm run hosted` assembles the preview for a static host. It is the same build with two differences, and they are the only ones:

- The header shows "Studio name" where the site shows its own name. The delivered build uses the name from the copy deck.
- The `.glb` models travel as base64 inside `.json` files, for hosts that do not serve `.glb`. The bytes are identical.

The real-device observation above was made on it on 11 November, before the 2026-11 revision, as were a pass through the studies sheet at ready and an entry to the simulated arrival. On 13 November the revised preview was opened once in the same desktop Chrome: the compressed model loaded and drew, with the new header and version row. Frame cost was not measured again; the geometry drawn is the same.

## Decisions taken without the site

1. A simulated host stands in for the website. It replays the live loader's stages and durations and can script early readiness, a slow load, an unknown total, a stall and a failure.
2. The miniature assembles fully only when the host reports the room ready. Decorative time alone never shows the finished model, so the picture cannot promise what the load has not delivered.
3. Elapsed time changes the wording after the expected wait and nothing else. It never offers entry and never raises an error.
4. A control the site cannot honour is left out: the room choice with one permitted room, the light control without supported light modes, the sound toggle without sound.
5. The lounge is the default room, as on the live site. Motion floor is offered because the kit specifies it; the live manifest publishes no spawn for it (see `INTEGRATION.md`).
6. On a compact screen the model band gives way before the page scrolls: a longer headline or a third recovery action makes the model smaller, and every action stays on screen.
7. Text set larger by the visitor is honoured up to 200 %. Lines wrap, the header's settings drop under the name, the page scrolls, and keyboard focus is never left under the pinned rail.

## Still needed

The kit's external inputs, unchanged:

| Id | Needed for |
| --- | --- |
| HOST-SOURCE | The website repository, renderer and loading lifecycle: to write the adapter against real code |
| HOST-READINESS | Scoped readiness and a real entry acknowledgement: EARLY-ENTRY, STALE-RESULTS |
| HOST-DESTINATION-LIGHT | Permitted rooms and spawns, and how Warm and Soft are applied: ARRIVAL-PREFERENCES |
| BRAND-ORIGINALS | The logo and typeface confirmation, if exact identity is required |
| APPROVED-FILMS | Optional. The three preview studies are the default |
| APPROVED-AUDIO | Optional. Sound stays off and the toggle stays hidden without it |
