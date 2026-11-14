import { prepareRenderSlices } from './prepareRenderSlices.ts';
import { Box3, type DirectionalLight, Frustum, HalfFloatType, Matrix4, Mesh, Object3D, PerspectiveCamera, Plane, RenderTarget, Scene, Vector2, Vector3, Vector4, WebGLCoordinateSystem } from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { screenUV, texture, uniform } from 'three/tsl';

import { reflectionCrop, cropReflectionCamera } from './reflectionCrop.ts';
import { ReflectionFrameCache } from './reflectionFrameCache.ts';
import { warmOpeningTourShaders } from './openingTourWarmup.ts';

/** Reflect the camera and clip at the real mirror plane, including reversed depth.
 * The stock r186 ReflectorNode oblique projection assumes forward depth. Keep
 * the existing scene's reversed-depth precision by deriving the row from P^-1.
 */
export function createMirrorCameraUpdater() {
  // A visible mirror is updated every animated frame. Keep scratch vectors per
  // updater rather than allocating camera/plane temporaries on each submission.
  const position = new Vector3(), direction = new Vector3(), relative = new Vector3();
  const lookTarget = new Vector3(), plane = new Plane(), clip = new Vector4(), farCorner = new Vector4();
  return (source: PerspectiveCamera, camera: PerspectiveCamera, point: Vector3, normal: Vector3) => {
    source.updateMatrixWorld();
    camera.copy(source, false);
    source.getWorldPosition(position); source.getWorldDirection(direction);
    camera.position.copy(position).addScaledVector(normal, -2 * relative.copy(position).sub(point).dot(normal));
    camera.up.copy(source.up).transformDirection(source.matrixWorld).reflect(normal);
    camera.lookAt(lookTarget.copy(camera.position).add(direction.reflect(normal)));
    camera.updateMatrixWorld();
    plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(camera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const reversed = source.reversedDepth;
    const glForward = source.coordinateSystem === WebGLCoordinateSystem && !reversed;
    farCorner.set(Math.sign(clip.x) || 1, Math.sign(clip.y) || 1, reversed ? 0 : 1, 1)
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
  };
}
export const mirrorCamera = createMirrorCameraUpdater();

type ReflectedVisitor = { root: Object3D; sun: DirectionalLight };

function drawPreparedReflection(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera,
  targets: readonly Mesh[], { root, sun }: ReflectedVisitor) {
  const draws = new Set<Object3D>(targets);
  root.traverse(object => { if ('isSkinnedMesh' in object) draws.add(object); });
  const oldVisible = root.visible, oldFilter = renderer.getRenderObjectFunction(), oldClear = renderer.autoClear;
  try {
    root.visible = true;
    renderer.autoClear = true;
    sun.shadow.needsUpdate = true;
    // Drivers can defer work until an actual draw. Submit only the measured
    // materials and visitor in the real mirror and nested shadow contexts.
    renderer.setRenderObjectFunction((...args) => {
      if (!draws.has(args[0])) return;
      if (oldFilter) oldFilter.call(renderer, ...args); else renderer.renderObject(...args);
    });
    renderer.render(scene, camera);
  } finally {
    root.visible = oldVisible;
    renderer.setRenderObjectFunction(oldFilter);
    renderer.autoClear = oldClear;
    sun.shadow.needsUpdate = true;
  }
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
  target.texture.name = 'Gallery mirror reflection';
  const material = new MeshBasicNodeMaterial({ name: 'V21 | live silver mirror' });
  const crop = new Vector4(0, 0, 1, 1), cropNode = uniform(crop);
  material.colorNode = texture(target.texture, screenUV.flipX().sub(cropNode.xy).div(cropNode.zw)).rgb.mul(0.94);
  for (const surface of panes) {
    surface.material = material;
    surface.castShadow = false; surface.receiveShadow = false; surface.userData.castShadow = false;
  }
  const camera = new PerspectiveCamera(), frustum = new Frustum(), matrix = new Matrix4(), size = new Vector2();
  const fullSize = new Vector2(), targetSize = new Vector2();
  const point = new Vector3(), normal = new Vector3(), eye = new Vector3(), paneBounds = new Box3();
  const frameCache = new ReflectionFrameCache();
  const updateCamera = createMirrorCameraUpdater();
  const visibility = panes.map(() => true);
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
      // Its bounding sphere extends far past this thin rectangle. On the
      // upper stairs that sphere enters the frustum before any mirror pixel.
      return surface.pane.visible && eye.sub(point).dot(normal) > 0.01 &&
        frustum.intersectsBox(paneBounds.copy(surface.pane.geometry.boundingBox!).applyMatrix4(surface.pane.matrixWorld));
    });
    if (!active) return false;
    renderer.getDrawingBufferSize(size);
    const scale = Math.min(0.85, 1536 / Math.max(size.x, size.y));
    fullSize.set(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)));
    reflectionCrop(active.pane.geometry.boundingBox!, active.pane.matrixWorld, view, fullSize, targetSize.set(target.width, target.height), crop);
    const width = Math.round(fullSize.x * crop.z), height = Math.round(fullSize.y * crop.w);
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    updateCamera(view, camera, point, normal);
    cropReflectionCamera(camera, crop);
    return true;
  }
  return {
    async warmup(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera, signal?: AbortSignal,
      onProgress?: (loaded: number, total: number) => void, visitor?: ReflectedVisitor) {
      signal?.throwIfAborted();
      if (!prepareReflection(renderer, view)) {
        // The opening camera may not yet see the mirror. Compilation needs its
        // real camera/light cache and framebuffer format, not a visible image.
        // The preparatory draw never marks the reflection cache valid.
        const surface = surfaces[0];
        surface.pane.updateWorldMatrix(true, false);
        point.copy(surface.point).applyMatrix4(surface.pane.matrixWorld);
        normal.copy(surface.normal).transformDirection(surface.pane.matrixWorld);
        updateCamera(view, camera, point, normal);
      }
      const oldTarget = renderer.getRenderTarget(), oldMRT = renderer.getMRT();
      panes.forEach((surface, i) => { visibility[i] = surface.visible; surface.visible = false; });
      try {
        renderer.setMRT(null); renderer.setRenderTarget(target);
        return await warmOpeningTourShaders(renderer, scene, camera, signal, onProgress,
          visitor ? targets => drawPreparedReflection(renderer, scene, camera, targets, visitor) : undefined);
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setMRT(oldMRT);
        panes.forEach((surface, i) => { surface.visible = visibility[i]; });
      }
    },
    async prepareFirstFrame(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera,
      signal?: AbortSignal) {
      if (!prepareReflection(renderer, view)) return;
      await prepareRenderSlices(renderer, scene, async () => {
        frameCache.invalidate();
        this.update(renderer, scene, view);
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
      }, signal);
      frameCache.invalidate();
    },
    update(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera, revision?: number) {
      if (!prepareReflection(renderer, view)) { frameCache.invalidate(); return; }
      if (frameCache.matches(scene, revision, camera.matrixWorld, camera.projectionMatrix, crop, target.width, target.height)) return;
      const oldTarget = renderer.getRenderTarget(), oldMRT = renderer.getMRT(), oldClear = renderer.autoClear;
      // No recursive reflection, and no velocity writes into the reflection pass.
      panes.forEach((surface, i) => { visibility[i] = surface.visible; surface.visible = false; });
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
