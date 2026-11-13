/**
 * Living Maquette runtime stage (three.js r186, WebGL2).
 *
 * Owns the renderer, the imported GLB roots, the lighting rig and the camera
 * framing. Decorative pose and visibility go through the kit's scene adapter
 * (src/kit/maquette-scene-adapter.mjs) on the named nodes in their imported
 * local bases; overall rotation lives on an outer turntable group.
 *
 * Nothing in this module reads or produces loading progress or entry
 * readiness. It renders on demand: a frame is drawn only while something is
 * changing, at most `fpsCap` times a second, and never in a hidden tab.
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AgXToneMapping,
  Box3,
  BufferAttribute,
  Matrix4,
  CanvasTexture,
  Color,
  CustomBlending,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// The decoder starts compiling its WebAssembly on import. Where the page's
// policy refuses WebAssembly that fails; loadModel then takes the quantized
// file instead, so the refusal is expected and handled there.
MeshoptDecoder.ready.catch(() => {});
import { createMaquetteSceneAdapter } from '../kit/maquette-scene-adapter.mjs';
import { buildStudioEnvironment, createKeyCookie } from './environment.mjs';
import { LOOK } from './look.mjs';

const DEG = Math.PI / 180;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, t) => a + (b - a) * t;
const TONE_MAPPING = { agx: AgXToneMapping, aces: ACESFilmicToneMapping, neutral: NeutralToneMapping };

/** WebGL2 availability without creating the real renderer. */
export function canUseWebGL2() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const idOf = (node) => node.userData?.maquette_id ?? node.name;
const groupOf = (node) => node.userData?.group;

function hasGeometry(node) {
  let found = false;
  node.traverse((child) => { if (child.isMesh) found = true; });
  return found;
}

/**
 * Scale a node about a world-space pivot. The imported exports carry no
 * parent transforms, so local and world coordinates coincide.
 */
function scaleAbout(node, pivot, scale) {
  node.position.set(
    pivot.x + (node.position.x - pivot.x) * scale.x,
    pivot.y + (node.position.y - pivot.y) * scale.y,
    pivot.z + (node.position.z - pivot.z) * scale.z,
  );
  node.scale.multiply(scale);
  node.updateMatrixWorld(true);
}

