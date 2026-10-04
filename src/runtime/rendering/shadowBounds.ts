import { Box3, DirectionalLight, Matrix4, Mesh, Object3D, Vector3 } from 'three';

/** Keep every architectural caster, excluding only the separately identified context ground. */
export function architecturalShadowBounds(root: Object3D, fallback: Box3) {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.userData.contextOnly || object.geometry.userData.contextOnly) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every(material => /Neutral architectural ground/i.test(material.name))) {
      object.castShadow = false;
      return;
    }
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return box.isEmpty() ? fallback.clone() : box;
}

/** Static light-space fit. It never follows the viewer, so shadows do not crawl on camera motion. */
export function fitSunShadow(sun: DirectionalLight, bounds: Box3) {
  const view = new Matrix4().lookAt(sun.position, sun.target.position, new Vector3(0, 1, 0)).setPosition(sun.position).invert();
  const lightBounds = new Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    lightBounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(view));
  }
  const camera = sun.shadow.camera;
  camera.left = lightBounds.min.x - 2; camera.right = lightBounds.max.x + 2;
  camera.bottom = lightBounds.min.y - 2; camera.top = lightBounds.max.y + 2;
  camera.near = Math.max(.1, -lightBounds.max.z - 4);
  camera.far = Math.max(camera.near + 1, -lightBounds.min.z + 4);
  camera.updateProjectionMatrix();
  return { width: camera.right - camera.left, height: camera.top - camera.bottom, depth: camera.far - camera.near };
}
