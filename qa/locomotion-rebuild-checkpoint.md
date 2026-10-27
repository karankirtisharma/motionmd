# Recovery checkpoint before locomotion rebuild — 28 October 2026

This checkpoint retains the current website, collision/architecture repairs, exterior illumination atlas and initial guard-glass/stair corrections. It is a recovery point, not acceptance of the remaining visual defects.

The current locomotion clearance layer can leave stance feet floating over lower treads because it only raises feet to avoid penetration. Full-scene traversal tests now prevent stair solids being misclassified as approaching walls, but traversal and penetration checks do not certify realistic foot contact. The next revision will replace locomotion with authored motion and phase-aware stance/swing placement. Existing working chair contact is kept as a separate regression.

The studio guard has closed source glass surfaces; the user still reports a missing/weak central reflection beside the perpendicular return. That appearance complaint remains open. Source normals and probe candidate bounds were corrected without changing tint/opacity to disguise the mismatch.

Validation at checkpoint: 121 integrated tests pass; final separate glass tests and the full-scene 12-route stair controller regression pass; TypeScript passes. Production build passed before the last normal-preservation refinement. Further live visual review remains required. Original FINAL folder and source Blender/GLB remain unchanged.
