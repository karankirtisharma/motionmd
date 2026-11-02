import { Mesh, Vector3, type Object3D } from 'three';

// Measured F73 planter .001 at (19.9625, 0, -11.9375). Move the complete
// pot, soil, trunk and canopy beside the hall rock, away from the door axis.
// Translate source vertices before spatial partitioning and shadow caching;
// preserve UVs, normals, materials, scale and the original floor contact.
export const DOORWAY_PLANTER_OFFSET = [-1.65, 0, -.5] as const;
const sourceMaterials = new Set([
  'studio__F73 | dry potting soil',
  'studio__F73 | honed charcoal planter basalt',
  'studio__potted_plant_01_leaves',
  'studio__potted_plant_01_pot',
]);

export function relocateDoorwayPlanter(root: Object3D) {
  root.updateMatrixWorld(true);
  const point = new Vector3(), offset = new Vector3(...DOORWAY_PLANTER_OFFSET);
  let changed = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.geometry.userData.mdDoorwayPlanterMoved) return;
    const collider = ['F73 | cast stone planter with inner rim.001', 'F73 | planter soil.001'].includes(object.userData.sourceName);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!collider && !materials.some(material => sourceMaterials.has(material.name))) return;
    const positions = object.geometry.getAttribute('position');
    const inverse = object.matrixWorld.clone().invert();
    let count = 0;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      // Isolated source assembly: neighbouring plantings are outside this box.
      if (point.x < 18.8 || point.x > 21.2 || point.z < -13.2 || point.z > -10.7 || point.y < -.01 || point.y > 3.3) continue;
      point.add(offset).applyMatrix4(inverse);
      positions.setXYZ(i, point.x, point.y, point.z); count++;
    }
    if (!count) return;
    positions.needsUpdate = true;
    object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
    object.geometry.userData.mdDoorwayPlanterMoved = true;
    changed += count;
  });
  return changed;
}

