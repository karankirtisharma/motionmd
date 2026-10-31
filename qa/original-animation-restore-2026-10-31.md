# Original character animation restoration - 31 October 2026

The user explicitly asked for the oldest original movement, removing newer animation corrections. This takes precedence over the previous per-tread leg-solver goal. It does not establish that stair contact is solved.

## Provenance and implementation

The first available Rocketbox revision is `5ba39fd` (11 October 2026). Its Idle/Walk/Run/Sit source asset was never changed in the available Git history. `public/assets/character/RocketboxVisitor.glb` is 21,088,756 bytes, SHA-256 `b96d4cb29605b18b13df690c7a261637df8e3deeeb7c0732862c64bc785ff997`. This hash is identical in protected FINAL, active BACKUP and the Claude FINAL copy.

Restore the original distance-based shared Walk/Run phase (+0.05 source run alignment), speed blends and restrained torso lean. The compatibility base is `bb23118`, whose ordinary motion retains those original formulas, later accepted chair/palm/finger contacts, the 1.86 m calibrated character size and pose restoration needed to prevent accumulated procedural changes. Do not replace the whole file with October 11: that would remove the accepted chair sequence and shrink the character to 1.76 m.

Remove the later locomotion knee/ankle solver, per-tread shoe posing and avatar-specific stair gait rewrite. Chair-only limb IK remains. Retain the existing bounded 0-4 cm whole-model sole correction for ordinary floor contact and the controller's controlled stair movement speed. No rig, animation clip, texture or scene asset was edited.

Add `resetMotion()` to clear inherited speed, gait phase and turn lean on spawn/re-entry. The controller calls it, then samples `update(0, 0, 0)` after setting the root position and rotation and before revealing the character. This prevents the first visible frame inheriting an old running or seated pose. No ordinary animation frame is rewritten.

## Verification

`node --test qa/simple-locomotion.test.mjs qa/spawn-locomotion.test.mjs qa/avatar.test.mjs qa/stair-controller.test.mjs`: **17 passed, zero failed**. Terrain inputs produce identical local bone positions and quaternion components across walking, sprinting, idle and sitting; the avatar does not invoke terrain callbacks. Existing hand/finger/chair assertions pass.

The new spawn test samples all 361 actual shoe vertices over 120 idle frames, four scene elevations and both fresh and physically settled capsule heights. Minimum shoe gap is 1 mm after the existing 9 mm physical settlement; maximum is 10 mm before settlement. Re-entry after a sprint/turn/seated sequence exactly matches a fresh idle pose, with idle weight 1 and zero run, sit, speed and lean.

An additional real-controller regression in `qa/controller-camera.test.mjs` captures the exact `root.visible = true` transition for both fresh entry and re-entry after 150 controller-driven sprint frames. Before any next frame, all bone transforms equal fresh idle, weights/speed/phase/lean are reset, the root has the new floor/facing, and all 361 shoe vertices clear the floor by approximately 10 mm. The existing independent stair-reference fixture now resets its reference avatar on the same lifecycle event; no pose-parity assertion was removed. Targeted command `node --test --test-name-pattern='controller samples clean idle|stair support smoothing' qa/controller-camera.test.mjs`: **2 passed**, including 60/144 Hz ascent/descent. A direct diff against `bb23118` confirms the only runtime additions are `resetMotion()` and reuse of a scratch quaternion; all ordinary gait formulas are identical.

The 12 actual-controller route cases retain progress and body support, but recorded shoe penetration is **7.5-18.8 cm**. The unchanged independent `node qa/stair-contact-audit.mjs` intentionally still fails: the first spiral walking case measures **20.81 cm** maximum shoe/tread intersection. Do not call the general test suite a strict stair-contact pass. The restored flat-ground source gait lacks bespoke stair motion.

## Rejected alternative

A minimal whole-body vertical clearance experiment preserved all source bone rotations and cleared all 12 strict routes. It was rejected rather than shipped: 7 cm anticipation plus retained upward offset floated both shoes as much as 7-15 cm in walking samples, while exact-surface support removed most floating but produced 14-17.5 cm body-height changes between adjacent tread-crossing samples. That would replace leg distortion with whole-body popping. The experimental support code is not in the final runtime.

External evidence and before-source snapshots are in `C:\Users\karan_z7alww2\.codex\visualizations\2026\10\17\01a14a42-20bc-7ca3-a5e8-1779e078f8e0\original-motion-restore-2026-10-31`: `tests-original-motion.txt`, `strict-original-contact.txt`, `body-gap-results.txt`, and `body-gap-exact-results.txt`. Browser visual verification and the integrated build belong to the overall studio-integration review; the numerical tests above are not a claim of visual approval or deployment readiness.
