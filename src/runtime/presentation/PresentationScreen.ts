import * as THREE from 'three';
import { createLiveStudioSurface } from './LiveStudioSurface.ts';
import { projectScreenPlane } from './projection.ts';
import { installFlatPanel } from './flatPanel.ts';
import { createScreenAperture } from './screenTexture.ts';

export { findScreenCorners as screenCorners } from './flatPanel.ts';
export type ScreenBounds = { x: number; y: number; width: number; height: number };
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onOpen?: (bounds: ScreenBounds) => void; onFocus?: () => void;
  isInView?: (points: THREE.Vector3[]) => boolean;
  isUnobstructed?: (point: THREE.Vector3, ray: THREE.Raycaster) => boolean;
};

/** The browser, raycast and depth mask all use the same measured flat face. */
export function createPresentationScreen(options: Options) {
  const originals: THREE.Mesh[] = [];
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(options.objectName);
  options.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = String(mesh.userData.sourceName ?? mesh.userData.source_name ?? mesh.name);
    if (normalize(name) === target || normalize(mesh.name) === target) originals.push(mesh);
  });
  if (!originals.length) throw new Error('Presentation display not found: ' + options.objectName);
  const panel = installFlatPanel(originals);
  const aperture = createScreenAperture(panel.face, options.camera);
  const { corners, normal } = panel;
  const center = panel.point(.5, .5);
  const samples = [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9],[.1,.5],[.9,.5]].map(([u,v]) => panel.point(u,v));
  const aspect = corners[0].distanceTo(corners[1]) / corners[0].distanceTo(corners[3]);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), cameraPosition = new THREE.Vector3();
  let width = 0, height = 0, active = false, visible = false, disposed = false, first = true;
  let bounds: ScreenBounds = { x: 0, y: 0, width: 0, height: 0 };
  const previousCamera = new THREE.Matrix4(), previousProjection = new THREE.Matrix4();
  function sampleSurface(x: number, y: number) {
    if (!active || !visible || disposed) return null;
    pointer.set(x / width * 2 - 1, 1 - y / height * 2);
    raycaster.setFromCamera(pointer, options.camera);
    const hit = raycaster.intersectObject(panel.face, false)[0];
    if (!hit?.uv || options.isUnobstructed && !options.isUnobstructed(hit.point, raycaster)) return null;
    return { u: hit.uv.x, v: hit.uv.y };
  }
  function open() { if (active && visible && !disposed) options.onOpen?.(bounds); }
  const surface = createLiveStudioSurface({
    canvas: options.canvas, aspect, sampleSurface, onExpand: open,
    onFocus: () => options.onFocus?.(), onAperture: aperture.setLive,
  });
  return {
    meshes: [panel.face], collision: panel.collision,
    setActive(value: boolean) { active = value; surface.setInteractive(value); },
    setAction(action: string) { if (action === 'studio' || action === 'open') open(); },
    update() {
      if (disposed) return false;
      const changed = aperture.takeDirty();
      options.camera.updateMatrixWorld();
      const w = window.innerWidth, h = window.innerHeight;
      if (!first && width === w && height === h && previousCamera.equals(options.camera.matrixWorld) && previousProjection.equals(options.camera.projectionMatrix)) return changed;
      first = false; width = w; height = h;
      previousCamera.copy(options.camera.matrixWorld); previousProjection.copy(options.camera.projectionMatrix);
      options.camera.getWorldPosition(cameraPosition);
      const wasVisible = visible;
      const projection = projectScreenPlane(corners, options.camera, w, h, surface.width, surface.height);
      visible = !!projection?.visible &&
        normal.dot(cameraPosition) - normal.dot(center) > .005 &&
        cameraPosition.distanceToSquared(center) < 35 ** 2 &&
        (!options.isInView || options.isInView(samples));
      if (visible && projection) bounds = projection.bounds;
      surface.update(visible, projection?.matrix ?? null, projection?.clipPolygon ?? null);
      return changed || aperture.takeDirty() || visible !== wasVisible;
    },
    getWorldCenter(target = new THREE.Vector3()) { return target.copy(center); },
    dispose() {
      if (disposed) return;
      disposed = true; surface.dispose(); aperture.dispose(); panel.dispose();
    },
  };
}
