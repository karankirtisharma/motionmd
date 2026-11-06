# Character locomotion provenance

The character geometry, textures, skin and original Idle/Sit actions remain the Microsoft Rocketbox MIT asset documented in this folder. The five new locomotion actions use Adobe Mixamo motion, retargeted to that existing rig; they are not relicensed as MIT source motion.

Adobe's [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html), checked 28 October 2026, permits royalty-free character/animation use in personal, commercial and nonprofit projects, including games and films. This repository uses the retargeted motions as part of MD Lounge. It does not package the raw FBX files or offer a standalone motion library. Obtain source clips through an authorized Adobe account rather than treating these project assets as a general motion download service.

| Website action | Mixamo source selection | Source FBX SHA-256 |
| --- | --- | --- |
| Walk | Walking, X Bot | `efd3c17807a2037afeda5affbb792b5616bfa7a9c1242bc4afceefb0784e60c0` |
| Run | Running — Male Weighted Run, X Bot | `540f795cf7b9b056f4f6af32e58058814a4fa902a6af3a35adc5f5c197e3e417` |
| StairUp | Ascending Stairs, X Bot | `5280ec3962161cf37280833d592886d29927031edff27425461abbb5f8e0aeb6` |
| StairDown | Walking with runtime tread contact adaptation | same as Walking |
| StairRunUp | Running Up Stairs, X Bot | `d88bdad5d0f030d995dca0895bbfb6e765f21c20d0ae4796c98a7bef75b88a1e` |

Running and Running Up Stairs were downloaded on 28 October 2026 as binary FBX, without skin, 30 fps, no keyframe reduction, with root movement retained. Walking and Ascending Stairs reuse the user's previously downloaded source FBXs. Raw files remain outside the website.

## Rejected source and calibration

Both previous Descending Stairs FBXs were rejected: their pelvis descends about 50 cm while the toes/ankles are clamped to the initial floor, generating a deep squat. A fresh Mixamo preview with In Place enabled reproduced that defect. StairDown therefore uses the clean Walking base and the website's measured foot-contact solver; it is not falsely labeled as an authored descending clip.

Retargeting aligns source/destination anatomical reference directions and maps world-space bone rotations. It explicitly preserves pelvis-relative hip anchors because Rocketbox thighs attach to Spine while Mixamo thighs attach to Hips. Linear root travel/rise is removed for the website controller; authored hip compression, bob and weight transfer remain. Left/right touchdown are normalized to cycle phases 0/.5. Original skin binding, node hierarchy and chair calibration remain unchanged.

Reproduction: `node scripts/retarget-locomotion.mjs <original-character.glb> <FBX-directory> <candidate.glb> <metadata-directory>`. The tool refuses to overwrite its input. Use the external original-character checkpoint, not a previously retargeted output. Review the candidate and run `node --test qa/locomotion-asset.test.mjs` after integration. Source raw stride metadata does not alone certify runtime cadence or stair contact quality.

## Candidate v2 isolation and anatomy audit — 29 October 2026

`RocketboxLocomotion.glb` is the opt-in candidate (`?debug=1&motion=candidate`); `RocketboxVisitor.glb` remains the accepted original character. The asset regression explicitly opens the candidate, so restoring the normal preview cannot hide a failed new asset behind old animation tests.

V2 matches the complete flat-foot reference orientation, removes only the constant per-clip head-pitch offset, and keeps clavicle anchors relative to the chest even though this rig parents them to Neck. The original mesh, skin, bind matrices, textures, node definitions, Idle and Sit remain byte-identical. Candidate SHA-256: `6d2123d0eb711945f934e30f9e12f94e01438b8ed5166bc4e304435a8cd0b0b5`. The portable generator reproduces these exact bytes from the original character and the recorded FBXs.

Three asset tests pass: original-data preservation; hip anchors and closed animation loops; head/shoulder reference stability and normalized bone quaternions. Across 120 samples per cycle, pure-clip gaze remains within -6.55 to +6.89 degrees, clavicle-anchor drift is below 0.002 mm, and maximum consecutive head/neck/thigh/calf rotation is 3.51 degrees per 1/120 cycle. Front and side Blender pose sheets show coherent head and limb placement. These checks do not certify runtime contact: the stair clips intentionally contain vertical foot travel, and runtime blending/IK must still pass actual-scene tests before promotion.

Runtime procedural upper-body lean must preserve thigh world transforms because the thighs are children of Spine. Pure asset retarget calibration cannot compensate for subsequent procedural rotations. Raw contact windows stored in the clips are Walk/StairUp/StairDown 0.50 cycle, Run 0.30, and StairRunUp 0.38; source stair cycle travel is about 0.47 m. Cadence and adapted stride must remain compatible with achievable leg reach.
