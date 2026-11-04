import * as THREE from 'three';
import { createLiveStudioSurface } from './LiveStudioSurface.ts';
import { projectScreenPlane } from './projection.ts';
import { curvedScreenPatches, sampleScreenSurface } from './curvedSurface.ts';
import { createScreenTexture } from './screenTexture.ts';

export type ScreenBounds = { x: number; y: number; width: number; height: number };
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onOpen?: (bounds: ScreenBounds) => void; onFocus?: () => void;
  isInView?: (points: THREE.Vector3[]) => boolean;
  isUnobstructed?: (point: THREE.Vector3, ray: THREE.Raycaster) => boolean;
};

/** Read the four authored display UV corners, not the frame's world bounding box.
 * The authored surface remains curved; these boundary corners are only used for
 * the deliberate expand-to-fullscreen transition, never for its in-world UI. */
function screenPoints(meshes: THREE.Mesh[], targets: number[][]): THREE.Vector3[] {
  return targets.map(([u, v]) => {
    const point = new THREE.Vector3(); let nearest = Infinity;
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const uv = mesh.geometry.getAttribute('uv'), position = mesh.geometry.getAttribute('position');
      if (!uv || !position) continue;
      for (let i = 0; i < uv.count; i++) {
        const distance = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
        if (distance < nearest) { nearest = distance; point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); }
      }
    }
    if (!Number.isFinite(nearest)) throw new Error('The presentation display has no usable UV surface.');
    return point;
  });
}

export function screenCorners(meshes: THREE.Mesh[]): THREE.Vector3[] {
  return screenPoints(meshes, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** The display samples the live Studio in authored UV space. Camera movement,
 * furniture occlusion and reflections use the ordinary scene renderer. */
export function createPresentationScreen(options: Options) {
  const meshes: THREE.Mesh[] = [];
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = normalize(options.objectName);
  options.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = String(mesh.userData.sourceName ?? mesh.userData.source_name ?? mesh.name);
    if (normalize(name) === targetName || normalize(mesh.name) === targetName) {
      meshes.push(mesh);
    }
  });
  if (!meshes.length) throw new Error(`Presentation display not found: ${options.objectName}`);
  const corners = screenCorners(meshes), center = new THREE.Vector3();
  corners.forEach(point => center.addScaledVector(point, .25));
  const normal = new THREE.Vector3().subVectors(corners[1], corners[0])
    .cross(new THREE.Vector3().subVectors(corners[3], corners[0])).negate().normalize();
  center.copy(sampleScreenSurface(meshes,.5,.5,normal));
  const curve = curvedScreenPatches(meshes, normal, 16);
  const worldBounds = new THREE.Box3();
  for (const mesh of meshes) worldBounds.expandByObject(mesh);
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const visibilitySamples = [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9],[.1,.5],[.9,.5]].map(([u,v])=>sampleScreenSurface(meshes,u,v,normal));
  const aspect = corners[0].distanceTo(corners[1]) / corners[0].distanceTo(corners[3]);
  const screen = createScreenTexture(meshes);
  let active = false, disposed = false, visible = false;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), cameraPosition = new THREE.Vector3();
  let viewportWidth = 0, viewportHeight = 0;
  const previousCamera = new THREE.Matrix4(), previousProjection = new THREE.Matrix4();
  let first = true;
  function sampleSurface(x: number, y: number) {
    if (!active || !visible || disposed) return null;
    pointer.set(x / viewportWidth * 2 - 1, 1 - y / viewportHeight * 2);
    raycaster.setFromCamera(pointer, options.camera);
    const intersection = raycaster.intersectObjects(meshes, false)[0];
    if (!intersection?.uv || options.isUnobstructed && !options.isUnobstructed(intersection.point,raycaster)) return null;
    return {u:intersection.uv.x,v:intersection.uv.y};
  }
  // Only the deliberate expand transition needs the visible pixel rectangle.
  // Clip against the sampled curve here, including when the edge chord is
  // behind the camera but the actual bowed screen is still in front of it.
  function projectedBounds(): ScreenBounds {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const patch of curve) {
      if (patch.normal.dot(cameraPosition) <= patch.normal.dot(patch.center)) continue;
      const result = projectScreenPlane(patch.corners, options.camera, viewportWidth, viewportHeight, 1, 1);
      if (!result?.visible) continue;
      const bounds = result.bounds;
      left = Math.min(left, bounds.x); top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    if (!Number.isFinite(left)) return { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  function open() { if (active && visible && !disposed) options.onOpen?.(projectedBounds()); }
  const surface = createLiveStudioSurface({ canvas: options.canvas, aspect, sampleSurface, onExpand: open, onFrame: screen.paint,
    onFocus: () => options.onFocus?.() });
  return {
    meshes,
    setActive(value: boolean) { active = value; surface.setInteractive(value); },
    setAction(action: string) { if (action === 'studio' || action === 'open') open(); },
    update() {
      if (disposed) return false;
      const painted = screen.takeDirty();
      options.camera.updateMatrixWorld();
      const w = window.innerWidth, h = window.innerHeight;
      if (!first && viewportWidth === w && viewportHeight === h && previousCamera.equals(options.camera.matrixWorld) && previousProjection.equals(options.camera.projectionMatrix)) return painted;
      first = false; viewportWidth = w; viewportHeight = h;
      previousCamera.copy(options.camera.matrixWorld); previousProjection.copy(options.camera.projectionMatrix);
      options.camera.getWorldPosition(cameraPosition);
      const wasVisible = visible;
      viewProjection.multiplyMatrices(options.camera.projectionMatrix, options.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection, options.camera.coordinateSystem, options.camera.reversedDepth);
      visible = cameraPosition.distanceToSquared(center) < 35 ** 2 && frustum.intersectsBox(worldBounds) &&
        curve.some(patch => patch.normal.dot(cameraPosition) - patch.normal.dot(patch.center) > .005) &&
        (!options.isInView || options.isInView(visibilitySamples));

      // A planar iframe exists only during fullscreen handoff. Never project
      // its full rectangle through the eye when standing against the screen.
      const projection = visible ? projectScreenPlane(corners, options.camera, w, h, surface.width, surface.height) : null;
      let transform = projection?.matrix ?? null;
      if (transform && transform[15] + Math.min(0, transform[3] * surface.width) + Math.min(0, transform[7] * surface.height) <= .05) {
        transform = [w / surface.width, 0, 0, 0, 0, h / surface.height, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      }
      surface.update(visible, transform);
      return painted || visible !== wasVisible;
    },
    getWorldCenter(target = new THREE.Vector3()) { return target.copy(center); },
    dispose() {
      if (disposed) return; disposed = true; surface.dispose();
      screen.dispose();
    },
  };
}
