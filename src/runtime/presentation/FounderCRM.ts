import * as THREE from 'three';
import { installFlatPanel } from './flatPanel.ts';
import { createScreenAperture } from './screenTexture.ts';
import { projectScreenPlane } from './projection.ts';
import { createNativeScreenInput } from './nativeScreenInput.ts';
import { createCrmLifecycle } from './crmLifecycle.ts';
import { createFrameReadiness } from './frameReadiness.ts';
import { installCrmEmbedStyles } from './crmEmbedStyles.ts';

export function crmCanvasSize(width: number, height: number) {
  const aspect = width / height;
  if (!(aspect > 0) || !Number.isFinite(aspect)) throw Error('Invalid founder display dimensions');
  return aspect > 21 / 9 ? { width: Math.round(900 * aspect), height: 900 } : { width: 1600, height: Math.round(1600 / aspect) };
}

/** A single persistent native document, registered to the same measured plane as
 * its depth aperture. Reuses the proven presentation projection, not DOM slices. */
export function createFounderCRM(options: {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement; preview: THREE.Texture;
  onFocus: () => void; onRequestFocus?: () => void; isInView: (points: THREE.Vector3[]) => boolean;
}) {
  const meshes: THREE.Mesh[] = [];
  options.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name === 'FR79 | founder panoramic dashboard') meshes.push(mesh);
  });
  if (!meshes.length) return undefined;
  const panel = installFlatPanel(meshes);
  const aperture = createScreenAperture(panel.face, options.camera, options.preview);
  const { corners, normal } = panel;
  const size = crmCanvasSize(corners[0].distanceTo(corners[1]), corners[0].distanceTo(corners[3]));
  const center = panel.point(.5, .5), samples = [[.5,.5],[.15,.2],[.85,.2]].map(([u,v]) => panel.point(u,v));
  const doc = options.canvas.ownerDocument, win = doc.defaultView!;
  const host = doc.createElement('div'); host.dataset.founderCrm = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: size.width+'px', height: size.height+'px',
    transformOrigin: '0 0', overflow: 'hidden', background: '#000', zIndex: '0', visibility: 'hidden', pointerEvents: 'none' });
  doc.body.append(host);
  const viewport = options.canvas.parentElement, previousZ = viewport?.style.zIndex ?? '';
  if (viewport) viewport.style.zIndex = '1';
  let frame: HTMLIFrameElement | undefined, ready = false, seated = false, focused = false, visible = false, enabled = true, disposed = false;
  let inspectionVisible = true;
  let dirty = true, lastWidth = 0, lastHeight = 0, lastState = '', transform = '', clip = '';
  const previousCamera = new THREE.Matrix4(), previousProjection = new THREE.Matrix4();
  const pointer = new THREE.Vector2(), ray = new THREE.Raycaster(), cameraPosition = new THREE.Vector3();
  const input = createNativeScreenInput({ canvas: options.canvas, frame: () => frame, onFocus: () => { if (!focused) options.onRequestFocus?.(); options.onFocus(); },
    hit(x,y) {
      if (!seated || !ready || !visible || !enabled) return null;
      pointer.set(x/win.innerWidth*2-1,1-y/win.innerHeight*2); ray.setFromCamera(pointer,options.camera);
      const hit = ray.intersectObject(panel.face,false)[0];
      return hit?.uv ? {u:hit.uv.x,v:hit.uv.y} : null;
    },
  });
  const lifecycle = createCrmLifecycle({
    tour: on => { if (ready) frame?.contentWindow?.postMessage({type:'md:tour',on},win.location.origin); },
    pause: paused => {
      const root = frame?.contentDocument?.documentElement;
      if (root) root.toggleAttribute('data-md-host-paused', paused);
    },
  });
  function sync() {
    const show = inspectionVisible && enabled && seated && visible && ready && !doc.hidden;
    const state = !ready ? 'loading' : show ? focused ? 'focused' : seated ? 'seated' : 'attract' : 'hidden';
    lifecycle.update(ready, show, seated);
    if (state === lastState) return;
    lastState = state;
    host.dataset.crmState = state;
    host.dataset.crmVisible = String(visible); host.dataset.crmEnabled = String(enabled);
    host.style.visibility = show ? 'visible' : 'hidden';
    host.style.pointerEvents = show && seated ? 'auto' : 'none';
    if (frame) frame.tabIndex = show && seated ? 0 : -1;
    input.setEnabled(show && seated); aperture.setLive(show);

  }
  const readiness = createFrameReadiness({
    loadedGraceMs: 8000,
    load: attempt => {
      if (!frame || disposed) return;
      host.dataset.crmAttempt = String(attempt);
      host.dataset.crmLoaded = 'false';
      frame.src = `/crm/index.html?w=${size.width}&h=${size.height}&quality=low&tour=0&attempt=${attempt}#/command`;
    },
    exhausted: () => { host.dataset.crmLoadFailed = 'true'; },
  });
  function ensureFrame() {
    if (frame) return;
    frame = doc.createElement('iframe'); frame.title = "MotionDesign.ad Founder's Room CRM";
    Object.assign(frame.style,{width:size.width+'px',height:size.height+'px',border:'0',display:'block',background:'#000'});
    frame.addEventListener('load', () => { host.dataset.crmLoaded = 'true'; readiness.loaded(); });
    // Navigate before insertion: avoid an about:blank load starting the boot deadline.
    readiness.start();
    host.append(frame);
  }
  async function receive(event: MessageEvent) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== win.location.origin) return;
    if (event.data?.type !== 'md:ready' || ready) return;
    readiness.ready();
    host.dataset.crmLoadFailed = 'false';
    input.refreshFrame();
    // Pause invisible CSS animation without changing the supplied static build,
    // user preferences, route, form state, or the persistent iframe instance.
    const child = frame.contentDocument;
    if (child) {
      installCrmEmbedStyles(child);
      const style = child.createElement('style');
      style.dataset.mdHostLifecycle = '';
      style.textContent = ':root[data-md-host-paused] *, :root[data-md-host-paused] *::before, :root[data-md-host-paused] *::after { animation-play-state: paused !important; }';
      child.head.append(style);
    }
    // Ready announces app boot; keep the snapshot while fonts/images decode.
    if (child) await Promise.all([
      child.fonts.ready.catch(() => {}),
      ...Array.from(child.images, image => image.decode().catch(() => {})),
    ]);
    await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    if (disposed || frame?.contentDocument !== child) return;
    ready = true; dirty = true;
    sync();
    if (focused && enabled) frame.contentWindow?.focus();
  }
  function visibility() { dirty = true; sync(); }
  win.addEventListener('message',receive); doc.addEventListener('visibilitychange',visibility);
  return {
    size, corners, center, collision: panel.collision,
    prepare() { ensureFrame(); },
    setInspectionVisible(value: boolean) { inspectionVisible = value; dirty = true; sync(); },
    setSeated(next: boolean) {
      if (seated === next) return;
      seated = next; if (!next) focused = false; dirty = true;
      if (next) ensureFrame();
      sync();
      if (!next && doc.activeElement === frame) input.focusRoom();
    },
    setFocused(next: boolean) {
      focused = next && seated; dirty = true; sync();
      if (focused && ready) frame?.contentWindow?.focus();
    },
    setEnabled(value: boolean) { if (value === enabled) return; enabled = value; dirty = true; sync(); },
    update() {
      if (disposed) return false;
      const changed = aperture.takeDirty();
      const w = win.innerWidth,h=win.innerHeight;
      if (!dirty && w===lastWidth && h===lastHeight && previousCamera.equals(options.camera.matrixWorld) && previousProjection.equals(options.camera.projectionMatrix)) return changed;
      dirty=false; lastWidth=w;lastHeight=h;previousCamera.copy(options.camera.matrixWorld);previousProjection.copy(options.camera.projectionMatrix);
      options.camera.getWorldPosition(cameraPosition);
      const projection = projectScreenPlane(corners,options.camera,w,h,size.width,size.height);
      visible = !!projection?.visible && normal.dot(cameraPosition.clone().sub(center))>.005 && cameraPosition.distanceToSquared(center)<25**2 && options.isInView(samples);
      // The static preview owns exploration; the one live frame starts on sit.
      if (enabled && seated) ensureFrame();
      if (projection && visible) {
        const nextTransform = `matrix3d(${projection.matrix.join(',')})`, nextClip = projection.clipPolygon ?? 'none';
        if (transform !== nextTransform) { transform = nextTransform; host.style.transform = transform; input.updateCamera(projection.matrix); }
        if (clip !== nextClip) { clip = nextClip; host.style.clipPath = clip; }
      }
      sync();return changed || aperture.takeDirty();
    },
    dispose() {
      if(disposed)return;disposed=true;readiness.dispose();lifecycle.dispose();input.dispose();win.removeEventListener('message',receive);doc.removeEventListener('visibilitychange',visibility);
      host.remove();aperture.dispose();panel.dispose();if(viewport)viewport.style.zIndex=previousZ;
    },
  };
}
