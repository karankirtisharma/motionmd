# MD Lounge — live architectural experience



## Current architecture — 11 October 2026



The active **v17** refines the original spiral with 23 laminated glass treads, 64 segments per curved edge, polished bevels, champagne support shoes, silicone pads and small fixings. The original route and elevations are retained. Editable source: `outputs/architecture-v17/MD_Presentation_Lounge_v17.blend` (workspace-relative); v16 remains the rollback. Read [v17 verification](qa/architecture-v17/README.md).

**49 tests pass**, including helical walking/running in both directions. The marked floor-junction export has zero competing top surfaces in the sampled region; 20 tread samples preserve marble and source elevations within 0.0000002 m. Assets and material extensions validate. Eight geometry chunks contain 10,729,015 triangles. Existing indirect lightmaps and reflection captures are reused; cross-device performance remains unverified. This is the v17 GitHub delivery checkpoint. Blender source and rollback copies remain local.

## Retained interaction checkpoint â€” 10 October 2026



The current tour is **90 seconds**, covering exterior, entrance, PC screens, hanging MD installation, atrium MD, presentation room, animated lift and founder room. The old staircase detour is omitted. See [v11 tour record](qa/experience-v11/README.md) and [v12 collision/animation record](qa/experience-v12/README.md).



The v12 local work adds six missing glass barriers and reviewed wall/object collision geometry, synchronized walk/run phases, bounded body turning and subtle upper-body weight transfer. **47 automated tests pass** at this checkpoint. This work is newer than GitHub commit `2befb4728946bd5d76d343cc51dd201a07c986d1` and has not been committed or pushed. The actual manifest governs active asset versions; older asset folders are not interchangeable.



This application renders geometry exported from the supplied `MD_Presentation_Lounge.blend`. The scene stays live during the camera tour, third-person exploration, sitting, and presentation-screen interaction. There are no prerecorded scene videos or scroll frame sequences.



The original Blender file is the production source. The browser loads GLB geometry and supporting textures, lighting, collision, and camera data. Do not replace the actual architecture with a generated approximation.



The active v17 export contains **10,729,015 triangles** across eight geometry chunks, including the lift and revised architecture. The preparation preserves evaluated geometry and original-object provenance. The entrance uses the source animation's open-door pose so the visitor can enter. This high-detail delivery needs a capable GPU; support on weaker devices must be measured before launch.



## Import motionmd into Vercel



The complete website is at the repository root. Its full-quality scene assets use **Git LFS**.



1. Import `karankirtisharma/motionmd`, branch `main`.

2. Use **Next.js**, root directory **`.`**, Node.js **24.x**, install command **`npm ci`**, and build command **`npm run build`**. Keep the default output directory.

3. Open the Vercel project's **Settings > Git > Git LFS**, enable LFS, and **redeploy**. If the initial import starts without LFS, the build deliberately stops with instructions instead of shipping an empty scene.

4. Leave `NEXT_PUBLIC_ASSET_BASE_URL` unset to use the bundled scene. An external asset origin is optional.

5. After verifying the deployed scene, add your domain in **Settings > Domains**, then apply Vercel's supplied DNS records at your registrar.



The scene includes about 770 MB of assets. GitHub LFS allowances and Vercel delivery usage apply. The repository does not purchase a plan or configure billing. Vercel's documented 100 MB Hobby / 1 GB Pro source limits concern CLI uploads; they do not by themselves establish whether this later Git import will succeed on a particular plan.



