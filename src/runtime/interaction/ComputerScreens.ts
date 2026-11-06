import * as THREE from 'three';
import { createMonitorReturns } from './monitorReturns.ts';
import { desktopLayout } from './desktopLayout.ts';
import { projectScreenPlane } from '../presentation/projection.ts';
import { createNativeScreenInput } from '../presentation/nativeScreenInput.ts';

export type Computer = { id: string; seat: THREE.Vector3; forward: THREE.Vector3; center: THREE.Vector3; corners: THREE.Vector3[]; normal: THREE.Vector3; matrix: THREE.Matrix4 };

/** Eighteen shared static instances; exactly one native document during use.
 * The depth aperture, pointer ray and DOM projection share the same flat plane. */
export function createComputerScreens(scene: THREE.Object3D, camera: THREE.Camera, canvas: HTMLCanvasElement) {
  const originals: Array<{ mesh: THREE.Mesh; visible: boolean }> = [];
  scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && /Box_Studio_textured_rug002_(51|53)$/.test(mesh.name)) originals.push({ mesh, visible: mesh.visible }); });
  if (!originals.length) return undefined;
  originals.forEach(({ mesh }) => { mesh.visible = false; });
  const computers: Computer[] = desktopLayout.map((item, index) => {
    const corners = item.corners.map(p => new THREE.Vector3().fromArray(p));
    const right = corners[1].clone().sub(corners[0]), up = corners[0].clone().sub(corners[3]);
    const normal = right.clone().cross(up).normalize();
    corners.forEach(p => p.addScaledVector(normal, .001));
    const center = corners[0].clone().add(corners[2]).multiplyScalar(.5);
    const matrix = new THREE.Matrix4().makeBasis(right, up, normal).setPosition(center);
    const seat = new THREE.Vector3().fromArray(item.seat);
    const forward = center.clone().sub(seat).setY(0).normalize();
    return { id: `studio-computer-${index + 1}`, seat, forward, center, corners, normal, matrix };
  });
  const returns = createMonitorReturns(originals.map(({ mesh }) => mesh), computers);
  scene.add(returns);
  const texture = new THREE.TextureLoader().load('/md-desktop/assets/desktop-preview.webp');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false });
  const staticScreens = new THREE.InstancedMesh(geometry, material, computers.length);
  staticScreens.name = 'md. desktop | idle monitors';
  computers.forEach((c, i) => staticScreens.setMatrixAt(i, c.matrix));
  staticScreens.computeBoundingSphere(); scene.add(staticScreens);
  const liveMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false, transparent: true, blending: THREE.NoBlending, depthWrite: true });
  const live = new THREE.Mesh(geometry, liveMaterial);
  staticScreens.userData.castShadow = false; live.userData.castShadow = false;
  live.name = 'md. desktop | active monitor'; live.matrixAutoUpdate = false; live.visible = false; scene.add(live);
  let active: Computer | undefined, frame: HTMLIFrameElement | undefined, host: HTMLDivElement | undefined;
  let loaded = false, presented = false, disposed = false, dirty = true, enabled = true;
  let previousWidth = 0, previousHeight = 0;
  const previousCamera = new THREE.Matrix4(), previousProjection = new THREE.Matrix4();
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const viewport = canvas.parentElement, priorZ = viewport?.style.zIndex ?? '';
  const input = createNativeScreenInput({ canvas, frame: () => frame,
    onFocus: () => { if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    hit: (x, y) => {
      if (!active || !loaded || !enabled) return null;
      pointer.set(x / window.innerWidth * 2 - 1, 1 - y / window.innerHeight * 2); ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObject(live, false)[0];
      return hit?.uv ? { u: hit.uv.x, v: 1 - hit.uv.y } : null;
    },
  });
  live.onBeforeRender = (_renderer, _scene, renderCamera) => {
    const open = presented && renderCamera === camera;
    liveMaterial.opacity = open ? 0 : 1; liveMaterial.color.setScalar(open ? 0 : 1);
  };
  function close() {
    if (active) { staticScreens.setMatrixAt(computers.indexOf(active), active.matrix); staticScreens.instanceMatrix.needsUpdate = true; }
    loaded = false; presented = false; active = undefined; input.setEnabled(false);
    // Removing the browsing context stops app timers, animation frames and WebGL.
    frame?.remove(); frame = undefined; input.refreshFrame(); host?.remove(); host = undefined;
    live.visible = false; dirty = true;
    if (viewport) viewport.style.zIndex = priorZ;
  }
  function open(computer: Computer) {
    if (disposed || computer === active) return;
    close(); active = computer; live.matrix.copy(computer.matrix); live.matrixWorldNeedsUpdate = true; live.visible = true;
    staticScreens.setMatrixAt(computers.indexOf(computer), new THREE.Matrix4().makeScale(0, 0, 0)); staticScreens.instanceMatrix.needsUpdate = true;
    host = document.createElement('div'); host.dataset.mdDesktop = computer.id;
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '720px', transformOrigin: '0 0', overflow: 'hidden', background: '#211406', zIndex: '0', visibility: 'hidden', pointerEvents: 'none' });
    frame = document.createElement('iframe'); frame.title = 'md. desktop'; frame.src = '/md-desktop/index.html?embed=monitor';
    Object.assign(frame.style, { width: '1280px', height: '720px', border: '0', display: 'block' });
    const thisFrame = frame;
    frame.addEventListener('load', () => {
      if (disposed || frame !== thisFrame) return;
      loaded = true; dirty = true; input.refreshFrame(); input.setEnabled(enabled);
      thisFrame.contentWindow?.focus();
    }, { once: true });
    host.append(frame); document.body.append(host);
    if (viewport) viewport.style.zIndex = '1';
    dirty = true;
  }
  return {
    computers, open, close,
    pick(x: number, y: number) {
      pointer.set(x / window.innerWidth * 2 - 1, 1 - y / window.innerHeight * 2); ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObject(staticScreens, false)[0];
      return hit?.instanceId === undefined ? undefined : computers[hit.instanceId];
    },
    setEnabled(value: boolean) { enabled = value; input.setEnabled(value && loaded); dirty = true; },
    update() {
      if (!active || !host || disposed) { const changed = dirty; dirty = false; return changed; }
      const w = window.innerWidth, h = window.innerHeight;
      if (!dirty && w === previousWidth && h === previousHeight && previousCamera.equals(camera.matrixWorld) && previousProjection.equals(camera.projectionMatrix)) return false;
      dirty = false; previousWidth = w; previousHeight = h; previousCamera.copy(camera.matrixWorld); previousProjection.copy(camera.projectionMatrix);
      const projection = projectScreenPlane(active.corners, camera, w, h, 1280, 720);
      const visible = enabled && loaded && !!projection?.visible;
      presented = visible;
      host.style.visibility = visible ? 'visible' : 'hidden'; host.style.pointerEvents = visible ? 'auto' : 'none';
      if (projection) { host.style.transform = `matrix3d(${projection.matrix.join(',')})`; host.style.clipPath = projection.clipPolygon ?? ''; input.updateCamera(projection.matrix); }
      return true;
    },
    dispose() { if (disposed) return; close(); disposed = true; input.dispose(); staticScreens.removeFromParent(); live.removeFromParent(); geometry.dispose(); material.dispose(); liveMaterial.dispose(); texture.dispose(); returns.removeFromParent(); returns.geometry.dispose(); returns.material.dispose(); originals.forEach(({ mesh, visible }) => { mesh.visible = visible; }); },
  };
}
