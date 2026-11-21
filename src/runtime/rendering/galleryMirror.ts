import { prepareRenderSlices } from './prepareRenderSlices.ts';
import { REFLECTION_ONLY_LAYER } from '../interaction/movement.ts';
import { Box3, type DirectionalLight, Frustum, HalfFloatType, Matrix4, Mesh, Object3D, PerspectiveCamera, Plane, RenderTarget, Scene, Vector2, Vector3, Vector4, WebGLCoordinateSystem } from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { mrt, output, screenUV, texture, uniform, vec4 } from 'three/tsl';

import { reflectionCrop, reflectionSpan, cropReflectionCamera } from './reflectionCrop.ts';
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
    camera.layers.enable(REFLECTION_ONLY_LAYER);   // the visitor's head, hidden from his own first-person camera
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

async function drawPreparedReflection(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera,
  targets: readonly Mesh[], { root, sun }: ReflectedVisitor, signal?: AbortSignal) {
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
    await prepareRenderSlices(renderer, scene, async () => {
      sun.shadow.needsUpdate = true;
      renderer.render(scene, camera);
    }, signal);
  } finally {
    root.visible = oldVisible;
    renderer.setRenderObjectFunction(oldFilter);
    renderer.autoClear = oldClear;
    sun.shadow.needsUpdate = true;
  }
}

const MINIMUM_PANE_PIXELS = 12;
// A reflection is a second drawing of the building. Up close to the pane that was 215
// draws and 5.6 million triangles, most of them leaves, keycaps and stitching in rooms
// 15-30 m behind the viewer. Like a game mirror, the reflection keeps everything near
// the pane and every broad surface (walls, floors, glass, furniture bodies) at any
// distance, and leaves out only finely tessellated detail that starts further than
// this from the pane, where it is a few pixels inside an already distant image.
const DETAIL_REACH = 12, DETAIL_TRIANGLE = 0.002, DETAIL_SAMPLES = 400;
// The reflection is drawn whole in the frame that shows it (spread over three frames it lagged the
// view and swam), at most this share of the screen's resolution and this many pixels across; it
// covers only the pane's part of the screen, and nothing is drawn while the view stands still. At 0.6 of the
// screen (1280 px at most) each reflected texel covered almost two screen pixels: a visibly blocky, stepped mirror.
// Now one texel per screen pixel up to a 1920-px-wide view (a 4K view still draws half-size).
const RESOLUTION = 1, MAX_SIDE = 1920;

