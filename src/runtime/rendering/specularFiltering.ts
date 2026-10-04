import { Mesh, Object3D } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Fn, glslFn, materialRoughness, wgslFn } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

// Normal-map detail smaller than a pixel should widen the specular lobe instead
// of becoming a moving pinprick. Full-resolution detail retains authored roughness.
const filterGL = glslFn(`float mdFilteredRoughness(float r, vec3 n) {
  vec3 dx=dFdx(n),dy=dFdy(n);
  float variance=.15*(dot(dx,dx)+dot(dy,dy));
  return sqrt(sqrt(min(1.0,r*r*r*r+min(variance,.0064))));
}`);
const filterGPU = wgslFn(`fn mdFilteredRoughness(r:f32,n:vec3<f32>)->f32 {
  let dx=dpdx(n);let dy=dpdy(n);
  let variance=.15*(dot(dx,dx)+dot(dy,dy));
  return sqrt(sqrt(min(1.0,r*r*r*r+min(variance,.0064))));
}`);

export function filterSourceSpecular(root: Object3D) {
  const seen = new Set<MeshPhysicalNodeMaterial>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshPhysicalNodeMaterial) || !material.normalNode || seen.has(material) || material.userData.mdSpecularFiltered) continue;
      seen.add(material);
      const roughness = (material.roughnessNode ?? materialRoughness) as Node<'float'>;
      const normal = material.normalNode;
      material.roughnessNode = Fn(builder => ('isWebGLBackend' in builder.renderer.backend ? filterGL : filterGPU)(roughness, normal))();
      material.userData.mdSpecularFiltered = true;
      material.needsUpdate = true;
    }
  });
}
