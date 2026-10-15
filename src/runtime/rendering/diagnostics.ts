import { Color, Material, Mesh, Object3D, Texture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, texture, uv, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { unfilteredRoughness } from './specularFiltering';

export type DiagnosticMode = 'full' | 'albedo' | 'baked' | 'no-normals' | 'no-shadows' | 'no-gi' | 'no-reflections' | 'no-ao';
type Surface = Material & { color?: Color; colorNode?: MeshBasicNodeMaterial['colorNode']; map?: Texture | null; lightMap?: Texture | null; lightMapIntensity?: number; normalMap?: Texture | null; bumpMap?: Texture | null; clearcoatNormalMap?: Texture | null; normalNode?: unknown; clearcoatNormalNode?: unknown; transmission?: number; metalness?: number; metalnessMap?: Texture | null };

/** Review-only material substitutions. Shared source texture data is never modified. */
export class RenderDiagnostics {
  private originals = new Map<Mesh, Material | Material[]>();
  private variants = new Map<Material, Map<DiagnosticMode, Material>>();

  constructor(private root: Object3D) {}

  setMode(mode: DiagnosticMode) {
    this.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (!this.originals.has(object)) this.originals.set(object, object.material);
      const original = this.originals.get(object)!;
      if (mode === 'full' || mode === 'no-shadows') { object.material = original; return; }
      const replace = (material: Material) => this.variant(material as Surface, mode);
      object.material = Array.isArray(original) ? original.map(replace) : replace(original);
    });
  }

  private variant(source: Surface, mode: DiagnosticMode): Material {
    let modes = this.variants.get(source);
    if (!modes) { modes = new Map(); this.variants.set(source, modes); }
    const cached = modes.get(mode);
    if (cached) return cached;
    let result: Surface;
    if (mode === 'no-normals' || mode === 'no-gi' || mode === 'no-reflections' || mode === 'no-ao') {
      result = source.clone() as Surface;
      if (mode === 'no-ao') Object.assign(result, { aoMap: null, aoMapIntensity: 0 });
      else if (mode === 'no-gi') result.lightMap = null;
      else if (mode === 'no-reflections') Object.assign(result, { envNode: vec3(0), envMapIntensity: 0 });
      else {
        result.normalMap = null; result.bumpMap = null; result.clearcoatNormalMap = null;
        result.normalNode = null; result.clearcoatNormalNode = null;
        Object.assign(result, { roughnessNode: unfilteredRoughness(source) });
      }
    } else {
      // Keep glass transparent so exterior reference cameras can inspect interior walls.
      if ((source.transmission ?? 0) > 0.1 || source.transparent) return source;
      const unlit = new MeshBasicNodeMaterial({ side: source.side, opacity: source.opacity, alphaTest: source.alphaTest });
      // Preserve reconstructed triplanar nodes and each map's actual UV channel.
      // A plain BasicMaterial silently lost those nodes and displayed atlas islands.
      const base = vec3((source.colorNode ?? (source.map
        ? diagnosticTexture(source.map).rgb.mul(color(source.color ?? new Color(1, 1, 1)))
        : color(source.color ?? new Color(1, 1, 1)))) as Node<'vec3'>);
      unlit.colorNode = base;
      if (mode === 'baked') {
        // The EXR stores E/pi. Runtime intensity is pi to convert to irradiance;
        // Three's BasicLightMapNode divides by pi once, yielding albedo * EXR.
        unlit.colorNode = source.lightMap
          ? base.mul(diagnosticTexture(source.lightMap).rgb).mul((source.lightMapIntensity ?? 1) / Math.PI)
          : vec3(0);
      }
      result = unlit;
    }
    result.name = `${source.name} | review ${mode}`;
    result.needsUpdate = true;
    modes.set(mode, result);
    return result;
  }

  dispose() {
    for (const [mesh, original] of this.originals) mesh.material = original;
    for (const modes of this.variants.values()) for (const material of modes.values()) material.dispose();
    this.originals.clear(); this.variants.clear();
  }
}

/** Match the production sampler, including EXR row orientation and authored tiling. */
function diagnosticTexture(map: Texture) {
  const sample = texture(map, uv(map.channel));
  sample.updateMatrix = true;
  return sample;
}
