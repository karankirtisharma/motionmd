import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { EnvironmentNode, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';

/** Preserve specular IBL without adding the sky's diffuse a second time over a Cycles GI bake. */
class ReflectionOnlyEnvironmentNode extends EnvironmentNode {
  setup(builder: NodeBuilder) {
    const context = builder.context as { iblIrradiance: unknown };
    const original = context.iblIrradiance;
    context.iblIrradiance = vec3(0).toVar();
    super.setup(builder);
    context.iblIrradiance = original;
    return null;
  }
}

export class BakedPhysicalMaterial extends MeshPhysicalNodeMaterial {
  setupEnvironment(builder: NodeBuilder) {
    const environment = super.setupEnvironment(builder);
    return environment ? new ReflectionOnlyEnvironmentNode(environment.envNode) : null;
  }
}

export function withBakedDiffuse(source: MeshStandardMaterial): BakedPhysicalMaterial {
  return asPhysicalNodeMaterial(source, true) as BakedPhysicalMaterial;
}

export function asPhysicalNodeMaterial(source: MeshStandardMaterial, suppressEnvironmentDiffuse = false): MeshPhysicalNodeMaterial {
  const defaults = new MeshPhysicalMaterial();
  const result = suppressEnvironmentDiffuse ? new BakedPhysicalMaterial() : new MeshPhysicalNodeMaterial();
  // NodeLibrary uses equivalent property forwarding when converting glTF materials.
  // Retain physical defaults for source materials that only use metallic-roughness.
  for (const key of Object.keys(defaults)) {
    if (key === 'id' || key === 'uuid' || key === 'type' || key.startsWith('is')) continue;
    (result as unknown as Record<string, unknown>)[key] = (defaults as unknown as Record<string, unknown>)[key];
  }
  for (const key of Object.keys(source)) {
    if (key === 'id' || key === 'uuid' || key === 'type' || key.startsWith('is')) continue;
    (result as unknown as Record<string, unknown>)[key] = (source as unknown as Record<string, unknown>)[key];
  }
  result.userData = { ...source.userData };
  defaults.dispose();
  result.needsUpdate = true;
  return result;
}
