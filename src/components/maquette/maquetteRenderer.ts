import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface MaquetteOptions {
  light: 'warm' | 'soft';
  reducedMotion: boolean;
  assembly: number;
  turn: number;
}
export interface MaquetteRenderer {
  update(options: MaquetteOptions): void;
  dispose(): void;
}
type Callbacks = { ready(): void; unavailable(): void };
type Pose = { mesh: THREE.Mesh; delta: THREE.Vector3 };

const MODEL = '/maquette/Living_Maquette_LOD.glb';
const ENVIRONMENT = '/maquette/E01_studio_warm.hdr';
const clampAssembly = (amount: number) => Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));

function disposeObject(root: THREE.Object3D, includeMaterials = true) {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometry.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const value of geometry) value.dispose();
  if (!includeMaterials) return;
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    const image = texture.source.data as { close?: () => void } | undefined;
    image?.close?.();
  }
}

/** Merge only identical materials AND identical assembly deltas. Vertices,
 * normals, UVs, material values and independent part choreography are retained.
 * This kit's 382 export meshes become 45 draw batches, without an LOD rewrite. */
function batchModel(source: THREE.Group): { root: THREE.Group; poses: Pose[] } {
  source.updateMatrixWorld(true);
  const batches = new Map<string, { material: THREE.Material; delta: THREE.Vector3; geometry: THREE.BufferGeometry[]; names: string[] }>();
  source.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    // The shipped GLB nodes are flat, and extras contain Blender Z-up positions.
    // Convert only the exploded-minus-rest DELTA; do not replace imported rest.
    const rest = node.userData.rest_position as number[] | undefined;
    const exploded = node.userData.exploded_position as number[] | undefined;
    const delta = rest && exploded
      ? new THREE.Vector3(exploded[0] - rest[0], exploded[2] - rest[2], -(exploded[1] - rest[1]))
      : new THREE.Vector3();
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const key = material.uuid + ':' + delta.toArray().map(value => value.toFixed(6)).join(',');
    let batch = batches.get(key);
    if (!batch) { batch = { material, delta, geometry: [], names: [] }; batches.set(key, batch); }
    batch.geometry.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    batch.names.push(node.name);
  });
  const root = new THREE.Group();
  const poses: Pose[] = [];
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geometry, false);
    const geometries = merged ? [merged] : batch.geometry;
    if (merged) for (const geometry of batch.geometry) geometry.dispose();
    for (const geometry of geometries) {
      const mesh = new THREE.Mesh(geometry, batch.material);
      mesh.name = `Maquette_${batch.names[0]}`;
      mesh.userData.sourceNodes = batch.names;
      mesh.castShadow = batch.material.name !== 'MAT_Architectural_Clear_Glass';
      mesh.receiveShadow = mesh.castShadow;
      root.add(mesh); poses.push({ mesh, delta: batch.delta });
    }
    // The supplied glass is explicitly thin alpha-blended glazing, not physical
    // transmission. Avoid depth-writing it across the interior or a second pass.
    if (batch.material.name === 'MAT_Architectural_Clear_Glass') {
      batch.material.depthWrite = false;
      batch.material.forceSinglePass = true;
    }
  }
  disposeObject(source, false);
  return { root, poses };
}

