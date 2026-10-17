import { Frustum, HalfFloatType, Matrix4, Mesh, Object3D, PerspectiveCamera, Plane, RenderTarget, Scene, Vector2, Vector3, Vector4, WebGLCoordinateSystem } from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { screenUV, texture } from 'three/tsl';

/** Reflect the camera and clip at the real mirror plane, including reversed depth.
 * The stock r186 ReflectorNode oblique projection assumes forward depth. Keep
 * the existing scene's reversed-depth precision by deriving the row from P^-1.
 */
export function mirrorCamera(source: PerspectiveCamera, camera: PerspectiveCamera, point: Vector3, normal: Vector3) {
  source.updateMatrixWorld();
  camera.copy(source, false);
  const position = source.getWorldPosition(new Vector3());
  const direction = source.getWorldDirection(new Vector3());
  camera.position.copy(position).addScaledVector(normal, -2 * position.clone().sub(point).dot(normal));
  camera.up.copy(source.up).transformDirection(source.matrixWorld).reflect(normal);
  camera.lookAt(camera.position.clone().add(direction.reflect(normal)));
  camera.updateMatrixWorld();
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(camera.matrixWorldInverse);
  const clip = new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const reversed = source.reversedDepth;
  const glForward = source.coordinateSystem === WebGLCoordinateSystem && !reversed;
  const farCorner = new Vector4(Math.sign(clip.x) || 1, Math.sign(clip.y) || 1, reversed ? 0 : 1, 1)
    .applyMatrix4(source.projectionMatrixInverse);
  clip.multiplyScalar((glForward ? 2 : 1) / clip.dot(farCorner));
  const p = camera.projectionMatrix.elements;
  for (let column = 0; column < 4; column++) {
    const c = clip.getComponent(column), w = p[column * 4 + 3];
    p[column * 4 + 2] = reversed ? w - c : glForward ? c - w : c;
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  // Camera.copy does not copy this renderer-owned flag in r186. If omitted,
  // renderer.render updates the projection and discards our clipping plane.
  (camera as PerspectiveCamera & { _reversedDepth: boolean })._reversedDepth = reversed;
  return camera;
}

export function createGalleryMirror(root: Object3D) {
  const panes: Mesh[] = [];
  root.traverse(object => { if (object instanceof Mesh && object.userData.mdPlanarMirror === true) panes.push(object); });
  if (!panes.length) return undefined;
  if (panes.length !== 1) throw new Error('The continuous gallery mirror must export as one plane.');
  const pane = panes[0];
  pane.geometry.computeBoundingBox();
  const localPoint = pane.geometry.boundingBox!.getCenter(new Vector3());
  const localNormal = new Vector3().fromBufferAttribute(pane.geometry.getAttribute('normal'), 0).normalize();
  const target = new RenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const material = new MeshBasicNodeMaterial({ name: 'V21 | live silver mirror' });
  material.colorNode = texture(target.texture, screenUV.flipX()).rgb.mul(0.94);
  pane.material = material;
  pane.castShadow = false; pane.receiveShadow = false; pane.userData.castShadow = false;
  const camera = new PerspectiveCamera(), frustum = new Frustum(), matrix = new Matrix4(), size = new Vector2();
  const point = new Vector3(), normal = new Vector3(), eye = new Vector3();
  return {
    update(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera) {
      if (!pane.visible || !material.visible) return;
      scene.updateMatrixWorld(); view.updateMatrixWorld();
      point.copy(localPoint).applyMatrix4(pane.matrixWorld);
      normal.copy(localNormal).transformDirection(pane.matrixWorld);
      eye.setFromMatrixPosition(view.matrixWorld);
      if (eye.sub(point).dot(normal) <= 0.01) return;
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), view.coordinateSystem, view.reversedDepth);
      if (!frustum.intersectsObject(pane)) return;
      renderer.getDrawingBufferSize(size);
      const scale = Math.min(0.85, 1536 / Math.max(size.x, size.y));
      const width = Math.max(1, Math.round(size.x * scale)), height = Math.max(1, Math.round(size.y * scale));
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      mirrorCamera(view, camera, point, normal);
      const oldTarget = renderer.getRenderTarget(), oldMRT = renderer.getMRT(), oldClear = renderer.autoClear;
      // No recursive reflection, and no velocity writes into the reflection pass.
      pane.visible = false;
      try {
        renderer.setMRT(null); renderer.setRenderTarget(target); renderer.autoClear = true;
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setMRT(oldMRT); renderer.autoClear = oldClear; pane.visible = true;
      }
    },
    dispose() { target.dispose(); },
  };
}
