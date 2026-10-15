import { Mesh, MirroredRepeatWrapping, Object3D, Texture } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Fn, attribute, float, glslFn, modelNormalMatrix, modelWorldMatrix, texture, vec2, vec3, wgslFn } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { loadTexture } from './assets';
import { sourceWorldHeightBump } from './sourceStoneWalls';
import { installBrushTangents } from './brushTangents';

const worldGL=glslFn(`vec3 mdBronzeWorld(vec3 p,mat4 m){return (m*vec4(p,1.0)).xyz;}`);
const worldGPU=wgslFn(`fn mdBronzeWorld(p:vec3<f32>,m:mat4x4<f32>)->vec3<f32>{return (m*vec4<f32>(p,1.0)).xyz;}`);
const normalGL=glslFn(`vec3 mdBronzeNormal(vec3 n,mat3 m){return normalize(m*n);}`);
const normalGPU=wgslFn(`fn mdBronzeNormal(n:vec3<f32>,m:mat3x3<f32>)->vec3<f32>{return normalize(m*n);}`);

/** The source bronze is uniform in colour. Only its microscopic finish varies. */
export async function restoreSourceBronze(root:Object3D,signal?:AbortSignal):Promise<Texture[]> {
  const materials=new Set<MeshPhysicalNodeMaterial>();
  root.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]) {
    if(m instanceof MeshPhysicalNodeMaterial && m.name.endsWith('__Satin bronze')) {
      materials.add(m);
      installBrushTangents(o);
    }
  }});
  if(!materials.size)return [];
  const map=await loadTexture('/assets/surface-v5/bronze-source-grain.png','data',signal);
  map.wrapS=map.wrapT=MirroredRepeatWrapping;map.anisotropy=16;map.needsUpdate=true;
  const p=Fn(b=>('isWebGLBackend' in b.renderer.backend?worldGL:worldGPU)(attribute('position','vec3'),modelWorldMatrix))() as Node<'vec3'>;
  const n=Fn(b=>('isWebGLBackend' in b.renderer.backend?normalGL:normalGPU)(attribute('normal','vec3'),modelNormalMatrix))() as Node<'vec3'>;
  const weights=n.abs().pow(8),w=weights.div(weights.x.add(weights.y).add(weights.z));
  const h=texture(map,vec2(p.z.div(.735),p.y.div(3.55))).r.mul(w.x)
    .add(texture(map,p.xz.div(.735)).r.mul(w.y))
    .add(texture(map,vec2(p.x.div(.735),p.y.div(3.55))).r.mul(w.z));
  for(const m of materials){
    m.map=null;m.normalMap=null;m.roughnessMap=null;m.metalnessMap=null;
    m.color.setRGB(.23,.16,.09);m.colorNode=vec3(.23,.16,.09);m.metalness=.82;m.metalnessNode=float(.82);
    m.roughnessNode=float(.24).add(h.mul(.12));m.normalNode=sourceWorldHeightBump(h,.00004*.15);
    m.anisotropy=.2;
    (m as unknown as Record<string,unknown>).mdBronzeGrain=map;
    m.userData.sourceBronzeRestored=true;m.needsUpdate=true;
  }
  console.info('[MD bronze finish]',{materials:materials.size,sourceNoiseSize:2048,bumpDepthMicrons:6});
  return [map];
}
