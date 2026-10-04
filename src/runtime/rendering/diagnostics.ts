import { Color, Material, Mesh, MeshBasicMaterial, Object3D, Texture } from 'three';

export type DiagnosticMode = 'full' | 'albedo' | 'baked' | 'no-normals';
type Surface = Material & { color?: Color; map?: Texture | null; lightMap?: Texture | null; lightMapIntensity?: number; normalMap?: Texture | null; bumpMap?: Texture | null; clearcoatNormalMap?: Texture | null; normalNode?: unknown; clearcoatNormalNode?: unknown; transmission?: number; metalness?: number; metalnessMap?: Texture | null };

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
      if (mode === 'full') { object.material = original; return; }
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
    if (mode === 'no-normals') {
      result = source.clone() as Surface;
      result.normalMap = null; result.bumpMap = null; result.clearcoatNormalMap = null;
      result.normalNode = null; result.clearcoatNormalNode = null;
    } else {
      // Keep glass transparent so exterior reference cameras can inspect interior walls.
      if ((source.transmission ?? 0) > 0.1 || source.transparent) return source;
      const unlit = new MeshBasicMaterial({ color: source.color ?? new Color(1, 1, 1), map: source.map ?? null, side: source.side, opacity: source.opacity, alphaTest: source.alphaTest });
      if (mode === 'baked') {
        // The EXR stores E/pi. Runtime intensity is pi to convert to irradiance;
        // Three's BasicLightMapNode divides by pi once, yielding albedo * EXR.
        unlit.lightMap = source.lightMap ?? null;
        unlit.lightMapIntensity = source.lightMapIntensity ?? 1;
        if (!source.lightMap) unlit.color.setRGB(0, 0, 0);
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
