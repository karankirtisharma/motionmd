import { Mesh, type PerspectiveCamera, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

// The 21 first-use mirror variants measured in the opening 15-second tour
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
  ]
];

export function openingTourShaderMeshes(scene: Scene): Mesh[] {
  const targets: Mesh[] = [];
  scene.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (OPENING_TOUR_SHADERS.some(([name, material]) => object.name === name && materials.some(value => value.name === material))) targets.push(object);
  });
  return targets;
}

/** Must run inside the target pass's real render context and camera. The pinned
 * r186 individual-object compile uses targetScene for identical light/cache keys.
 * Never reparent, change visibility/materials, or submit an extra rendered frame. */
export async function warmOpeningTourShaders(renderer: Pick<WebGPURenderer, 'compileAsync'>, scene: Scene,
  camera: PerspectiveCamera, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void) {
  const targets = openingTourShaderMeshes(scene);
  let completed = 0;
  onProgress?.(0, targets.length);
  for (const mesh of targets) {
    signal?.throwIfAborted();
    const culled = mesh.frustumCulled;
    try {
      mesh.frustumCulled = false;
      await renderer.compileAsync(mesh, camera, scene);
    } finally { mesh.frustumCulled = culled; }
    signal?.throwIfAborted();
    completed++;
    onProgress?.(completed, targets.length);
  }
  return completed;
}
