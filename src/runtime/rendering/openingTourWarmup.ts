import { Group, Mesh, type PerspectiveCamera, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { UPPER_GALLERY_SHADERS } from './upperGalleryShaders.ts';

// The 22 first-use mirror variants measured in the opening tour and TV movement
// on 3 Nov 2026. Do not expand this to every material/room: broad prewarming
// previously increased startup significantly. Match both object and material
// so a renamed/replaced asset is skipped instead of warming unrelated objects.
export const OPENING_TOUR_SHADERS: ReadonlyArray<readonly [string, string]> = [
  [
    "Exterior baked | extension_foundation001",
    "lounge__EH54 | scanned cream limestone panels"
  ],
  [
    "extension_foundation001_1",
    "lounge__PL86 | ground wing polished existing marble"
  ],
  [
    "Box_Founder_polished_floor002_66",
    "founder__PR94 | charcoal library binding"
  ],
  [
    "Box_Founder_polished_floor002_65",
    "founder__PR94 | olive woven binding"
  ],
  [
    "Box_Founder_polished_floor002_36",
    "founder__HF89 | black anodised precision metal"
  ],
  [
    "Box_Founder_polished_floor002_19",
    "founder__FR79 | FR83 dark walnut cabinet veneer"
  ],
  [
    "extension_foundation001_9",
    "lounge__PL78 | circular hand woven wool"
  ],
  [
    "Box_Hall_rear_full-height_limestone001_15",
    "Recovered portfolio 04"
  ],
  [
    "Box_Founder_polished_floor002_20",
    "founder__FR79 | FR83 natural taupe wool"
  ],
  [
    "Box_Studio_textured_rug002_6",
    "studio__MF reference | bronze"
  ],
  [
    "Box_Founder_polished_floor002_69",
    "founder__PR94 | muted celadon glaze"
  ],
  [
    "Box_Entrance-side_upper_bridge002_6",
    "gallery__Satin bronze"
  ],
  [
    "Box_Founder_polished_floor002_57",
    "founder__PR94 | satin champagne bronze"
  ],
  [
    "Box_Founder_polished_floor002_54",
    "founder__PR94 | warm cut paper fibres"
  ],
  [
    "Box_Founder_polished_floor002_30",
    "founder__FR84 | charcoal buckram"
  ],
  [
    "Box_Founder_polished_floor002_31",
    "founder__FR84 | warm grey linen"
  ],
  [
    "Box_Founder_polished_floor002_60",
    "founder__PR94 | oiled walnut miniature timber"
  ],
  [
    "Box_Founder_polished_floor002_56",
    "founder__PR94 | bone linen binding"
  ],
  [
    "Box_Founder_polished_floor002_63",
    "founder__PR94 | charcoal basalt"
  ],
  [
    "Box_Founder_polished_floor002_62",
    "founder__PR94 | honed ivory limestone"
  ],
  [
    "Box_Founder_polished_floor002_59",
    "founder__PR94 | petrol cloth binding"
  ],
  [
    "Box_Founder_polished_floor002_44 | cell 3",
    "founder__potted_plant_01_leaves"
  ]
];

const reflectionMaterials = new Map<string, Set<string>>();
for (const [object, material] of [...OPENING_TOUR_SHADERS, ...UPPER_GALLERY_SHADERS]) {
  let names = reflectionMaterials.get(object);
  if (!names) reflectionMaterials.set(object, names = new Set());
  names.add(material);
}

export function openingTourShaderMeshes(scene: Scene): Mesh[] {
  const targets: Mesh[] = [];
  scene.traverse(object => {
    const names = reflectionMaterials.get(object.name);
    if (!names || !(object instanceof Mesh) || !object.visible) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(value => value.visible && names.has(value.name))) return;
    // The measured visitor skins are eligible while their tour parent is hidden.
    // Borrow them for compilation without making that parent visible in the room.
    if (!('isSkinnedMesh' in object)) {
      for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return;
    }
    targets.push(object);
  });
  return targets;
}

/** Compile the measured objects with the live scene's lights and cache keys.
 * The detached selection only borrows references for the render-list traversal.
 * The actual meshes keep their real parents and precomputed world matrices. */
export async function warmOpeningTourShaders(renderer: Pick<WebGPURenderer, 'compileAsync'>, scene: Scene,
  camera: PerspectiveCamera, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void,
  drawPrepared?: (targets: readonly Mesh[]) => void) {
  signal?.throwIfAborted();
  const targets = openingTourShaderMeshes(scene);
  onProgress?.(0, targets.length);
  if (!targets.length) return 0;
  const selection = new Group();
  selection.matrixWorldAutoUpdate = false;

  const culling = targets.map(mesh => mesh.frustumCulled);
  try {
    for (const mesh of targets) mesh.frustumCulled = false;
    // compileAsync still builds its JS node graphs synchronously. Bound each
    // submission and return to the browser between batches, with the same scene,
    // light cache, target and camera as before.
    for (let start = 0; start < targets.length; start += 2) {
      signal?.throwIfAborted();
      selection.children = targets.slice(start, start + 2);
      await renderer.compileAsync(selection, camera, scene);
      signal?.throwIfAborted();
      drawPrepared?.(selection.children as Mesh[]);
      onProgress?.(Math.min(start + 2, targets.length), targets.length);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();

  } finally {
    targets.forEach((mesh, index) => { mesh.frustumCulled = culling[index]; });
    selection.children.length = 0;
  }
  signal?.throwIfAborted();
  return targets.length;
}
