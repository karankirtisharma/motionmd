# Reported character and exterior defects â€” 27 October 2026

Active copy: D:/Motion Design MD BACKUP 26-10-2026. Protected FINAL and publishing checkout were not edited. No GitHub publication in this task. Source Blender, GLBs, textures, animation clips and rig are unchanged.

Evidence: C:/Users/karan_z7alww2/.codex/visualizations/2026/10/17/01a14a42-20bc-7ca3-a5e8-1779e078f8e0/reported-defects-2026-10-27. Original runtime files are in before/; temporary diagnostic scripts were moved into diagnostics/ outside the website.

## Per-image diagnosis

- Image 1: HF89 founder club chairs had seat-cushion collisions but no wraparound back/arm shell. Four source-derived convex outer envelopes now protect these decorative, non-interactive chairs. Maximum source undercoverage is 5.3â€“6.4 mm, below the 15 mm controller margin. These envelopes fill the inaccessible seat cavity; the four interactive PL78 discussion chairs and executive swivel retain their existing interactions. The hanging-hand body guard now reaches 35 cm above the floor instead of 55 cm, retaining the same 35 cm radius.
- Images 2â€“4: five finished exterior slabs were absent from the collision export. The character stood on the sand 34.5 cm below the stone; the foot solver compensated by folding both legs. Exact source surfaces, including L-shaped footprints and bevels, now provide support. Body support measures within 1 mm of the visible surface; idle foot corrections are approximately 1 mm. Foot IK also rejects surfaces above the controller's 27 cm step limit.
- Images 5â€“6: five exterior limestone components (including the entry steps) were wound inside-out. Reverse only the identified 864 source triangles and corresponding normals/tangent handedness at initialization. Positions and UVs remain byte-identical. At the north/east join, trim four buried coplanar slab faces, interpolating source attributes; a ray now hits one top surface rather than two. Bounds and visible outline remain unchanged. These repairs address reversed shading and depth fighting without changing textures or hiding surfaces.
- Additional finding: 38 visible architectural glass panes were absent from collision exports. Exact source panes now block bodies and cameras; door openings remain available.

## Reproduction and checks

Generators: node qa/generate-exterior-collision.mjs --write; node qa/generate-facade-collision.mjs --write; node qa/generate-club-collision.mjs --write. Source changes require regeneration and repeat validation.

- Full suite: 100/100 passed before the final facade/overlap/club additions (full-tests.log).
- Facade stage: 35/35 targeted tests passed (facade-regression.log).
- Final reported-defect suite: 7/7 passed. This includes all five source slabs, winding/UV preservation, overlap, 76 camera sweeps and 63 unobstructed sprint approaches against glass, 20 discussion-chair approaches at four headings, and 52 curved club-chair approaches at four headings.
- The new curved-chair test was first run without the added shell colliders and FAILED on actual skinned hand/body vertices at [11.1607, 4.9298, -6.1105]. It passed after adding the source hulls. The earlier PL78 test did not reproduce this separate HF89 problem and is retained only as regression coverage.
- After the final club addition, 15/15 controller/camera, coverage, remaining collision and workstation tests passed. These include 60/144 Hz stair routes and founder entry/work/exit with no sampled hand/desk penetration. Another 11 runtime/rendering/environment tests passed after the exterior repairs.
- Final production build, TypeScript, asset verification and delivery generation passed (build-final.log).
- Collision geometry: 676 -> 723 pieces; 343,628 -> 353,488 triangles (+2.9%). Final microbenchmark: 0.070 ms per move averaged across five trials, initialization 257 ms. This is a CPU microbenchmark, not a controlled before/after FPS improvement claim.

## Visual review and limits

WebGPU review at High/100% verified upright exterior standing from side and front views. after-west-side.png and after-east-front.png show the final exterior surface/support repair. In-site debug controls provide one-second movement and character side/front/third-person views without OS input. Background browser throttling to approximately 1 FPS prevents reliable real-time smoothness assessment; fixed-step automated tests provide the motion/contact checks. The final HF89 curved-chair front view is saved as after-club-chair-front.png. No foreground focus or desktop input was used.

Coverage is finite: decorative plant leaves are not solid per-leaf obstacles, clothing is not cloth-simulated, and this is not an exhaustive guarantee for every pose at every concavity. No animation clips, material quality, lighting values or normal gameplay UI were reduced. Original slab collision surfaces overlap in the hidden physical union at the join; only the conflicting visible coplanar faces are clipped.


## Follow-up exterior finish correction

The later six-image finish audit extends the initial shell-only repair to the founder walkway, all four exterior corner unions, the entrance apron and an internal bevel groove. It also replaces the affected zero/bleeding baked lighting. The earlier four-face overlap count and initial exterior shading review above describe that earlier stage; see `qa/exterior-finish-ledger.md` for the current geometry and final verification.