/** Event-driven, self-contained preview. No interval, no idle render loop. */
export function mountMaquette(canvas: HTMLCanvasElement, initial: MaquetteOptions, callbacks: Callbacks): MaquetteRenderer {
  let options = { ...initial };
  let disposed = false, failed = false, loaded = false, announced = false;
  let frame = 0, timer = 0, previousFrame = 0;
  let drag: { pointer: number; x: number; turn: number } | null = null;
  let dragOffset = 0;
  let currentTurn = initial.turn, currentAssembly = clampAssembly(initial.assembly), currentWarmth = initial.light === 'warm' ? 1 : 0;
  let model: THREE.Group | null = null, poses: Pose[] = [];
  let environment: THREE.WebGLRenderTarget | null = null;
  const abort = new AbortController();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 7.2, -7.2, 0.1, 120);
  // Exact conversion of the kit's canonical Blender camera/target to glTF Y-up.
  camera.position.set(-12, 6.800000190734863, 18);
  camera.lookAt(0, 3.4, 0);
  camera.updateMatrixWorld(true);
  const aim = new THREE.Vector3(0, 3.4, 0);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    callbacks.unavailable();
    return { update() {}, dispose() {} };
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const fill = new THREE.HemisphereLight(0xfff4e1, 0xbda58a, 1.4);
  const key = new THREE.DirectionalLight(0xffdeb4, 3.1);
  key.position.set(-8, 15, 10);
  key.target.position.set(0, 2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
  key.shadow.normalBias = 0.025;
  const rim = new THREE.DirectionalLight(0xffd09a, 1.8);
  rim.position.set(5, 10, -5);
  scene.add(fill, key, key.target, rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.ShadowMaterial({ opacity: 0.17, color: 0x604020 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);
  const warm = new THREE.Color(0xffdeb4), soft = new THREE.Color(0xfff6ed);
  let fittedWidth = 16, fittedHeight = 10;

  function resize() {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max(fittedHeight, fittedWidth / aspect);
    camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
    camera.top = span / 2; camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    schedule();
  }

  function cancel() {
    if (frame) cancelAnimationFrame(frame);
    if (timer) window.clearTimeout(timer);
    frame = timer = 0;
  }
  function schedule() {
    if (disposed || failed || !loaded || document.hidden || frame || timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      frame = requestAnimationFrame(render);
    }, Math.max(0, 1000 / 30 - (performance.now() - previousFrame)));
  }
  function render(now: number) {
    frame = 0;
    if (disposed || failed || document.hidden || !model) return;
    const dt = Math.min(0.1, previousFrame ? (now - previousFrame) / 1000 : 1 / 30);
    previousFrame = now;
    const blend = options.reducedMotion || drag ? 1 : 1 - Math.exp(-12 * dt);
    const targetTurn = options.turn + dragOffset;
    const targetAssembly = clampAssembly(options.assembly);
    const targetWarmth = options.light === 'warm' ? 1 : 0;
    currentTurn += (targetTurn - currentTurn) * blend;
    currentAssembly += (targetAssembly - currentAssembly) * blend;
    currentWarmth += (targetWarmth - currentWarmth) * blend;
    model.rotation.y = currentTurn;
    for (const pose of poses) pose.mesh.position.copy(pose.delta).multiplyScalar(currentAssembly);
    key.color.copy(soft).lerp(warm, currentWarmth);
    key.intensity = 2.6 + currentWarmth * 0.5;
    rim.intensity = 1.1 + currentWarmth * 0.7;
    renderer.shadowMap.needsUpdate = true;
    try { renderer.render(scene, camera); }
    catch { fail(); return; }
    if (!announced) { announced = true; callbacks.ready(); }
    if (Math.abs(currentTurn - targetTurn) > 0.001 || Math.abs(currentAssembly - targetAssembly) > 0.001 || Math.abs(currentWarmth - targetWarmth) > 0.001) schedule();
  }
  function visibility() { if (document.hidden) cancel(); else { previousFrame = 0; schedule(); } }
  function down(event: PointerEvent) {
    if (!loaded || event.button !== 0) return;
    drag = { pointer: event.pointerId, x: event.clientX, turn: dragOffset };
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    dragOffset = drag.turn + (event.clientX - drag.x) * 0.008;
    schedule();
  }
  function up(event: PointerEvent) { if (drag?.pointer === event.pointerId) drag = null; }
  function contextLost(event: Event) { event.preventDefault(); fail(); }
  function fail() {
    if (disposed || failed) return;
    failed = true; cancel(); callbacks.unavailable();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('webglcontextlost', contextLost);

  async function bytes(url: string) {
    const response = await fetch(url, { signal: abort.signal, priority: 'low' });
    if (!response.ok) throw Error(`Maquette asset unavailable (${response.status})`);
    return response.arrayBuffer();
  }
  void Promise.all([bytes(MODEL), bytes(ENVIRONMENT)]).then(async ([glb, hdr]) => {
    if (disposed) return;
    const result = await new GLTFLoader().parseAsync(glb, '/maquette/');
    if (disposed) { disposeObject(result.scene); return; }
    const batched = batchModel(result.scene);
    model = batched.root; poses = batched.poses;
    scene.add(model);
    const data = new HDRLoader().parse(hdr);
    const texture = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.flipY = true; texture.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(texture);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.9;
    texture.dispose(); pmrem.dispose();

    // Fit the canonical view to the actual model, reserving assembly headroom.
    // No frame-to-frame camera reframing: rotation remains steady and deliberate.
    for (const pose of poses) pose.mesh.position.copy(pose.delta).multiplyScalar(0.45);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const upAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let maxX = 0, maxY = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const relative = new THREE.Vector3(x, y, z).sub(aim);
      maxX = Math.max(maxX, Math.abs(relative.dot(right)));
      maxY = Math.max(maxY, Math.abs(relative.dot(upAxis)));
    }
    fittedWidth = maxX * 2.06; fittedHeight = maxY * 2.06;
    for (const pose of poses) pose.mesh.position.copy(pose.delta).multiplyScalar(currentAssembly);
    model.rotation.y = currentTurn;
    loaded = true; resize();
  }).catch(() => { if (!disposed) fail(); });

  return {
    update(value) { options = { ...value }; schedule(); },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); cancel(); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('webglcontextlost', contextLost);
      disposeObject(scene);
      environment?.dispose(); key.shadow.map?.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      scene.clear(); model = null; poses = [];
    },
  };
}
