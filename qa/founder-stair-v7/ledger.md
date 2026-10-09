# Founder stair — v7

## Contract
Add a short, intentional exterior route from the presentation room to the founder floor. Preserve the four chairs, screen, interior layout, source textures and all structural columns/beams. Work on new Blender copies. No commits or pushes.

## Evidence and design
Source: v6 repaired editable scene and matching prepared scene. Lower floor 0 m; upper finished floor 4.23 m. Lower front glazing at Blender Y=2.4 m; upper front glazing at Y=0. Existing outer columns at X=9.49–9.79 and 15.26–15.56 leave a clear bay.

Return stair: 26 risers in two flights, 1.60 m tread width, 0.32 m going, 0.16135 m nominal rise from a 0.035 m forecourt. Lower flight at X=10.8; upper flight at X=13.246875. Turning landing 1.60 m deep. Limestone, satin bronze and clear glass guards. Model real openings with open door leaves and transoms. All dimensions are virtual-scene design, not construction certification.

## Scope / preservation
Replace only Side curtain wall pane.028, .029, .042 and mullion.029. Preserve source identity of every other object. Existing compressed web chunks will receive triangle-only aperture edits; UV, normals, textures and remaining vertex positions must remain intact. New geometry gets a separate GLB and simple physical colliders.

## Budgets and gates
Target added render geometry below 50,000 triangles, material-grouped meshes, no new realtime lights. Reuse existing source stone/bronze textures. Measure actual added download and collision cost. No claim of unchanged FPS until measured.

Required checks: source backup hashes; source openings and structural clearances; stair dimensions; actual-asset walking/sprinting up/down; guard blocking; existing collision regressions; rendered exterior and interior views; browser route and console; build and asset closure. GI/probe changes must be justified by visible changes rather than a global lighting rewrite.

## Status
Complete: backed-up source; owned exterior architecture; real glazing openings in source, prepared and delivered geometry; material-grouped GLB; welded convex physics; source limestone/bronze reconstruction; dedicated indirect bake; adjacent reflection captures; Blender stills; WebGPU and WebGL inspection; keyboard traversal; 36 tests; TypeScript/build/asset validation. Source preservation and measured delivery reports are alongside this ledger. No commit or push.
