# Scene and interaction checks

Run from this app directory using Node.js 24 LTS. Install the locked dependencies with `npm ci`, then:

```sh
npm run test:interactions
npm run test:avatar
npm run test:controller
npm run test:environment
npm run test:cinematic
npm run test:runtime
npm run test:rendering
npm run typecheck
```

The tests read the delivered assets and execute the actual interaction math, Rapier collision module and Rocketbox avatar module. They need no Blender installation, running website, network access, external workspace files or production build. The test commands do not change files. The avatar test transpiles the two relevant TypeScript modules in memory with the already installed TypeScript dependency.

## Interaction checks

1. All four source chairs have distinct IDs and a clear approach corner; the source table blocks standing and the tour handoff remains clear.
2. The exported upper bridge, deck and founder approach provide their source floor elevations; the authored open entrance doors admit a line of sight.
3. Diagonal input preserves movement speed and camera-relative heading.
4. The player climbs the exported architectural stair and remains grounded on its actual 2.756 m landing.
5. Damping is independent of frame rate and heading interpolation takes the short turn across the angle boundary.
6. A controlled physics fixture checks grounding, an 18 cm step, wall blocking and third-person camera obstruction.

The first, second and fourth checks use the delivered source-derived collision geometry. The last uses a small synthetic fixture to isolate controller behavior. Four further checks cover edge-triggered L/V shortcuts, look directions and pitch limits, smooth stair-height camera response, and physical perimeter blocking on all four sides. An eleventh check loads the actual shell GLB, adds only its identified context-ground primitive to physics, and verifies walking outside the entrance slab without falling through. These tests do not cover every surface in the building.

## Avatar checks

The actual `RocketboxVisitor.glb` runs through Idle, Walk, Run and Sit for at least one complete source clip loop each. Every simulated frame updates the rig; posed vertices are sampled every 15 frames for finite coordinates, standing/seated scale and floor penetration. Seated ankle variation must remain below 15 mm. A fifth check samples all posed vertices on all 240 sit/stand transition frames while turning the root toward a chair; penetration must remain below 2 mm. The source cushion is 0.56655 m above the chair's floor anchor.

Node does not decode the embedded textures. Image records and material texture properties are removed from an in-memory copy; material names, geometry, skin weights, bones and animation buffers remain intact. Therefore these checks do not assess texture rendering, skin appearance or visual material fidelity. The retained `public/assets/character/Rocketbox-POSE-QA.json` is a previous numerical snapshot; current command output is the authoritative result for the current code and GLB.

A sixth avatar check verifies the source-calibrated eye height and hides only the head/hair primitives for body-camera mode, restoring them for third person.

## Controller camera check

The single `test:controller` regression executes the actual interaction controller with the delivered source collision GLBs, Rocketbox rig/animations and physical presentation-screen geometry. It checks the final tour handoff, third-person → body view → third-person, E approach/sit at chair 03, and seated body view. It requires a third-person horizontal camera distance above 2 m at the clear handoff, a seated third-person distance above 1 m, finite poses, calibrated eye height and a screen-facing seated camera. This catches the vector mutation-order error that previously collapsed the camera into the body pivot. Browser events and screen rendering are adapted, and image decoding is omitted, so this does not verify rendered appearance, pointer lock or all four chair views.

## Environment checks

Two checks verify that the distant dune ring stays outside the source ground except for a narrow buried seam strip, remains flat near it, has upward-facing geometry and stays below 40,000 triangles. They also verify that only the identified ground material and sky background change, that IBL and global fog remain untouched, and that disposal restores the source references. HDR loading is mocked for this lifecycle test; the actual HDR file was independently decoded and its checksum verified. Shader appearance and horizon blending still require browser review.

## Cinematic checks

Two checks load the delivered camera manifest and execute the actual cinematic sampler. They preserve the source inspection route, require a 45–60 second short edit, verify the original exploration handoff, and sample motion at 60 Hz. The current limits are 1.05 m/s translation, 20 degrees/second rotation, and 2.2 m/s² acceleration. The track must start and finish at rest. A separate source-collider audit samples the exact position spline 10,001 times with a 16 cm clearance sphere; this audit does not prove framing or visual composition.

