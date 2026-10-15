import { BufferAttribute, Matrix3, Mesh, Vector3 } from 'three';

/** World-projected brushed metal has no usable UV0 derivative frame.
 * Supply its physical brush direction instead of normalizing a zero UV tangent.
 */
export function installBrushTangents(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false);
  const normals = mesh.geometry.getAttribute('normal');
  if (!normals) return;
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const inverseLinear = new Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
  const normal = new Vector3(), tangent = new Vector3(), axis = new Vector3();
  const values = new Float32Array(normals.count * 4);
  for (let i = 0; i < normals.count; i++) {
    normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    // Vertical brushing on upright panels; horizontal faces use the X axis.
    axis.set(Math.abs(normal.y) > 0.95 ? 1 : 0, Math.abs(normal.y) > 0.95 ? 0 : 1, 0);
    tangent.copy(axis).addScaledVector(normal, -axis.dot(normal)).normalize();
    tangent.applyMatrix3(inverseLinear).normalize();
    tangent.toArray(values, i * 4);
    values[i * 4 + 3] = 1;
  }
  mesh.geometry.setAttribute('tangent', new BufferAttribute(values, 4));
}
