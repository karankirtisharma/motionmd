# Live Studio presentation TV — 2 November 2026

## Implementation

The presentation TV now runs one same-origin `/studio?embed=lounge&display=tv` iframe. It reuses the production Studio UI and its browser state. UV-derived display corners project the HTML into the 3D view. The authored screen mesh provides a depth-tested alpha opening, so the visitor, furniture and architecture occlude the page. Temporal antialiasing retains the scene alpha channel instead of overwriting it with opaque alpha. Only the named PL78 display material is replaced; founder-room display and scene/character assets are unchanged.

Pointer input is handed to the iframe only over unobstructed display geometry. Keyboard focus releases room movement keys; Return to room restores the canvas. Touch/locked-pointer first contact focuses the TV. Expansion animates the same iframe to the viewport and back without reparenting or restarting the selected film/form. The 3D renderer pauses after expansion covers it. Origin and source checks protect frame messages.

The iframe is created only when the TV is visible, remains mounted to retain state, and suspends media/ambient CSS when hidden. Projection changes are imperative and camera-driven; there is no per-frame React state or screenshot-to-texture upload. No new dependencies or shipped scene assets were added. TV-only CSS adapts the almost 3:1 display and clears its curved bezel.

## Collision report

The initially added `presentation-tv` debug entry copied the old authored chair-03 approach at (10.674, 0.03, -5.274). The actual collision world rejects that point: the complete body intersects the existing coffee-table collider. Teleporting a debug visitor there bypassed normal movement collision and wedged the body between chair and table. The debug entry now starts in measured clear space at (9.5, 0.03, -5.3). Navigation colliders were not shrunk or disabled.

New tests check the actual configured debug position against the shipped collision GLBs, walk away from it, and drive the body toward the table from four sides at both 1.38 and 3.35 m/s. Every fixed step stays outside solid geometry and on the floor; reversing releases contact. Browser verification approached chair-03, sat, stood, and walked out to the left without the reported overlap.

## Doorway planter

The F73 .001 tree at (19.9625, 0, -11.9375) moves by (-1.65, 0, -0.5) beside the existing hall rock. Its complete 113,875-vertex pot/soil/trunk/canopy assembly keeps its materials, normals, UVs, scale and floor height. Both exported pot and soil colliders receive the same transform before physics setup. The visible transform precedes spatial partitioning and static shadow caching. Source GLBs and Blender files remain untouched.

Actual exported-geometry tests verify rigid displacement, complete triangles, unchanged neighbouring plants and idempotence. Walking and sprinting traverse the old footprint in both directions; the new pot remains solid. Browser verification walks through the doorway and inspects the new grouping and former floor footprint from two angles. No orphan black shadow patch was visible, so no lighting atlas was altered.

## Verification

- `npm test`: 210 passed, 0 failed (including eight live-TV tests, three new collision tests and the exported planter geometry regression).
- `npm run build`: successful, including TypeScript and `/studio` route output.
- `21st review`: both modified Studio bridge components passed, no findings.
- WebGPU: native card click, mouse wheel, search, film detail/player controls, brief page, expansion and return verified in the actual room. Selected film/player state persists and iframe count remains one.
- WebGL 2 fallback: scene and TV render, and native Automotive card click changes the page to Vanta Launch Film. No console errors in that test tab.
- Front/seated third-person and angled presentation reference camera checked. The avatar occludes the live page. Founder display retains the original content. Offscreen host is hidden; suspension/resume and retained-session behavior also have automated coverage.
- Observed browser layouts include 1280x720, 1434x1244 and 1662x1244. Direct Studio CSS remains scoped separately from the ultra-wide TV adjustments.

## Limits

Live HTML uses the curved screen's chord for DOM projection, clipped by the original curved mesh; it is not a browser rendered into every curved triangle. DOM content cannot be captured by a Three.js reflection camera, so the TV remains opaque in those captures instead of punching transparent holes in reflections. The existing Studio media/catalogue implementation is reused; this change does not supply new film files or a brief-submission backend. WebGPU/WebGL tests used the available desktop GPU, not a cross-device FPS benchmark. First interaction on touch or under pointer lock enters the TV before a subsequent native tap activates a control.

Rollback: revert the live-TV commit. Source assets and the protected `D:\Motion Design MD FINAL` copy were not modified.
