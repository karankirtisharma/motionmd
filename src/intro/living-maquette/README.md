# Living Maquette intro

The loading intro, Explore studies and selected-room entry for motiondesign.ad, built from the Living Maquette production kit (v2.1).

A visitor sees a small architectural model of the studio assemble while the real world loads. They can turn it, choose The lounge or Motion floor, choose Warm or Soft light (in the header), choose the Immersive or Lite Version, and look at three preview studies. Entry is offered the moment the site reports the chosen room usable, and only then.

**2026-11 revision.** The layout follows `docs/reference/2026-11_desktop_reference.png`: the light control moved into the header beside Sound, "Choose your version" (Immersive Version / Lite Version) replaced the light-version link, the reduce-motion control was removed (the system setting still applies), and the model is meshopt-compressed (0.34 MB instead of 0.72 MB over the wire).

**Status.** Everything in this folder runs and is tested against a simulated host that replays the stages observed on the live site. It has not been connected to the website: the site repository was not part of the kit. What that leaves to do is listed in [docs/INTEGRATION.md](docs/INTEGRATION.md), and what has and has not been verified is in [docs/EVIDENCE.md](docs/EVIDENCE.md).

## Run it

```bash
npm run serve        # http://127.0.0.1:8080/  (dist/ is already built; this needs only Python 3)
npm install          # three 0.186.0 and esbuild, to rebuild or to run dev.html
npm run build        # dist/: bundled scripts, styles and fonts
```

Open `http://127.0.0.1:8080/`. The "Simulated host" label at the top opens a panel: it switches the scenario and speed, lists the host events with the controller's verdict on each, and measures frame cost on the device in hand. The scenario can also be given in the address:

| Address | What the simulated host does |
| --- | --- |
| `/#site` (default) | Replays the live loader: same stage labels and durations, about 131 s |
| `/#normal` | An 80 s load with measured bytes in three phases |
| `/#early` | Ready in about 4 s, long before the decorative sequence ends |
| `/#returning` | The room is already usable on arrival |
| `/#slow` | An active load well past the expected wait |
| `/#unknown-total` | A download with no known total: no percentage is shown |
| `/#stall` | The host reports a suspected stall, then recovers |
| `/#failure` | The host reports a failure; Try again starts a new attempt |

Query parameters for review: `?speed=4`, `?hold=39050` (freeze the host at that many milliseconds), `?graphics=still` (force the static fallback), `?entry=fail` or `?entry=slow`, `?retry=slow`, `?route=8000`, `?panel=0`.

`dev.html` runs the same page from the unbundled sources. `dev/csp.html` runs the built page under a strict content security policy. `dev/lookdev.html` shows the model alone for look development (`?light=soft`, `?phase=ready&explode=0`, `?dest=motion-floor`, `?cookie=grid`, `?look={...}`).

`npm run hosted` writes `hosted/`: the same preview as a self-contained folder for a static host that serves only web file types. Two things differ there: the header shows a placeholder where the site shows its name, and the two models travel as base64 inside `.json` files.

## Check it

```bash
npm test                                         # 57 tests: presentation rules, host path, decorative plan, copy
LM_KIT=/path/to/kit npm test                     # also compares the generated copy and modules with the kit files
npm run test:kit -- --kit /path/to/kit           # the kit's own tests: as supplied, against this adapter, against the shipped copies
npm run check                                    # 21 browser checks (needs Playwright and Chrome; server must be running)
npm run capture -- --kit /path/to/kit            # every approved screen state, each beside its approved screen
node tools/record-transition.mjs                 # a representative runtime transition (MP4 when ffmpeg is installed)
npm run models                                   # rebuild assets/models/*_meshopt.glb and *_quantized.glb from models-source/
```

The browser tools use Playwright (`npm i -D playwright`, or set `PLAYWRIGHT_DIR`) and a local Chrome (`CHROME_PATH`).

## Use it in the site

```js
import { mountLivingMaquette } from './living-maquette/src/index.mjs'; // or dist/living-maquette.js
import './living-maquette/src/ui/intro.css';                           // or dist/intro.css

const intro = mountLivingMaquette(document.getElementById('intro'), {
  host,                        // the site's adapter: five callbacks, see docs/INTEGRATION.md
  assetBase: '/living-maquette/assets/',
  destinations: ['lounge', 'motion-floor'], // only the rooms the site permits
  expectedWaitMs: 130_000,     // the site's measured typical wait; past it the copy says "still preparing"
  sound: false,                // show the sound toggle only if the site has sound
  entryHint: null,             // 'keyboard' or 'touch' once the site confirms the input scheme
  brand: null,                 // header identity: text or an element (the logo); default is the deck's name
  sceneAssets: {},             // other URLs for the three scene files, or functions that resolve to their bytes
  onEntered({ destinationId, preferences }) { /* the room has input now */ },
  onExit() { /* the intro has removed itself */ },
  onLightVersion({ preferences }) { /* navigate to the lighter route */ },
  onEvent(name, detail) { /* measurement events */ },
});
```

The interface is ordinary DOM and is usable before, and without, the 3D scene. The renderer (three.js r186) and the meshopt-compressed model (692 KB, 336 KB over the wire) are fetched after first paint, during an idle moment. Where the page's policy refuses WebAssembly, a quantized model that needs no decoder is loaded instead.

`intro.setReducedMotion(value)` lets the site apply its own reduced-motion setting; otherwise the visitor's system setting is followed.

## What is where

```
src/index.mjs              mountLivingMaquette: wires host, interface and scene
src/host/connect.mjs       production adapter (the kit's integration example plus options and a trace)
src/host/simulated-host.mjs  the simulated host used by the preview and the tests
src/kit/                   the kit's controller, example and scene adapter, verbatim
src/ui/                    presentation model (pure), DOM view, studies sheet, styles
src/scene/                 stage (renderer, materials, light), director (decorative plan), look values
src/config/                copy and plan generated from the kit, plus strings read from the approved screens
assets/                    compressed models (+ quantized fallbacks), scene manifest, stills, study images, fonts
models-source/             uncompressed model derivatives, input to npm run models (not deployed)
tools/                     build, kit sync, stills, model optimisation, captures, checks, recording, hosted preview
tests/                     Node tests (no browser needed)
dev/                       look development, stills, recording and strict-policy pages
docs/                      integration guide, evidence, captures, the 2026-11 reference, AGENT_PROMPT.md
```

## Provenance and licences

- Geometry, materials, copy, screens and the controller come from the Living Maquette kit. `tools/sync-kit.mjs <kit>` regenerates everything that is copied or derived from it.
- `models-source/Living_Maquette_LOD_web.glb` is the kit's `Living_Maquette_LOD.glb` with its four base-colour images re-encoded as WebP (`tools/optimise-model.mjs`). `npm run models` (`tools/compress-model.mjs`) turns it and the furnishings into the delivered `assets/models/*_meshopt.glb` and `*_quantized.glb`. Geometry, names and extras are unchanged; `models-source/` is not deployed.
- three.js r186 is MIT licensed. Noto Sans and Noto Serif Display are under the SIL Open Font License 1.1 (`assets/fonts/FONT_LICENSE.txt`); the fonts here are subsets.
- The three studies are the kit's original generated previews and are labelled Preview study. They are not client work.
