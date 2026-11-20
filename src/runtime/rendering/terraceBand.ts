import { Mesh, Vector3, type Object3D } from 'three';

/** The front-wing limestone band (x 3.21–3.78) and the lounge roof slab both finish
 * at y = 4.200 beside the founder partition, so the two faces z-fight and the strip
 * flickers as the camera moves. Sink the band's top 5 mm under the roof finish.
 * Run AFTER the exterior lighting receivers are split: their signatures hash the
 * source positions. */
export function separateTerraceBand(root: Object3D) {
  root.updateMatrixWorld(true);
  const p = new Vector3();
  let vertices = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.userData.exteriorLightingReceiver || object.geometry.userData.mdTerraceBandSeparated) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(m => m.name === 'shell__EH54 | scanned cream limestone panels')) return;
    const positions = object.geometry.getAttribute('position'), inverse = object.matrixWorld.clone().invert();
    let changed = 0;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      if (p.x < 3.210 || p.x > 3.780 || p.z < -11.063 || p.z > -2.136 || p.y < 3.8999 || p.y > 4.2001) continue;
      p.y = 3.9 + (p.y - 3.9) * (0.295 / 0.3); // 4.200 -> 4.195, bevels keep their proportion
      p.applyMatrix4(inverse); positions.setXYZ(i, p.x, p.y, p.z); changed++;
    }
    if (changed) {
      positions.needsUpdate = true; object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
      object.geometry.userData.mdTerraceBandSeparated = true; vertices += changed;
    }
  });
  console.info('[MD terrace band]', { vertices });
  return vertices;
}