/** Meshes of fine detail lying wholly beyond DETAIL_REACH in front of a mirror plane. */
function distantDetail(scene: Object3D, point: Vector3, normal: Vector3) {
  const set = new WeakSet<Object3D>(), corner = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  let meshes = 0, triangles = 0;
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || 'isSkinnedMesh' in mesh || mesh.userData.mdPlanarMirror) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    let nearest = Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld);
      nearest = Math.min(nearest, corner.sub(point).dot(normal));
    }
    if (nearest < DETAIL_REACH) return;
    const index = mesh.geometry.index, count = Math.floor((index?.count ?? position.count) / 3);
    if (count < 64) return;
    const stride = Math.max(1, Math.floor(count / DETAIL_SAMPLES));
    let area = 0, samples = 0;
    for (let triangle = 0; triangle < count; triangle += stride, samples++) {
      const at = (vertex: number) => index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
      a.fromBufferAttribute(position, at(0)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, at(1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, at(2)).applyMatrix4(mesh.matrixWorld);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    if (area / samples >= DETAIL_TRIANGLE) return;
    set.add(mesh); meshes++; triangles += count;
  });
  console.info('[MD mirror] distant detail left out of the reflection', { meshes, triangles });
  return set;
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
  // One target (half-float, 2x multisampled), sized to the pane's part of the screen.
  const target = new RenderTarget(1, 1, { type: HalfFloatType, samples: 2 });
  target.texture.name = 'Gallery mirror reflection';
  const material = new MeshBasicNodeMaterial({ name: 'V21 | live silver mirror' });
  const crop = new Vector4(0, 0, 1, 1), cropNode = uniform(crop);
  material.colorNode = texture(target.texture, screenUV.flipX().sub(cropNode.xy).div(cropNode.zw)).rgb.mul(0.94);
  // The reflection is an image on the pane: the pane's own motion vectors point
  // temporal history at the wrong place whenever the camera moves, which smeared
  // and flickered the reflection. Report a motion that lands outside the history
  // buffer so the resolve uses the current, already multisampled, reflection.
  material.mrtNode = mrt({ output, velocity: vec4(4, 4, 0, 1) });
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
  // Skip the second scene pass while the pane is completely hidden behind opaque
  // architecture (most ground-floor and exterior views). The GPU occlusion query
  // of the pane's own draw decides; it never hides a visible mirror, and the
  // pass resumes on the first frame that reports any visible sample.
  const hiddenFrames = panes.map(() => 0);
  let mainView: PerspectiveCamera | undefined, activeSurface = 0;
  const distant: Array<WeakSet<Object3D> | undefined> = panes.map(() => undefined);
  panes.forEach((surface, index) => {
    (surface as Mesh & { occlusionTest: boolean }).occlusionTest = true;
    const before = surface.onBeforeRender;
    surface.onBeforeRender = function (renderer, scene, viewCamera, geometry, renderedMaterial, group) {
      before.call(this, renderer, scene, viewCamera, geometry, renderedMaterial, group);
      if (viewCamera !== mainView) return;
      const occluded = (renderer as unknown as WebGPURenderer).isOccluded(surface) === true;
      hiddenFrames[index] = occluded ? hiddenFrames[index] + 1 : 0;
    };
  });
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
    mainView = view; activeSurface = surfaces.indexOf(active);
    if (hiddenFrames[surfaces.indexOf(active)] > 20) return false;
    renderer.getDrawingBufferSize(size);
    const scale = Math.min(RESOLUTION, MAX_SIDE / Math.max(size.x, size.y));
    fullSize.set(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)));
    // Seen edge-on (from the bridge the pane is a 4 px sliver 18 m away) the whole
    // hall was still drawn a second time for it, a third of that frame. Below a
    // few pixels no reflection can be read; keep the last image and its crop.
    if (reflectionSpan(active.pane.geometry.boundingBox!, active.pane.matrixWorld, view, fullSize) < MINIMUM_PANE_PIXELS) return false;
    reflectionCrop(active.pane.geometry.boundingBox!, active.pane.matrixWorld, view, fullSize, targetSize.set(target.width, target.height), crop);
    // The crop extent is a whole number of reflection texels; its origin was not,
    // so reflected texels slid under the screen pixels as the camera moved.
    crop.x = Math.round(crop.x * fullSize.x) / fullSize.x; crop.y = Math.round(crop.y * fullSize.y) / fullSize.y;
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
          visitor ? targets => drawPreparedReflection(renderer, scene, camera, targets, visitor, signal) : undefined);
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
        // Completion is fenced once after the complete opening frame.
      }, signal);
      frameCache.invalidate();
    },
    update(renderer: WebGPURenderer, scene: Scene, view: PerspectiveCamera, revision?: number) {
      if (!prepareReflection(renderer, view)) { frameCache.invalidate(); return; }
      if (frameCache.matches(scene, revision, camera.matrixWorld, camera.projectionMatrix, crop, target.width, target.height)) return;
      const oldTarget = renderer.getRenderTarget(), oldMRT = renderer.getMRT(), oldClear = renderer.autoClear;
      // No recursive reflection, and no velocity writes into the reflection pass.
      panes.forEach((surface, i) => { visibility[i] = surface.visible; surface.visible = false; });
      // Built once per face, on its first reflection, when the scene is complete and partitioned.
      const skip = distant[activeSurface] ??= distantDetail(scene, point, normal);
      const oldFilter = renderer.getRenderObjectFunction();
      try {
        renderer.setMRT(null); renderer.setRenderTarget(target); renderer.autoClear = true;
        // Only the reflection's own camera: a nested shadow pass keeps every caster.
        renderer.setRenderObjectFunction((...args) => {
          if (args[2] === camera && skip.has(args[0])) return;
          if (oldFilter) oldFilter.call(renderer, ...args); else renderer.renderObject(...args);
        });
        renderer.render(scene, camera);
        frameCache.record(scene, revision, camera.matrixWorld, camera.projectionMatrix, crop, target.width, target.height);
      } finally {
        renderer.setRenderObjectFunction(oldFilter);
        renderer.setRenderTarget(oldTarget); renderer.setMRT(oldMRT); renderer.autoClear = oldClear;
        panes.forEach((surface, i) => { surface.visible = visibility[i]; });
      }
    },
    dispose() { target.dispose(); material.dispose(); added.forEach(object => object.removeFromParent()); },
  };
}
