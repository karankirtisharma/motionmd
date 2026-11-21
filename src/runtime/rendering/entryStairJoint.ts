import { Matrix3, Mesh, Vector3, type Object3D } from 'three';

// The front entry stair's top block (shell) ends at x = -5.800 with a rounded 9 mm edge, against the entrance terrace,
// whose sharp west face stands at the same x and whose top is at the same -0.010. Along the 4.2 m of the joint that
// edge left a 9 mm notch: a dark line between two slabs at one level, with the block's end face and the terrace's
// side face coplanar inside it, flickering as the camera moved. Measured on the shell and entrance chunks.
const STONE = 'shell__EH54 | scanned cream limestone panels';
const TOP = -.01, EDGE = [-5.8095, -5.7995], DROP = [-.0195, -.0095], ALONG = [-19.1915, -15.0085];

/** Raise that edge to the common top (normals up), so block and terrace meet flush. The block's two outer corners,
 * which face the sand, keep their rounded edge. Visible geometry only; idempotent. Returns vertices moved. */
export function closeEntryStairJoint(root: Object3D) {
  root.updateMatrixWorld(true);
  const p = new Vector3(), n = new Vector3();
  let moved = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.geometry.userData.mdEntryStairJoint) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(m => m.name === STONE)) return;
    const positions = object.geometry.getAttribute('position'), normals = object.geometry.getAttribute('normal');
    const inverse = object.matrixWorld.clone().invert(), up = n.set(0, 1, 0).applyMatrix3(new Matrix3().getNormalMatrix(inverse)).normalize().clone();
    let changed = 0;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      if (p.x < EDGE[0] || p.x > EDGE[1] || p.y < DROP[0] || p.y > DROP[1] || p.z < ALONG[0] || p.z > ALONG[1]) continue;
      p.y = TOP; p.applyMatrix4(inverse); positions.setXYZ(i, p.x, p.y, p.z);
      normals?.setXYZ(i, up.x, up.y, up.z);
      changed++;
    }
    if (!changed) return;
    positions.needsUpdate = true; if (normals) normals.needsUpdate = true;
    object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
    object.geometry.userData.mdEntryStairJoint = true; moved += changed;
  });
  return moved;
}