function makeContactTexture() {
  // Radial falloff: dense under the rim of the plinth, gone a little outside it.
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.74, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.84, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.93, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function makeHaloTexture() {
  // Bright core with a long soft falloff across the strip (v), flat along it (u).
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, 0, 64);
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    const d = Math.abs(t - 0.5) * 2;
    const a = Math.exp(-d * d * 7) * (1 - d) ** 0.5;
    gradient.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Soft light spill under each rectangular ceiling light line. The halo quads
 * are children of the light node, so they follow its pose and visibility.
 */
function addStripHalos(root, spec, haloMaterial) {
  if (!spec) return;
  const box = new Box3();
  const size = new Vector3();
  root.traverse((node) => {
    if (node.parent !== root || groupOf(node) !== 'LIGHTS' || !hasGeometry(node)) return;
    box.setFromObject(node).getSize(size);
    if (size.y > 0.08 || size.x < 1 || size.z < 1) return;
    const y = box.min.y - 0.004 - node.position.y;
    const cx = (box.min.x + box.max.x) / 2 - node.position.x;
    const cz = (box.min.z + box.max.z) / 2 - node.position.z;
    const edges = [
      { length: size.x, x: cx, z: box.max.z - node.position.z, turn: 0 },
      { length: size.x, x: cx, z: box.min.z - node.position.z, turn: 0 },
      { length: size.z, x: box.max.x - node.position.x, z: cz, turn: Math.PI / 2 },
      { length: size.z, x: box.min.x - node.position.x, z: cz, turn: Math.PI / 2 },
    ];
    for (const edge of edges) {
      const halo = new Mesh(new PlaneGeometry(edge.length + spec.width * 0.6, spec.width), haloMaterial);
      halo.rotation.set(Math.PI / 2, 0, edge.turn, 'YXZ'); // facing down, on the soffit
      halo.position.set(edge.x, y, edge.z);
      halo.renderOrder = 1;
      halo.name = 'LM_StripHalo';
      halo.userData.maquette_anchor = true; // decorative child, not kit geometry
      node.add(halo);
    }
  });
}

/**
 * Widen thin bars in a merged geometry about their own centre lines.
 * Bars are found as connected pieces after welding coincident vertices.
 */
function thickenBars(geometry, factor, maxSection) {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  const count = position.count;
  const parent = new Int32Array(count);
  const weld = new Map();
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(position.getX(i) * 2e3)}|${Math.round(position.getY(i) * 2e3)}|${Math.round(position.getZ(i) * 2e3)}`;
    const first = weld.get(key);
    if (first === undefined) { weld.set(key, i); parent[i] = i; } else parent[i] = first;
  }
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) { const next = parent[i]; parent[i] = root; i = next; }
    return root;
  };
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : count / 3;
  const at = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triangles; t += 1) {
    const a = find(at(t, 0));
    const b = find(at(t, 1));
    const c = find(at(t, 2));
    parent[b] = a;
    parent[find(c)] = a;
  }
  const pieces = new Map();
  for (let i = 0; i < count; i += 1) {
    const root = find(i);
    let piece = pieces.get(root);
    if (!piece) { piece = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], ids: [] }; pieces.set(root, piece); }
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    for (let k = 0; k < 3; k += 1) { piece.min[k] = Math.min(piece.min[k], p[k]); piece.max[k] = Math.max(piece.max[k], p[k]); }
    piece.ids.push(i);
  }
  let changed = 0;
  for (const piece of pieces.values()) {
    const size = piece.max.map((value, k) => value - piece.min[k]);
    const long = size.indexOf(Math.max(...size));
    const scale = [1, 1, 1];
    for (let k = 0; k < 3; k += 1) if (k !== long && size[k] < maxSection) scale[k] = factor;
    if (scale.every((value) => value === 1)) continue;
    const centre = piece.min.map((value, k) => (value + piece.max[k]) / 2);
    for (const i of piece.ids) {
      position.setXYZ(i,
        centre[0] + (position.getX(i) - centre[0]) * scale[0],
        centre[1] + (position.getY(i) - centre[1]) * scale[1],
        centre[2] + (position.getZ(i) - centre[2]) * scale[2]);
    }
    changed += 1;
  }
  if (changed) {
    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return changed;
}

/**
 * Look-development refinements of the rest pose: a broader, deeper plinth and
 * stone slabs with visible thickness, as in the approved theme. Tops of floors
 * and the roof soffit keep their height, so furniture, columns, glazing and the
 * light strips stay on their joints. Runs before the scene adapter captures
 * rest transforms; the adapter then adds its pose deltas to these positions.
 */
function refineProportions(root, spec) {
  if (!spec) return { plinthBottom: 0.09 };
  root.updateMatrixWorld(true);
  const drawable = [];
  root.traverse((node) => { if (node.parent === root && hasGeometry(node)) drawable.push(node); });
  const box = new Box3();
  const one = (x, y, z) => new Vector3(x, y, z);
  let plinthBottom = 0.09;

  const plinth = drawable.filter((node) => groupOf(node) === 'PLINTH');
  if (plinth.length) {
    const bounds = new Box3();
    for (const node of plinth) bounds.union(box.setFromObject(node));
    const pivot = one(0, bounds.max.y, 0);
    const scale = one(spec.plinth.scaleX, spec.plinth.scaleY, spec.plinth.scaleZ);
    for (const node of plinth) scaleAbout(node, pivot, scale);
    plinthBottom = pivot.y - (pivot.y - bounds.min.y) * scale.y;
  }

  const stone = (ids) => drawable.filter((node) => ids.includes(idOf(node)));
  for (const node of stone(['Roof_travertine'])) {
    const bounds = box.setFromObject(node).clone();
    scaleAbout(node, one(0, bounds.min.y, 0), one(1, spec.roofThickness, 1));
  }
  let lowered = 0;
  for (const node of stone(['Floor_upper_travertine', 'Floor_upper_front_bridge', 'Floor_upper_rear_bridge'])) {
    const bounds = box.setFromObject(node).clone();
    scaleAbout(node, one(0, bounds.max.y, 0), one(1, spec.upperFloorThickness, 1));
    lowered = (bounds.max.y - bounds.min.y) * (spec.upperFloorThickness - 1);
  }
  if (lowered > 0) {
    // The lower ceiling strips sit on the underside of the upper floor.
    for (const node of drawable) {
      if (groupOf(node) !== 'LIGHTS') continue;
      const centre = box.setFromObject(node).getCenter(new Vector3());
      if (centre.y < 5) {
        node.position.y -= lowered;
        node.updateMatrixWorld(true);
      }
    }
  }
  if (spec.glazingBars) {
    const done = new Set();
    root.traverse((mesh) => {
      if (!mesh.isMesh || done.has(mesh.geometry) || mesh.material?.name !== 'MAT_Polished_Bronze_Edge') return;
      let owner = mesh;
      while (owner.parent && owner.parent !== root) owner = owner.parent;
      if (groupOf(owner) !== 'GLAZING') return;
      done.add(mesh.geometry);
      thickenBars(mesh.geometry, spec.glazingBars.inPlane, spec.glazingBars.maxSection);
    });
  }
  return { plinthBottom };
}

/**
 * Load a GLB from a URL, from its bytes, or from a function that resolves to
 * its bytes. The stock loader decodes embedded images with fetch() of a blob:
 * URL, and quietly leaves a material without its image when that is refused,
 * as a strict content security policy does. One more pass over the same bytes
 * then decodes the images through image elements (img-src) instead.
 */
async function loadModel(source) {
  // Several sources: the first that loads wins. The compressed model needs the
  // meshopt decoder (WebAssembly); the quantized one needs nothing extra.
  if (Array.isArray(source)) {
    let firstError;
    for (const candidate of source) {
      // Skip a compressed file without downloading it when the decoder cannot run.
      const needsDecoder = (typeof candidate === 'string' && /meshopt/i.test(candidate)) || candidate?.meshopt === true;
      if (needsDecoder && !(await MeshoptDecoder.ready.then(() => true, () => false))) continue;
      try {
        return await loadModel(candidate);
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError ?? new Error('No model source');
  }
  const bytes = await modelBytes(source);
  const path = typeof source === 'string' ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const compressed = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536))).includes('EXT_meshopt_compression');
  if (compressed) await MeshoptDecoder.ready; // rejects where WebAssembly is refused
  const makeLoader = () => {
    const loader = new GLTFLoader();
    if (compressed) loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
  };
  let model = await makeLoader().parseAsync(bytes, path);
  if (await imagesMissing(model)) {
    const loader = makeLoader();
    loader.register((parser) => {
      const images = new TextureLoader(parser.options.manager);
      images.setCrossOrigin(parser.options.crossOrigin);
      images.setRequestHeader(parser.options.requestHeader);
      parser.textureLoader = images;
      return { name: 'LM_image_element_textures' };
    });
    try {
      const second = await loader.parseAsync(bytes, path);
      if (!(await imagesMissing(second))) model = second;
    } catch {
      // keep the first: still the right shapes, in plain material colours
    }
  }
  restoreQuantizedNodes(model.scene);
  return model;
}

/**
 * Quantized models (tools/compress-model.mjs) carry each mesh's dequantizing
 * offset and scale on its node, and the node's own translation in
 * extras.lm_rest. Put the dequantization back into float positions and the
 * node back at its rest translation, so the rest of the scene code sees the
 * same transforms as the uncompressed export. Normals and texture
 * coordinates stay quantized (the shaders read them as they are).
 */
function restoreQuantizedNodes(root) {
  const rest = new Matrix4();
  const correction = new Matrix4();
  const point = new Vector3();
  // Identical quantized data may be stored once and used by several meshes,
  // each with its own dequantization: every mesh gets its own float copy.
  const quantized = new Map();
  root.traverse((object) => {
    const translation = object.userData?.lm_rest?.translation;
    if (!translation) return;
    object.updateMatrix();
    rest.makeTranslation(...translation);
    correction.copy(rest).invert().multiply(object.matrix);
    const meshes = object.isMesh ? [object] : object.children.filter((child) => child.isMesh);
    for (const mesh of meshes) {
      if (quantized.has(mesh.geometry)) {
        const copy = mesh.geometry.clone();
        copy.setAttribute('position', quantized.get(mesh.geometry));
        mesh.geometry = copy;
      }
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      quantized.set(geometry, position);
      const values = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(correction);
        values[i * 3] = point.x;
        values[i * 3 + 1] = point.y;
        values[i * 3 + 2] = point.z;
      }
      geometry.setAttribute('position', new BufferAttribute(values, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    object.position.set(...translation);
    object.quaternion.identity();
    object.scale.set(1, 1, 1);
    object.updateMatrix();
    delete object.userData.lm_rest;
  });
}

async function modelBytes(source) {
  if (typeof source === 'function') return source();
  if (source instanceof ArrayBuffer) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Model unavailable (${response.status})`);
  return response.arrayBuffer();
}