See [Vercel's LFS instructions](https://vercel.com/docs/project-configuration/git-settings#git-large-file-storage-lfs), [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), and [deployment limits](https://vercel.com/docs/limits#static-file-uploads).



## Run locally



Install Git LFS before cloning. After cloning, run `git lfs install` and `git lfs pull` inside the checkout. `npm run verify:assets` detects unresolved LFS pointers and missing manifest assets.



Use Node.js 24 LTS, the version used for the delivered test commands, and install the locked dependencies:



```sh

npm ci

npm run dev

```



Open the local address printed by Next.js. Before a production deployment, run:



```sh

npm run typecheck

npm run test:interactions

npm run test:avatar

npm run test:controller

npm run test:cinematic

npm run test:environment

npm run test:runtime

npm run test:rendering

npm run build

npm run start

```



Source assets must be present in `public/assets/`, including `scene-manifest.json`. A missing or incompatible manifest results in an explicit retry screen. The UI does not substitute unrelated stock scenes.



The [local QA guide](qa/README.md) describes the collision, avatar, environment, cinematic and runtime checks, what they cover, and the visual checks still required. Five runtime regressions cover shadow invalidation, cached cinematic poses, missing texture failures, and CDN image path resolution. Frame-loop tests use a mock renderer/controller and do not measure GPU performance or rendered shadow appearance.



## Controls



- Choose **Explore** or **Cinematic** after loading. The cinematic is a continuous 90-second architectural tour with a synchronized lift ride to the founder room.

- **Pause / Play** controls the cinematic; **Space** also pauses when a button or menu does not have keyboard focus. **Replay** restarts it. The clock stops while the page is hidden or the experience menu is open.

- **Explore** is available throughout the cinematic and at its end. Entering directly uses a short fade to the same scene's clear exploration entry point. The final cinematic pose matches the third-person handoff.

- **W A S D** walks, **Shift** runs, and the mouse looks around.

- **L** locks or releases the cursor without opening the menu. **V** changes between third-person and body-view first-person cameras.

- **E** interacts with a nearby chair or available target. **Stand up** leaves the seated view.

- **Esc** releases the pointer and opens the experience menu.

- Touch devices receive movement buttons and a drag-to-look pad. Their feasible graphics quality depends on the device.

- The menu exposes rendering quality and reduced camera motion. The operating system's reduced-motion preference is respected initially.



The current Balanced tier reduces rendering resolution and shadow quality. It does not load lower-detail geometry or reduce resident texture memory. Desktop rendering has been reviewed; mobile performance and memory remain to be profiled on actual devices.



## Project layout



- `app/`: Next.js entry point, metadata, page, and global interface styles.

- `src/components/LoungeInterface.tsx`: loading, cinematic HUD, exploration handoff, keyboard/touch controls, menu, and error states.

- `src/runtime/`: live Three.js renderer, materials, lighting, asset loading, and interaction systems.

- `src/types.ts`: the scene manifest and runtime contracts.

- `public/assets/`: browser-ready exports of the user's source scene.

- `.21st/`: the shell's visual constraints and design decisions. The 21st catalog was unavailable because it required authentication; the implemented shell uses native React elements.



The latest architectural source is `../founder-lift-v10/MD_Presentation_Lounge_Glass_Lift.blend`; its bake-prepared counterpart is `../founder-lift-v10/MD_Lounge_Sunset_Glass_Lift.blend`. These preserve the approved glass lift and terrace recess. The original supplied file remains unchanged and is included under `source/` in the lean handoff. Collider-only v11/v12 derivatives are separate; they do not replace the architectural source. Neither Blender files nor offline production tools belong in the deployed website.



## Asset contract and loading



`scene-manifest.json` names the geometry chunks and supplies the coordinate system, camera route, light information, chairs, screen identification, exploration spawn, and optional material maps. The runtime expects meters and `three-y-up` coordinates. All exported source transformations must be converted consistently.



Loading reports actual phases: checking graphics support, fetching source assets, preparing materials, preparing exploration, uploading textures, and warming shaders. Percentages are shown only when supplied as measured progress. Shader preparation matters because a completed download does not mean the GPU is ready to display every material.



The renderer selects WebGPU when available and falls back to WebGL 2. Both use the same source geometry, lighting maps, color transform, and interactions. Normal-map frames are reconstructed from the actual texture UV channel, including meshes that mix original UV0 images with baked UV1 materials. Failed material-image downloads, shader validation errors and graphics-device interruptions show a retry screen instead of presenting an incomplete scene as ready.



An explicit `?debug=1` URL exposes reference cameras, material isolation views and performance counters in either development or production. Add `&renderer=webgl` to verify the fallback. This optional inspection panel has no command execution or privileged actions, and stays hidden on ordinary visitor URLs.



All six building chunks are preloaded before the opening choice appears, with two geometry downloads/parses in flight and two KTX2 transcoder workers. Identical material texture views share GPU resources. The scene, exploration controller, character, and screen remain resident across mode changes. This avoids loading a second scene at the handoff, but it also means the initial download and GPU-memory requirement are substantial. There is no geometry LOD, room eviction, or streamed low-memory variant in this delivery.



Auto quality samples visible frame rate in two-second windows. After two windows below 35 fps it reduces resolution in ten-percentage-point steps, down to 65%; after four windows above 56 fps it restores five percentage points. High and Auto cap device-pixel ratio at 2, while Balanced caps it at 1.25 and uses a 2048-pixel sunlight shadow map instead of 4096. These controls reduce render cost, not the resident building geometry or texture set. Preloading and resolution adaptation cannot make a device with insufficient graphics memory run the full scene.



Current assets use explicit manifest paths. Cache settings revalidate unhashed assets to avoid mixing a new manifest with stale geometry. For production releases, use a versioned asset directory and publish its contents before switching the application to it. Apply immutable long-term caching only to versioned or content-addressed files.



## Lighting and texture preparation



The delivery preserves the original **10,452,798 evaluated triangles** and maps **152 used source materials** to 198 browser material variants. It repairs the earlier atlas packing failure: disconnected leaves, microdetail, and a large context ground had consumed the atlas budget while close furniture received almost no useful texels. The repaired preparation changes BakeUV packing rather than remodelling the architecture. Source positions, topology, original UVs, and corner normals are checked separately; the entrance retains the source animation's open-door pose and corresponding rotated normals.



The active geometry is under `public/assets/precision-v3/geometry/`: six GLBs totalling **358.4 MB**, retaining full floating-point source positions. Earlier position quantization had moved fine surfaces by as much as 1.25 cm. The precision repair preserves UVs, indices, transforms and material assignments; its validation report records the numerical comparison. The later founder-chair material patch preserves the entire geometry binary unchanged. The original dense PBR atlases remain under `public/assets/v2/textures/`.



Fifteen semantic atlases separate architecture, close furniture, and detail. Procedural/source-graph PBR maps are 4096Â²; diffuse illumination is 2048Â². Meaningful surfaces must pass minimum PBR-density gates of 200 pixels/metre for hero furniture, 40 for architecture, and 100 for detail. These are actual exported UV checks, not texture-file size claims. For example, the studio ivory upholstery now covers 2.64 million PBR texels, and its sampled triangle centres contain no missing black albedo. Exact source constants and native source images do not waste this atlas budget.



The 15 illumination maps under `public/assets/sunset-v4/lighting/` combine **256-sample Cycles diffuse indirect lighting and static practical-light contribution**, evaluated with the restored original material graphs. The bake preparation also repairs **818 closed components / 177,186 polygons** whose inward winding made Cycles bake light from inside the objects. A double-sided beauty render concealed this source issue. Only closed, consistently wound components with negative signed volume were reversed; vertex positions, silhouettes and each vertex's UV attachment remain unchanged. Corresponding custom normals were inverted, and open/nonmanifold surfaces were left untouched. This is a derived baking correction; it does not alter the original Downloads file.



The sunset revision uses a 12-degree sun at the original azimuth, scene-linear colour [1, .64, .36] and source power 3.6. All fifteen GI atlases and five 2K reflection captures are recalculated with that same sun. Neutral sky fill and the original practical lights remain, preserving contrast between warm direct light and cooler shadow. This is a lighting change, not an orange display filter. Direct sunlight and character shadows remain live. Five original-scene reflection captures provide room/exterior reflections. Cycles radiance-to-Three.js irradiance conversion and source exposure are explicit, rather than compensated by arbitrary lighting gain. Source leaves and small native details use the local probes and live sunlight.



The 15 lightmaps receive CPU OpenImageDenoise processing in linear HDR. Rasterized exported UV coverage protects the original padding and first two pixels of each chart, then fades into the filtered result over six pixels. A source base-colour atlas supplies a scene-linear guide; a tangent normal map is not treated as a world-space normal guide. The saved half-float ZIP EXRs must preserve protected pixels within half storage precision and pass an interior energy-change gate. Raw bakes and every report remain in the workspace. Denoising can soften illumination detail; narrow islands can retain noise, so numerical checks do not replace visual review. An edge-extension experiment was rejected because it weakened thin lighting details.



The source AgX Medium High Contrast display transform uses a validated 129-cube LUT. Its measured display error is recorded in `public/assets/color/source-color.json`. It approximates the source transform; it cannot guarantee that browser reflections or material scattering match Cycles.



PBR atlases use KTX2 UASTC, the slower quality preset, **without rate-distortion optimization**. Base colour stays sRGB; roughness/metallic and normals remain linear data. Normal maps retain all RGB channels. Mipmaps are filtered in linear light for colour and renormalized for normals. Every converted atlas has a numeric round-trip report. KTX2 is lossy, and the original PNGs are retained outside the deployed payload for inspection and future exports.



Foliage, plant pots, and the marble bust retain their original image maps on SourceUV0; original image bytes or decoded RGB pixels are checked against the packed Blender assets. The FC91 founder chair also uses its three original **2K leather images byte-for-byte on SourceUV0**, with the source's .65 normal strength and zero metallic multiplier, while its separate illumination stays on BakeUV1. This avoids resampling leather into fragmented atlas charts. Coat and sheen factors remain intact. Its proof and images are under `public/assets/source-materials/`.



Display/artwork images and compatible glass/emissive materials retain native glTF materials. The limestone wall shader additionally uses three byte-identical source images in `public/assets/source-walls/`, retaining the source world-metre projection, fine bump strength, and panel joints, with the 840-pixel cream albedo repeated every 1.2 metres instead of 4.8 metres to avoid enlarged patterning while retaining dense BakeUV1 illumination. Its analytic joint filtering reduces motion aliasing without changing the wall geometry. Normal mapping uses each texture's own UV derivative frame.



The source audit accounts for all **38 actively connected source images**, their extraction hashes, and whether they remain native images or are evaluated through a source graph into an atlas. It also verifies physical constants such as roughness, metallic, IOR, coat, anisotropy, transmission, and specular level. Explicit JSON repairs retain source sheen tint Ã— weight and the .03 source-default coat roughness, which the Blender exporter otherwise omits. glTF and Blender use different BRDFs, and the source foliage's subsurface scattering is not reproduced. The two polished-marble spatial branches retain their source world-position threshold and coat parameters.



The source audit and density checks are in `public/assets/v2/reports/source-material-coverage.json`, each zone's `*-uv-validation.json`, and `public/assets/v2/repair-summary.json`. Precision and illumination repairs have separate provenance under `precision-v3/` and `orientation-v3/`; the manifest selects the current assets. Top-level `asset-validation.json` and `texture-validation.json` describe the selected release. These numerical checks do **not** establish pixel parity with Cycles or replace visual approval on the target device. Recheck the active geometry and manifest locally with:



```sh

node tooling/finalize-assets.mjs

```



Pass `--source "C:/path/to/MD_Presentation_Lounge.blend"` if the original source has moved. `--write` applies verified metadata repairs without modifying geometry. The tool fails if the source hash, triangle count, interaction objects, required images, or authoritative lightmap UV channels disagree. A native constant material can correctly use a lightmap without a base-colour texture.



The optional local texture tools are `tooling/encode-atlas-ktx2.cjs` and `tooling/convert-glb-textures.mjs`. The encoder uses Sharp and the official Khronos KTX 4.4.2 portable WASM bundle under `work/tools/ktx-wasm/`. The converter validates image hashes and every retained geometry payload before rewriting a GLB. Production preparation tools and backups remain outside the website deployment.





## Deploy to Vercel



1. Import **this application directory** as the Vercel project root. Keep the Next.js framework preset. Commit the package lock alongside the source.

2. Run the production checks locally. Confirm the assets referenced by the manifest exist and can be downloaded without authorization prompts.

3. Decide whether the final asset payload fits the selected Vercel deployment plan. Large scene assets can reside in public Vercel Blob storage or another public CDN while the application remains on Vercel.

4. For a separate asset origin, set `NEXT_PUBLIC_ASSET_BASE_URL` in the Vercel project's environment variables **before building**. This variable is public, so it must contain an asset URL, never a credential.

5. Preserve the `/assets/` directory below that base URL. For example, the application requests `{base}/assets/scene-manifest.json`, and manifest-relative asset paths resolve below the same base. The glTF loading manager also retains this base prefix for root-relative image references. Keep geometry, texture, lighting, collision, and character files from one export version together.

6. Configure the asset origin's CORS policy to allow the deployed website to fetch these public files. Serve correct MIME types. Do not route the large geometry payload through a Vercel Function merely to proxy it.

7. When deploying with an external asset origin, stage a frontend deployment that excludes the redundant local `public/assets/` payload. `.vercelignore` intentionally does not exclude it by default because local-asset deployments need it.

8. Deploy a preview and test initial load, camera motion, transitions, four-chair interaction, screen input, refresh, retry, and return visits on the actual target devices.

9. Add the already-owned domain in the Vercel project's **Settings â†’ Domains**. Use the DNS records Vercel gives for that project at the domain's registrar. No domain transfer is required. Confirm HTTPS after DNS verification.



Vercel's documented CLI source-upload limits are currently 100 MB for Hobby and 1 GB for Pro. The complete scene exceeds the Hobby CLI upload allowance; Git import has its own deployment process. Check the [current deployment limits](https://vercel.com/docs/limits#static-file-uploads) before release. The original atlas PNGs are retained locally but excluded by `.vercelignore` because the final GLBs reference KTX2 textures.



No Vercel account, project, or purchased domain is preconfigured in this source. Do not treat a local preview as a public deployment.



## Visual validation before client approval



This is a live browser implementation, not a claim of automatic Cycles parity. Compare the exported environment with matching Blender camera views and inspect material scale, bevel silhouettes, glazing, interior exposure, sunlight, indirect illumination, and reflections. Match the complete color treatment rather than assuming that two renderers' AgX names guarantee identical output.



The actual export manifest and build notes govern which materials and lighting bakes are present. Do not infer completed baked GI, high-resolution procedural material reconstruction, seamless animation blending, or a measured frame rate merely from the runtime supporting those features. Target hardware must be profiled with the scene moving.



Static reflection captures do not contain the moving character or changing presentation content. Baked lighting does not respond to moved furniture. Thin glazing, transmission, rough reflections, and contact shadows can differ from offline path tracing. The selected visitor is **Microsoft Rocketbox Business_Male_01**, a realistic textured realtime human with 2K textures and idle, walking, running, and sitting clips. Its detail is lower than a modern scanned character; seated alignment still needs in-scene review. The MIT license and original-source provenance accompany the avatar under `public/assets/character/`. The earlier Quaternius asset remains available as a fallback.



For production quality, prioritize the lounge, curved screen, chairs, close-range surfaces, and cinematic route. Validate the broad architecture after those representative views meet the approved visual standard. The visitor's GPU ultimately renders the scene; preloading reduces interruptions but does not remove rendering or memory limits.



## Interface notes



The outside interface is intentionally restrained: charcoal, ivory, champagne accents, small identity, an opening experience choice, thin playback progress, and compact controls. The supplied PlayStation-inspired black-and-gold references belong to the room's presentation screen. The shell keeps the live architecture visible.



The 90-second cinematic retains source inspection anchors while using a dedicated curated route. Curvature-weighted spline timing, filtered unwrapped yaw/pitch and eased focal lengths keep the horizon level. The sampled path is 96.15 m, peaks at 2.31 m/s, 3.38 m/sÂ² and 36.24 degrees/s, and passes 9,121 static/moving-lift clearance samples with a 17 cm camera sphere. It boards the lift at 64 s, closes by 65.5 s, reaches upstairs at 73.5 s and opens by 75 s. The final 15 seconds reveal the founder room. Early exploration uses the original lounge handoff; completed-tour exploration starts upstairs. See the v11 record for framing and browser limitations.



Rendering uses Three.js temporal reprojection antialiasing (TRAA), mipmapped textures, up to 16Ã— anisotropic filtering, and per-texture UV derivative normal frames. The HDR colour, depth and motion-vector buffers resolve before the source OCIO display transform. MSAA is disabled as required by TRAA. Camera cuts and diagnostic changes reseed history; animated visitor motion is included in the velocity buffer. Normal-variance specular filtering widens only unresolved highlights, retaining the authored roughness where the detail is resolved. A fixed, tightly fitted 4096-pixel sun shadow frustum excludes the distant ground and stays independent of the viewer, reducing shadow shimmer. The camera uses a 10 cm near plane to improve conventional fallback depth precision. Temporal reconstruction slightly softens subpixel lines and can still ghost at disocclusions; these changes reduce aliasing rather than guarantee that every moving surface is artifact-free. Reversed depth is requested to improve precision across the interior and distant environment; the WebGL fallback returns to conventional depth when `EXT_clip_control` is unavailable. Extra screen-space AO is currently disabled: baked Cycles illumination already includes static occlusion, and a correctly ambient-only live AO pass needs further performance and visual validation. The application does not claim real-time hardware ray tracing.



Menu dialogs manage focus, controls have keyboard labels, and loading states announce phases without fabricating completion. The optional DM Sans stylesheet has system font fallbacks if the font service is unavailable.



## Relevant primary documentation



- [Three.js WebGPU renderer](https://threejs.org/docs/pages/WebGPURenderer.html)

- [Three.js temporal reprojection antialiasing](https://threejs.org/docs/pages/TRAANode.html)

- [Three.js physical node materials](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html)

- [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

- [Vercel Blob](https://vercel.com/docs/vercel-blob)

- [Connect an existing domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain)



## Door, stone and motion refinement



The Satin bronze door material is reconstructed from its source graph: constant linear RGB [0.23, 0.16, 0.09], metallic 0.82, roughness 0.24â€“0.36, anisotropy 0.2 and six-micrometre bump depth. A separate 2048Â² source Noise bake supplies its fine brushed finish; it replaces the undersampled normal atlas on this material. See `public/assets/surface-v5/bronze-provenance.json`. This is a reconstruction of the Blender material, not a new painted door texture. Its metre-based projection deliberately replaces the original object-coordinate dependence.



The original cream-stone image bytes and resolution remain unchanged. The 1.2-metre albedo repeat is an intentional presentation-scale correction. Source roughness, microscopic bump, filtered joints and the existing Cycles illumination remain separate.



Character simulation stays at 60 Hz, while the visible body and follow/body camera share the interpolated pose at each display frame. Stable grounded motion and a 1 mm collision nudge remove tested flat-floor snags. Moving character materials retain one probe-selection shader across room boundaries.



Nine large static source meshes are partitioned into 70 visibility cells using only new index buffers. All 10,452,798 triangles, full-precision vertex attributes and final material objects remain intact. A 16:9 reference-frustum audit measured 20.85â€“49.48% fewer submitted architectural triangles in four interior views and 28.89% at the entrance; the wide exterior saves only 1.19%. These are culling counts, not measured GPU-time improvements. Cells increase draw calls and do not reduce resident texture memory. Shader preloading now compiles the actual HDR/velocity pass once, removing the redundant screen-output compilation.
