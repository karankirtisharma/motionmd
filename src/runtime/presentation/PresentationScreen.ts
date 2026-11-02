import * as THREE from 'three';
import { createLiveStudioSurface } from './LiveStudioSurface.ts';
import type { ScreenQuad } from './projection.ts';

export type ScreenBounds = { x: number; y: number; width: number; height: number };
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onOpen?: (bounds: ScreenBounds) => void; onFocus?: () => void;
  isInView?: (points: THREE.Vector3[]) => boolean;
  isUnobstructed?: (point: THREE.Vector3, ray: THREE.Raycaster) => boolean;
};

/** Read the four authored display UV corners, not the frame's world bounding box.
 * The curved display is the depth mask; its chord registers the browser surface. */
export function screenCorners(meshes: THREE.Mesh[]): THREE.Vector3[] {
  const targets = [[0, 0], [1, 0], [1, 1], [0, 1]];
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

/** The only replaced material is the named presentation display. Its depth-tested
 * alpha opening reveals live HTML behind the canvas; furniture and the visitor
 * still occlude it in the normal depth buffer, including on WebGL fallback. */
export function createPresentationScreen(options: Options) {
  const meshes: THREE.Mesh[] = [];
  const originals = new Map<THREE.Mesh, { material: THREE.Material | THREE.Material[]; before: THREE.Mesh['onBeforeRender'] }>();
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = normalize(options.objectName);
  options.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = String(mesh.userData.sourceName ?? mesh.userData.source_name ?? mesh.name);
    if (normalize(name) === targetName || normalize(mesh.name) === targetName) {
      meshes.push(mesh); originals.set(mesh, { material: mesh.material, before: mesh.onBeforeRender });
    }
  });
  if (!meshes.length) throw new Error(`Presentation display not found: ${options.objectName}`);
  const corners = screenCorners(meshes), center = new THREE.Vector3();
  corners.forEach(point => center.addScaledVector(point, .25));
  const normal = new THREE.Vector3().subVectors(corners[1], corners[0])
    .cross(new THREE.Vector3().subVectors(corners[3], corners[0])).negate().normalize();
  const visibilitySamples = [center, corners[0].clone().lerp(center, .2), corners[1].clone().lerp(center, .2)];
  const aspect = corners[0].distanceTo(corners[1]) / corners[0].distanceTo(corners[3]);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0,
    blending: THREE.NoBlending, depthTest: true, depthWrite: true, toneMapped: false });
  material.name = 'Presentation display | live DOM depth opening';
  let active = false, disposed = false, visible = false;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), cameraPosition = new THREE.Vector3();
  const projected = corners.map(() => new THREE.Vector3());
  const quad: ScreenQuad = [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
  let bounds: ScreenBounds = { x: 0, y: 0, width: 1, height: 1 };
  let viewportWidth = 0, viewportHeight = 0;
  const previousCamera = new THREE.Matrix4(), previousProjection = new THREE.Matrix4();
  let first = true;
  function hit(x: number, y: number) {
    if (!active || !visible || disposed) return false;
    pointer.set(x / viewportWidth * 2 - 1, 1 - y / viewportHeight * 2);
    raycaster.setFromCamera(pointer, options.camera);
    const intersection = raycaster.intersectObjects(meshes, false)[0];
    return !!intersection && (!options.isUnobstructed || options.isUnobstructed(intersection.point, raycaster));
  }
  function open() { if (active && visible && !disposed) options.onOpen?.(bounds); }
  const surface = createLiveStudioSurface({ canvas: options.canvas, aspect, canInteract: hit, onExpand: open,
    onFocus: () => options.onFocus?.() });
  for (const mesh of meshes) {
    mesh.material = material;
    mesh.onBeforeRender = function(renderer, scene, camera, geometry, mat, group) {
      originals.get(mesh)?.before.call(this, renderer, scene, camera, geometry, mat, group);
      // A reflection camera cannot see the DOM behind the main viewport. Keep
      // the screen opaque there instead of punching holes through mirror images.
      material.opacity = visible && camera === options.camera ? 0 : 1;
    };
  }
  return {
    meshes,
    setActive(value: boolean) { active = value; surface.setInteractive(value); },
    setAction(action: string) { if (action === 'studio' || action === 'open') open(); },
    update() {
      if (disposed) return false;
      options.camera.updateMatrixWorld();
      const w = window.innerWidth, h = window.innerHeight;
      if (!first && viewportWidth === w && viewportHeight === h && previousCamera.equals(options.camera.matrixWorld) && previousProjection.equals(options.camera.projectionMatrix)) return false;
      first = false; viewportWidth = w; viewportHeight = h;
      previousCamera.copy(options.camera.matrixWorld); previousProjection.copy(options.camera.projectionMatrix);
      options.camera.getWorldPosition(cameraPosition);
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, valid = true;
      corners.forEach((point, i) => {
        const p = projected[i].copy(point).project(options.camera);
        if (p.z < -1 || p.z > 1) valid = false;
        quad[i].x = (p.x + 1) * w / 2; quad[i].y = (1 - p.y) * h / 2;
        left = Math.min(left, quad[i].x); right = Math.max(right, quad[i].x);
        top = Math.min(top, quad[i].y); bottom = Math.max(bottom, quad[i].y);
      });
      bounds = { x: left, y: top, width: right - left, height: bottom - top };
      const wasVisible = visible;
      visible = valid && cameraPosition.distanceToSquared(center) < 35 ** 2 &&
        normal.dot(cameraPosition.sub(center)) > .05 && right > 0 && left < w && bottom > 0 && top < h &&
        Math.min(w, right) - Math.max(0, left) > 40 && Math.min(h, bottom) - Math.max(0, top) > 20 && (!options.isInView || options.isInView(visibilitySamples));
      surface.update(quad, visible);
      return visible !== wasVisible;
    },
    getWorldCenter(target = new THREE.Vector3()) { return target.copy(center); },
    dispose() {
      if (disposed) return; disposed = true; surface.dispose();
      originals.forEach((original, mesh) => { mesh.material = original.material; mesh.onBeforeRender = original.before; });
      material.dispose();
    },
  };
}
