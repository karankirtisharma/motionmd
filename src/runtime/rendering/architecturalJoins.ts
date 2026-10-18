import { Mesh, Vector3, type Object3D } from 'three';

/** Repair measured founder floor gaps and the coplanar canopy fascia.
 * Keep source topology, world-projected stone, lighting UVs and finished levels.
 */
export function repairArchitecturalJoins(root: Object3D) {
  root.updateMatrixWorld(true);
  const p = new Vector3();
  let vertices = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.geometry.userData.mdFloorJoinRepaired) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // Front wing horizontal band.001 shares its y=3.88 underside with the
    // canopy slab over a 386 mm strip. Recess its underside into the slab,
    // keeping the y=4.20 structural top. Do not offset the limestone shader.
    if (materials.some(m => m.name === 'shell__EH54 | scanned cream limestone panels')) {
      const positions = object.geometry.getAttribute('position');
      const inverse = object.matrixWorld.clone().invert();
      let changed = 0;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        if (p.x < 3.210 || p.x > 3.780 || p.z < -11.063 || p.z > -2.136 || p.y < 3.8799 || p.y > 4.2001) continue;
        p.y = 3.9 + (p.y - 3.88) * (.3 / .32);
        p.applyMatrix4(inverse); positions.setXYZ(i, p.x, p.y, p.z); changed++;
      }
      if (changed) {
        positions.needsUpdate = true; object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
        object.geometry.userData.mdFloorJoinRepaired = true; vertices += changed;
      }
      return;
    }
    if (!materials.some(m => m.name === 'founder__FR82 | polished ivory large format stone') && object.userData.sourceName !== 'Founder polished floor') return;
    const positions = object.geometry.getAttribute('position');
    const inverse = object.matrixWorld.clone().invert();
    let changed = 0;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      if (p.y < 4.199 || p.y > 4.231 || p.x < 3.643 || p.x > 13.007) continue;
      let touched = false;
      if (Math.abs(p.z + 2.44375) < .0001) { p.z = -2.397; touched = true; }
      // The gallery finish ends at x=3.615; the rear room begins at 13.01.
      // The original room floor was inset from both, exposing the slab below.
      if (Math.abs(p.x - 3.64375) < .0001) { p.x = 3.615; touched = true; }
      if (Math.abs(p.x - 13.00625) < .0001) { p.x = 13.01; touched = true; }
      if (touched) {
        p.applyMatrix4(inverse);
        positions.setXYZ(i, p.x, p.y, p.z);
        changed++;
      }
    }
    if (changed) {
      positions.needsUpdate = true;
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      object.geometry.userData.mdFloorJoinRepaired = true;
      vertices += changed;
    }
  });
  return vertices;
}
