import { Box3, Frustum, HalfFloatType, Matrix4, Mesh, Object3D, PerspectiveCamera, Plane, RenderTarget, Scene, Vector2, Vector3, Vector4, WebGLCoordinateSystem } from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { screenUV, texture, uniform } from 'three/tsl';

import { reflectionCrop, cropReflectionCamera } from './reflectionCrop.ts';
import { ReflectionFrameCache } from './reflectionFrameCache.ts';

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
  // The export only silvered the gallery side. The founder-room side exposed
  // the opaque bronze backing. Reuse the actual face, edge and reveals around
  // the backing's centre to finish that side without changing its solid wall.
  root.updateWorldMatrix(true, true);
  const assembly = pane.parent!;
  const backing = assembly.children.find(o => o.userData.sourceName === 'V21 | Mirror structural backing');
  const added: Object3D[] = [];
  if (backing) {
    const centre = new Box3().setFromObject(backing).getCenter(new Vector3());
    const turn = new Matrix4().makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new Matrix4().makeRotationY(Math.PI))
      .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    const inverse = assembly.matrixWorld.clone().invert();
    for (const original of [...assembly.children]) {
      if (original === backing || !(original instanceof Mesh)) continue;
      const reverse = original.clone();
      reverse.name += ' | founder side';
      reverse.userData = { ...original.userData, mirrorSide: 'founder' };
      inverse.clone().multiply(turn).multiply(original.matrixWorld)
        .decompose(reverse.position, reverse.quaternion, reverse.scale);
      assembly.add(reverse); added.push(reverse);
      if (original === pane) panes.push(reverse);
    }
    assembly.updateWorldMatrix(true, true);
  }
  const surfaces = panes.map(surface => {
    surface.geometry.computeBoundingBox();
    return { pane: surface,
      point: surface.geometry.boundingBox!.getCenter(new Vector3()),
      normal: new Vector3().fromBufferAttribute(surface.geometry.getAttribute('normal'), 0).normalize() };
  });
  const target = new RenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const material = new MeshBasicNodeMaterial({ name: 'V21 | live silver mirror' });
  const crop = new Vector4(0, 0, 1, 1), cropNode = uniform(crop);
  material.colorNode = texture(target.texture, screenUV.flipX().sub(cropNode.xy).div(cropNode.zw)).rgb.mul(0.94);
  for (const surface of panes) {
    surface.material = material;
    surface.castShadow = false; surface.receiveShadow = false; surface.userData.castShadow = false;
  }
  const camera = new PerspectiveCamera(), frustum = new Frustum(), matrix = new Matrix4(), size = new Vector2();
  const fullSize = new Vector2(), targetSize = new Vector2();
  const point = new Vector3(), normal = new Vector3(), eye = new Vector3();
  const frameCache = new ReflectionFrameCache();
  function prepareReflection(renderer: WebGPURenderer, view: PerspectiveCamera) {
    if (!material.visible) return false;
    // Only mirror ancestry is needed before deciding whether to render a reflection.
    for (const surface of surfaces) surface.pane.updateWorldMatrix(true, false);
    view.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), view.coordinateSystem, view.reversedDepth);
    // Opposite faces cannot both face the viewer; share one bounded target
    // and render only the visible side, at the physical surface of that side.
    const active = surfaces.find(surface => {
      point.copy(surface.point).applyMatrix4(surface.pane.matrixWorld);
      normal.copy(surface.normal).transformDirection(surface.pane.matrixWorld);
      eye.setFromMatrixPosition(view.matrixWorld);
      return surface.pane.visible && eye.sub(point).dot(normal) > 0.01 && frustum.intersectsObject(surface.pane);
    });
    if (!active) return false;
    renderer.getDrawingBufferSize(size);
    const scale = Math.min(0.85, 1536 / Math.max(size.x, size.y));
    fullSize.set(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)));
    reflectionCrop(active.pane.geometry.boundingBox!, active.pane.matrixWorld, view, fullSize, targetSize.set(target.width, target.height), crop);
    const width = Math.round(fullSize.x * crop.z), height = Math.round(fullSize.y * crop.w);
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    mirrorCamera(view, camera, point, normal);
    cropReflectionCamera(camera, crop);
    return true;
  }
  return {
    update(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera, revision?: number) {
      if (!prepareReflection(renderer, view)) { frameCache.invalidate(); return; }
      if (frameCache.matches(scene, revision, camera.matrixWorld, camera.projectionMatrix, crop, target.width, target.height)) return;
      const oldTarget = renderer.getRenderTarget(), oldMRT = renderer.getMRT(), oldClear = renderer.autoClear;
      // No recursive reflection, and no velocity writes into the reflection pass.
      const visibility = panes.map(surface => surface.visible);
      panes.forEach(surface => { surface.visible = false; });
      try {
        renderer.setMRT(null); renderer.setRenderTarget(target); renderer.autoClear = true;
        renderer.render(scene, camera);
        frameCache.record(scene, revision, camera.matrixWorld, camera.projectionMatrix, crop, target.width, target.height);
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setMRT(oldMRT); renderer.autoClear = oldClear;
        panes.forEach((surface, i) => { surface.visible = visibility[i]; });
      }
    },
    dispose() { target.dispose(); material.dispose(); added.forEach(object => object.removeFromParent()); },
  };
}