async function imagesMissing(model) {
  if (!model.parser?.json?.textures?.length) return false;
  const textures = await model.parser.getDependencies('texture');
  return textures.some((texture) => !texture);
}

export async function createStage({
  canvas,
  assets,
  manifest,
  look = LOOK,
  onFirstFrame,
  onContextLost,
} = {}) {
  if (!canvas) throw new TypeError('createStage needs a canvas');
  if (!manifest) throw new TypeError('createStage needs the scene manifest');

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'default',
    stencil: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = TONE_MAPPING[look.renderer.toneMapping] ?? AgXToneMapping;
  renderer.toneMappingExposure = look.renderer.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = look.shadow.type === 'pcf' ? PCFShadowMap : VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new Scene();
  const turntable = new Group();
  turntable.name = 'LivingMaquetteTurntable';
  scene.add(turntable);

  // ---------------------------------------------------------------- camera
  const camera = new PerspectiveCamera(look.camera.fovDeg, 1, look.camera.near, look.camera.far);
  const cameraTarget = new Vector3(...look.camera.target);
  const view = {
    stage: { x: 0, y: 0, width: 1, height: 1 },
    viewport: { width: 1, height: 1 },
    zoom: 1,
    // Frame point (0..1 across, 0..1 down) that stays put while zooming.
    anchor: [0.5, 0.5],
    targetOffset: new Vector3(),
    elevationOffsetDeg: 0,
    azimuthOffsetDeg: 0,
  };

  function placeCamera() {
    // Two-point perspective, as in the approved theme: the eye sits near the
    // upper floor and looks level, so verticals stay parallel, the floors read
    // from above and the roof soffit with its light line reads from below.
    // The frame is then shifted (not tilted) on to the stage rectangle.
    const spec = look.camera;
    const azimuth = (spec.azimuthDeg + view.azimuthOffsetDeg) * DEG;
    const pitch = (spec.pitchDeg + view.elevationOffsetDeg) * DEG;
    const distance = spec.distance;
    const target = cameraTarget.clone().add(view.targetOffset);
    camera.position.set(
      target.x - Math.sin(azimuth) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(azimuth) * Math.cos(pitch) * distance,
    );
    camera.lookAt(target);

    const { stage, viewport } = view;
    // Pixels per world unit on the plane through the target.
    const fit = Math.min(stage.width / spec.frame.width, stage.height / spec.frame.height);
    const scale = fit * view.zoom;
    const full = 2 * distance * Math.tan((spec.fovDeg * DEG) / 2) * scale; // square reference frustum
    // The frame centre lands on the stage centre (a zoom keeps its anchor
    // point where it was instead); the target is offset from the centre.
    const centreX = stage.x + stage.width / 2 + (1 - view.zoom) * (view.anchor[0] - 0.5) * spec.frame.width * fit;
    const centreY = stage.y + stage.height / 2 + (1 - view.zoom) * (view.anchor[1] - 0.5) * spec.frame.height * fit;
    const principalX = centreX - spec.frame.offsetX * scale;
    const principalY = centreY + spec.frame.offsetY * scale;
    camera.aspect = 1;
    camera.fov = spec.fovDeg;
    camera.setViewOffset(full, full, full / 2 - principalX, full / 2 - principalY, viewport.width, viewport.height);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- lights
  // A distant, undecayed spot stands in for the sun so that it can carry a
  // cookie: the soft shadow of a branch that dapples the stone.
  const key = new SpotLight(0xffffff, 1, 0, look.shadow.coneDeg * DEG, look.shadow.penumbra, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(look.shadow.mapSize, look.shadow.mapSize);
  key.shadow.camera.near = look.shadow.near;
  key.shadow.camera.far = look.shadow.far;
  key.shadow.radius = look.shadow.radius;
  key.shadow.blurSamples = look.shadow.blurSamples;
  key.shadow.bias = look.shadow.bias;
  key.shadow.normalBias = look.shadow.normalBias;
  key.target.position.set(1.2, 2.0, -0.8);
  const cookie = createKeyCookie(look.cookie ?? {});
  key.map = cookie.texture;
  scene.add(key, key.target);

  const rim = new DirectionalLight(0xffffff, 0);
  rim.position.set(11, 6, -10);
  rim.target.position.set(0, 3, 0);
  scene.add(rim, rim.target);

  const fill = new HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(fill);

  // ---------------------------------------------------------------- ground
  // Shadow catcher over the page background. The patch lets the catcher see
  // the key cookie as well, so the dapples continue from stone to studio floor.
  const groundMaterial = new ShadowMaterial({ color: new Color(look.ground.color), opacity: 0.3 });
  groundMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
      `float lmMask = getShadowMask();
      #if NUM_SPOT_LIGHT_MAPS > 0
        vec3 lmCoord = vSpotLightCoord[ 0 ].xyz / vSpotLightCoord[ 0 ].w;
        if ( all( lessThan( abs( lmCoord * 2. - 1. ), vec3( 1.0 ) ) ) ) {
          lmMask *= dot( texture2D( spotLightMap[ 0 ], lmCoord.xy ).rgb, vec3( 0.3333 ) );
        }
      #endif
      gl_FragColor = vec4( color, opacity * ( 1.0 - lmMask ) );`,
    );
  };
  const ground = new Mesh(new PlaneGeometry(look.ground.size, look.ground.size), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'StudioGroundShadowCatcher';
  scene.add(ground);

  // ---------------------------------------------------------------- assets
  const gltf = await loadModel(assets.mainModel);
  const mainRoot = gltf.scene;
  mainRoot.name = 'LivingMaquetteMain';
  turntable.add(mainRoot);

  // The prefiltered environment is assigned per material rather than through
  // scene.environment, because a scene environment replaces each material's
  // own envMapIntensity and stone and bronze need very different amounts.
  let environmentMap = null;
  const environmentLit = new Set();
  {
    const pmrem = new PMREMGenerator(renderer);
    let source = null;
    if (assets.environment) {
      // Optional: the kit's E01_studio_warm.hdr through the stock loader.
      try {
        const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
        source = await new HDRLoader().loadAsync(assets.environment);
      } catch {
        source = null;
      }
    }
    source ??= buildStudioEnvironment(look.environment);
    environmentMap = pmrem.fromEquirectangular(source).texture;
    source.dispose();
    pmrem.dispose();
  }

  // ------------------------------------------------------------- materials
  const emissiveMaterials = new Set();
  const glassSpec = look.materials.glass;
  const glassMaterial = new MeshStandardMaterial({
    name: 'LM_Runtime_Glass',
    color: new Color(glassSpec.tint).multiplyScalar(glassSpec.veil),
    roughness: glassSpec.roughness,
    metalness: 0,
    envMap: environmentMap,
    envMapIntensity: glassSpec.reflect,
    transparent: true,
    opacity: glassSpec.coverage,
    side: DoubleSide,
    depthWrite: false,
    // Premultiplied "over": reflections add on top, the tint dims what is behind.
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  glassMaterial.userData.baseEnv = glassSpec.reflect;
  environmentLit.add(glassMaterial);

  function tuneMaterial(material) {
    const m = look.materials;
    const apply = (spec) => {
      if (spec.color) material.color.multiply(new Color(spec.color));
      if (spec.linear) material.color.setRGB(...spec.linear);
      if (spec.roughness !== undefined) material.roughness = spec.roughness;
      if (spec.metalness !== undefined) material.metalness = spec.metalness;
      if (spec.envMapIntensity !== undefined) material.userData.baseEnv = spec.envMapIntensity;
    };
    const emit = (spec) => {
      material.emissive = new Color(spec.color);
      material.emissiveIntensity = spec.intensity;
      material.userData.baseEmissive = spec.intensity;
      emissiveMaterials.add(material);
    };
    switch (material.name) {
      case 'MAT_Travertine_Ivory': apply(m.travertine); break;
      case 'MAT_Champagne_Bronze': apply(m.plinthBronze); break;
      case 'MAT_Bronze_Seam': apply(m.bronzeSeam); break;
      case 'MAT_Polished_Bronze_Edge': apply(m.bronzeEdge); break;
      case 'Furnishing_Champagne_Bronze': apply(m.furnishingBronze); break;
      case 'Furnishing_Dark_Bronze': apply(m.darkBronze); break;
      case 'MAT_Warm_Walnut': apply(m.walnut); break;
      case 'Furnishing_Ivory_Leather':
      case 'Furnishing_Ivory_Piping':
      case 'Furnishing_Ivory_Ceramic':
      case 'Furnishing_Cream_Cover':
      case 'Furnishing_Paper':
      case 'Furnishing_Stone_Pedestal': apply(m.ivory); break;
      case 'Furnishing_Leaf_Light': apply(m.leafLight); break;
      case 'Furnishing_Leaf_Olive': apply(m.leafOlive); break;
      case 'Furnishing_Leaf_Dark': apply(m.leafDark); break;
      case 'MAT_Light_3000K': emit(m.emissiveStrip); break;
      case 'MAT_Shelf_Ambient_Glow': emit(m.shelfGlow); break;
      default: break;
    }
    if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (material.isMeshStandardMaterial) {
      material.userData.baseEnv ??= m.defaultEnv;
      material.envMap = environmentMap;
      environmentLit.add(material);
    }
  }

  const tuned = new Set();
  function prepareRoot(root) {
    root.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some((material) => material.name === 'MAT_Architectural_Clear_Glass')) {
        node.material = glassMaterial;
        node.castShadow = false;
        node.receiveShadow = false;
        node.renderOrder = 2;
        return;
      }
      const emissive = materials.some((material) => material.name === 'MAT_Light_3000K');
      node.castShadow = !emissive;
      node.receiveShadow = !emissive;
      for (const material of materials) {
        if (tuned.has(material)) continue;
        tuned.add(material);
        tuneMaterial(material);
      }
    });
  }
  prepareRoot(mainRoot);
  const { plinthBottom } = refineProportions(mainRoot, look.proportions);
  // Contact shadow under the plinth. It sits on the turntable so the oval
  // turns with the model.
  const contactTexture = makeContactTexture();
  const contactMaterial = new MeshBasicMaterial({
    map: contactTexture,
    color: new Color(look.contact.color),
    transparent: true,
    opacity: look.contact.opacity,
    depthWrite: false,
    toneMapped: false,
  });
  {
    const bounds = new Box3();
    const box = new Box3();
    mainRoot.traverse((node) => {
      if (node.parent === mainRoot && groupOf(node) === 'PLINTH' && hasGeometry(node)) bounds.union(box.setFromObject(node));
    });
    const size = bounds.getSize(new Vector3());
    const contact = new Mesh(new PlaneGeometry(size.x * look.contact.spread, size.z * look.contact.spread), contactMaterial);
    contact.rotation.x = -Math.PI / 2;
    contact.position.set((bounds.min.x + bounds.max.x) / 2, plinthBottom - 0.002, (bounds.min.z + bounds.max.z) / 2);
    contact.renderOrder = -1;
    contact.name = 'LM_PlinthContactShadow';
    turntable.add(contact);
  }
  const haloTexture = makeHaloTexture();
  const haloMaterial = new MeshBasicMaterial({
    map: haloTexture,
    color: new Color(look.materials.stripHalo.color),
    transparent: true,
    opacity: look.materials.stripHalo.strength,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  haloMaterial.userData.baseOpacity = look.materials.stripHalo.strength;
  addStripHalos(mainRoot, look.materials.stripHalo, haloMaterial);
  ground.position.y = plinthBottom - 0.004;

  const adapter = createMaquetteSceneAdapter({ root: mainRoot, manifest });
  adapter.setDestinationVisual('lounge');
  const modelBounds = new Box3().setFromObject(mainRoot);

  // --------------------------------------------------------------- workspace
  let workspaceRoot = null;
  let workspacePromise = null;
  function loadWorkspace() {
    if (workspaceRoot) return Promise.resolve(workspaceRoot);
    if (!assets.workspaceModel) return Promise.reject(new Error('No workspace model configured'));
    workspacePromise ??= loadModel(assets.workspaceModel).then((result) => {
      workspaceRoot = result.scene;
      workspaceRoot.name = 'LivingMaquetteWorkspace';
      workspaceRoot.visible = false;
      prepareRoot(workspaceRoot);
      turntable.add(workspaceRoot);
      adapter.attachWorkspaceRoot(workspaceRoot);
      applyLight();
      invalidate(true);
      return workspaceRoot;
    }).catch((error) => {
      workspacePromise = null;
      throw error;
    });
    return workspacePromise;
  }

  // ---------------------------------------------------------- light blending
  const lightState = { mix: 0, emissive: 1 }; // mix: 0 = warm, 1 = soft; emissive: authored level of the light lines
  const colourA = new Color();
  const colourB = new Color();
  const towards = new Vector3();

  function applyLight() {
    const a = look.light.warm;
    const b = look.light.soft;
    const t = lightState.mix;
    key.color.copy(colourA.set(a.keyColor)).lerp(colourB.set(b.keyColor), t);
    key.intensity = lerp(a.keyIntensity, b.keyIntensity, t);
    towards.set(
      lerp(a.keyTowards[0], b.keyTowards[0], t),
      lerp(a.keyTowards[1], b.keyTowards[1], t),
      lerp(a.keyTowards[2], b.keyTowards[2], t),
    ).normalize();
    key.position.copy(key.target.position).addScaledVector(towards, -look.shadow.distance);
    key.shadow.intensity = lerp(a.shadowIntensity, b.shadowIntensity, t);
    cookie.setStrength(lerp(a.cookie, b.cookie, t));
    fill.color.copy(colourA.set(a.fillSky)).lerp(colourB.set(b.fillSky), t);
    fill.groundColor.copy(colourA.set(a.fillGround)).lerp(colourB.set(b.fillGround), t);
    fill.intensity = lerp(a.fillIntensity, b.fillIntensity, t);
    rim.color.copy(colourA.set(a.rimColor)).lerp(colourB.set(b.rimColor), t);
    rim.intensity = lerp(a.rimIntensity, b.rimIntensity, t);
    const environment = lerp(a.envIntensity, b.envIntensity, t);
    for (const material of environmentLit) material.envMapIntensity = material.userData.baseEnv * environment;
    groundMaterial.opacity = lerp(a.groundShadowOpacity, b.groundShadowOpacity, t);
    renderer.toneMappingExposure = look.renderer.exposure * lerp(a.exposure, b.exposure, t);
    const emissive = lerp(a.emissive, b.emissive, t) * lightState.emissive;
    for (const material of emissiveMaterials) {
      material.emissiveIntensity = material.userData.baseEmissive * emissive;
    }
    haloMaterial.opacity = haloMaterial.userData.baseOpacity * emissive;
  }

  // -------------------------------------------------------- render scheduling
  let disposed = false;
  let frameHandle = 0;
  let needsRender = true;
  let needsShadow = true;
  let lastRender = 0;
  let firstFrameDone = false;
  const animations = new Set();
  const minInterval = 1000 / look.renderer.fpsCap;
  const stats = { frames: 0, shadowUpdates: 0, lastFrameMs: 0 };

  function renderNow(now) {
    if (needsShadow) {
      renderer.shadowMap.needsUpdate = true;
      needsShadow = false;
      stats.shadowUpdates += 1;
    }
    const started = performance.now();
    renderer.render(scene, camera);
    stats.lastFrameMs = performance.now() - started;
    stats.frames += 1;
    needsRender = false;
    lastRender = now;
    if (!firstFrameDone) {
      firstFrameDone = true;
      onFirstFrame?.();
    }
  }

  function tick(now) {
    frameHandle = 0;
    if (disposed || document.hidden) return; // resumed by visibilitychange
    let active = false;
    for (const animation of [...animations]) {
      if (animation(now) === false) animations.delete(animation);
      else active = true;
    }
    if ((needsRender || active) && now - lastRender >= minInterval - 1) renderNow(now);
    if (active || needsRender) schedule();
  }

  function schedule() {
    if (!frameHandle && !disposed) frameHandle = requestAnimationFrame(tick);
  }

  function invalidate(shadow = false) {
    needsRender = true;
    if (shadow) needsShadow = true;
    schedule();
  }

  /** Run `step(now)` every frame until it returns false. */
  function animate(step) {
    animations.add(step);
    schedule();
    return () => animations.delete(step);
  }

  function onVisibility() {
    if (!document.hidden) invalidate();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function onLost(event) {
    event.preventDefault();
    onContextLost?.();
  }
  canvas.addEventListener('webglcontextlost', onLost);

  // ------------------------------------------------------------- public state
  let yaw = 0;
  let explodedAmount = null;

  function resize(viewport, stage) {
    view.viewport = { width: Math.max(1, viewport.width), height: Math.max(1, viewport.height) };
    view.stage = { ...stage };
    const cssPixels = view.viewport.width * view.viewport.height;
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      look.renderer.maxPixelRatio,
      Math.sqrt(look.renderer.maxPixels / cssPixels),
    );
    renderer.setPixelRatio(Math.max(0.75, ratio));
    renderer.setSize(view.viewport.width, view.viewport.height, false);
    placeCamera();
    invalidate();
  }

  applyLight();
  placeCamera();

  return {
    renderer,
    scene,
    camera,
    turntable,
    mainRoot,
    adapter,
    modelBounds,
    look,
    stats,
    lights: { key, rim, fill },
    materials: { glass: glassMaterial, ground: groundMaterial, tuned },
    invalidate,
    animate,
    resize,
    loadWorkspace,
    get workspaceRoot() { return workspaceRoot; },
    get yaw() { return yaw; },
    setYaw(value) {
      if (value === yaw) return;
      yaw = value;
      turntable.rotation.y = value;
      invalidate(true);
    },
    get lightMix() { return lightState.mix; },
    setLightMix(value) { this.setLighting({ mix: value }); },
    /** mix: 0 warm .. 1 soft. emissive: authored level of the light lines, 0..1. */
    setLighting({ mix = lightState.mix, emissive = lightState.emissive } = {}) {
      const nextMix = clamp01(mix);
      const nextEmissive = clamp01(emissive);
      if (nextMix === lightState.mix && nextEmissive === lightState.emissive) return;
      const shadowChanged = nextMix !== lightState.mix;
      lightState.mix = nextMix;
      lightState.emissive = nextEmissive;
      applyLight();
      invalidate(shadowChanged);
    },
    setView({ zoom, anchor, targetOffset, elevationOffsetDeg, azimuthOffsetDeg } = {}) {
      let changed = arguments.length === 0 || arguments[0] === undefined || Object.keys(arguments[0]).length === 0;
      if (zoom !== undefined && zoom !== view.zoom) { view.zoom = zoom; changed = true; }
      if (anchor && (anchor[0] !== view.anchor[0] || anchor[1] !== view.anchor[1])) { view.anchor = [anchor[0], anchor[1]]; changed = true; }
      if (targetOffset && (targetOffset[0] !== view.targetOffset.x || targetOffset[1] !== view.targetOffset.y || targetOffset[2] !== view.targetOffset.z)) {
        view.targetOffset.set(...targetOffset);
        changed = true;
      }
      if (elevationOffsetDeg !== undefined && elevationOffsetDeg !== view.elevationOffsetDeg) { view.elevationOffsetDeg = elevationOffsetDeg; changed = true; }
      if (azimuthOffsetDeg !== undefined && azimuthOffsetDeg !== view.azimuthOffsetDeg) { view.azimuthOffsetDeg = azimuthOffsetDeg; changed = true; }
      if (!changed) return;
      placeCamera();
      invalidate();
    },
    getView() {
      return {
        zoom: view.zoom,
        anchor: [...view.anchor],
        targetOffset: view.targetOffset.toArray(),
        elevationOffsetDeg: view.elevationOffsetDeg,
        azimuthOffsetDeg: view.azimuthOffsetDeg,
      };
    },
    /** Decorative pose only. 0 = ready pose, 1 = exploded pose. */
    setExplodedAmount(amount) {
      if (amount === explodedAmount) return adapter.getState();
      explodedAmount = amount;
      const state = adapter.setExplodedAmount(amount);
      invalidate(true);
      return state;
    },
    setPhaseVisibility(phase) {
      const state = adapter.setPhaseVisibility(phase);
      invalidate(true);
      return state;
    },
    setDestinationVisual(destination) {
      const result = adapter.setDestinationVisual(destination);
      invalidate(true);
      return result;
    },
    renderOnce() { renderNow(performance.now()); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameHandle);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      animations.clear();
      scene.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
      environmentMap?.dispose();
      haloTexture.dispose();
      contactTexture.dispose();
      cookie.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
