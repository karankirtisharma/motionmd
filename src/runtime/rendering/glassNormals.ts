import { BufferAttribute, Mesh, Vector3 } from 'three';

const GLASS = /(?:^|__)Low iron glass \| 12 mm$/;
const CREASE_DOT = Math.cos(Math.PI / 12);

/** Separate thin-glass face fans before smoothing; front/back and edge normals
 * must not average together. Source positions, UVs, triangle order and IOR stay intact. */
export function repairGlassNormals(mesh: Mesh) {
  if (mesh.geometry.userData.mdGlassNormalsRepaired || Array.isArray(mesh.material) || !GLASS.test(mesh.material.name)) return 0;
  const source = mesh.geometry, p = source.getAttribute('position'), normals = source.getAttribute('normal'), index = source.index;
  if (!p || !normals || !index || index.count === 0) return 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), face = new Vector3(), value = new Vector3();
  let malformed = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    face.subVectors(b, a).cross(value.subVectors(c, a));
    if (face.lengthSq() < .0016) continue; // Inspect broad faces (> 0.02 m²), not intentional edge bevels.
    face.normalize();
    if ([0, 1, 2].some(v => value.fromBufferAttribute(normals, index.getX(i + v)).normalize().dot(face) < CREASE_DOT)) malformed++;
  }
  if (!malformed) return 0;

  const result = source.toNonIndexed(), position = result.getAttribute('position');
  const faces: Vector3[] = [], buckets = new Map<string, number[]>();
  const keys: string[] = [];
  // Ten-micron weld tolerance keeps 12 mm front/back surfaces and fine bevels separate.
  for (let i = 0; i < position.count; i++) {
    value.fromBufferAttribute(position, i);
    const key = `${Math.round(value.x * 1e5)},${Math.round(value.y * 1e5)},${Math.round(value.z * 1e5)}`;
    keys.push(key); const group = buckets.get(key) ?? []; group.push(Math.floor(i / 3)); buckets.set(key, group);
  }
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    faces.push(new Vector3().subVectors(b, a).cross(value.subVectors(c, a)).normalize());
  }
  const repaired = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const normal = faces[Math.floor(i / 3)];
    value.fromBufferAttribute(result.getAttribute('normal'), i).normalize();
    // Keep source hard-face normals exactly: averaging a shallow cut/bevel into
    // an already correct flat pane would introduce a new reflected seam.
    if (value.dot(normal) > 0.999999) { value.toArray(repaired, i * 3); continue; }
    value.set(0, 0, 0);
    for (const adjacent of buckets.get(keys[i])!) if (faces[adjacent].dot(normal) >= CREASE_DOT) value.add(faces[adjacent]);
    if (value.lengthSq() < 1e-12) value.copy(normal);
    value.normalize().toArray(repaired, i * 3);
  }
  result.setAttribute('normal', new BufferAttribute(repaired, 3));
  result.userData = { ...source.userData, mdGlassNormalsRepaired: true, mdMalformedGlassFaces: malformed };
  mesh.geometry = result;
  source.dispose(); // Initialization repair, before any GPU upload.
  return malformed;
}