## Runtime checks

Five `test:runtime` regressions passed. The first three execute the actual frame loop and camera/character transition methods with a mock renderer and controller:

1. Advancing character frames refresh shadows; reference views, paused menus and disabled controls reuse them. Reference entry refreshes once, and resuming exploration restores live updates.
2. Each fade refreshes the map once when the character becomes hidden or visible; animation resumes after the fade finishes.
3. A stopped cinematic pose is sampled once. Reference-camera exit and the return-to-tour action restore that cached pose; material diagnostic changes refresh once; changing source clips retain animated shadows; a cached final pose still stops playback.
4. An image failure reported through Three's real LoadingManager prevents readiness even if a glTF parse could otherwise resolve; a new retry starts with clean error state.
5. Root-relative glTF image URLs retain an external asset release prefix. URLs already under that prefix, other image hosts, and blob URLs remain unchanged.

These are control-flow checks, not GPU timing measurements or proof of rendered shadow appearance. They do not validate the avatar implementation through the mocked controller. Active exploration still refreshes the shared architectural sunlight shadow map as the character animates; it does not use a separate dynamic-character shadow map.

## Rendering check

The shadow-fit `test:rendering` regression executes the production shadow-fit helper against a building and a much larger context ground. It verifies that the ground is excluded, all eight building corners fit within the low-sun shadow clip volume, the frustum is tight, and a repeated fit stays identical. It checks geometry and projection math, not visual shimmer. Both WebGPU and WebGL must also compile and render the temporal MRT pipeline; inspect camera motion, thin rails, normal-map highlights, moving character edges, and camera cuts in the browser.

## Manual browser verification still required

On a cold load, wait for **Explore / Cinematic**. Verify the scene is stationary until a choice is made. Select **Cinematic** and check the exterior descent, entrance passage, lounge reveal and natural stop. Pause and resume midway; verify the camera remains stationary while paused or while the menu is open. Replay from midway and from the end, then choose Explore during playback and from the final handoff. These checks should also run through the WebGL fallback using the explicit inspection URL `?debug=1&renderer=webgl`, available in both development and production; inspect shader and device errors separately from frame rates while Blender is using the GPU.

Open the tour, reach its final handoff, select **Explore**, focus the canvas and press **E**. The nearest chair is chair 03. Allow the approach and sitting transition to finish, click tabs on the physical screen, then press **E** to stand. Repeat at the other chairs. Verify WASD, Shift, mouse/drag look, L lock/unlock without opening the menu, V body/third-person switching, Esc/menu resume, return to tour and touch controls on their actual devices.

These numerical tests do not prove browser input focus, pointer lock, screen hit testing, all chair/body contacts, camera composition, collision on every decorative object, WebGPU compatibility, loading performance or equality with a Blender render. Collider exports intentionally cover selected structural and furniture surfaces. The character is a licensed, textured realtime human with authored motion; it is lower detail than a modern scanned cinematic character.

Character source and permissions are recorded beside the GLB in `Rocketbox-PROVENANCE.json` and `Rocketbox-MIT-LICENSE.txt`. The optional older character has its own CC0 record. The client architecture remains a separate source asset.




## Surface and high-refresh movement checks

The full automated suite now contains 30 passing checks. The additional controller regression executes Rapier and the actual controller at 60, 90, 144 and 165 Hz. After settling, every walking and body-camera displacement stays within 3% of its expected per-frame distance. It catches repeated zero-step frames, doubled steps and flat-floor contact snags. This is a deterministic translation test, not a measurement of real GPU frame pacing.

The second rendering check partitions a dense transformed mesh, verifies every oriented triangle occurs exactly once, checks each cell's bounds and world transform, and requires identical shared vertex attributes and material references. The separate full-source visibility audit retains all 10,452,798 triangles. Visual inspection is still needed for material appearance, moving reflections, occlusion and every target device.
