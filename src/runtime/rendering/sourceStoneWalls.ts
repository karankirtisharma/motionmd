import { Mesh, MeshStandardMaterial, RepeatWrapping, Texture, type Object3D } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Fn, attribute, cameraViewMatrix, float, frontFacing, glslFn, modelNormalMatrix, modelWorldMatrix, mix, texture, vec3, wgslFn } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { asPhysicalNodeMaterial } from './BakedPhysicalMaterial';
import { loadTexture } from './assets';

const SOURCE_NAME = 'EH54 | scanned cream limestone panels';

// Source: Blender world coordinates (X,Y,Z); exported glTF coordinates (X,Z,-Y).
// Keep these transforms native so normal-node subbuilds cannot alias TSL matrix temporaries.
const positionGL = glslFn(`vec3 mdStonePosition(vec3 p, mat4 m) {
  vec3 w = (m * vec4(p, 1.0)).xyz; return vec3(w.x, -w.z, w.y);
}`);
const positionGPU = wgslFn(`fn mdStonePosition(p: vec3<f32>, m: mat4x4<f32>) -> vec3<f32> {
  let w = (m * vec4<f32>(p, 1.0)).xyz; return vec3<f32>(w.x, -w.z, w.y);
}`);
const normalGL = glslFn(`vec3 mdStoneNormal(vec3 n, mat3 m) {
  vec3 w = normalize(m * n); return vec3(w.x, -w.z, w.y);
}`);
const normalGPU = wgslFn(`fn mdStoneNormal(n: vec3<f32>, m: mat3x3<f32>) -> vec3<f32> {
  let w = normalize(m * n); return vec3<f32>(w.x, -w.z, w.y);
}`);

// World-metre height gradient: source Distance=.00014m, Strength=.38.
// No exaggerated relief from a coarse tangent-normal atlas.
const bumpGL = glslFn(`vec3 mdStoneBump(vec3 p, vec3 n, mat4 m, mat3 nm, mat4 v, float h, float depth, float sideMode, bool frontFace) {
  vec3 q = (v * m * vec4(p,1.0)).xyz;
  vec3 N = normalize((v * vec4(nm*n,0.0)).xyz);
  if ((sideMode > .5 && sideMode < 1.5) || (sideMode > 1.5 && !frontFace)) N = -N;
  vec3 dx=dFdx(q), dy=dFdy(q), r1=cross(dy,N), r2=cross(N,dx);
  float det=dot(dx,r1);
  vec3 gradient=(r1*dFdx(h)+r2*dFdy(h))*depth;
  return normalize(N-gradient*(sign(det)/max(abs(det),1e-12)));
}`);
const bumpGPU = wgslFn(`fn mdStoneBump(p: vec3<f32>, n: vec3<f32>, m: mat4x4<f32>, nm: mat3x3<f32>, v: mat4x4<f32>, h: f32, depth: f32, sideMode: f32, frontFace: bool) -> vec3<f32> {
  let q=(v*m*vec4<f32>(p,1.0)).xyz;
  var N=normalize((v*vec4<f32>(nm*n,0.0)).xyz);
  if ((sideMode > .5 && sideMode < 1.5) || (sideMode > 1.5 && !frontFace)) {N=-N;}
  let dx=dpdx(q); let dy=dpdy(q); let r1=cross(dy,N); let r2=cross(N,dx);
  let det=dot(dx,r1);
  let gradient=(r1*dpdx(h)+r2*dpdy(h))*depth;
  return normalize(N-gradient*(sign(det)/max(abs(det),1e-12)));
}`);

export function sourceWorldHeightBump(height: Node<'float'>, depth: number) {
  return Fn(builder => ('isWebGLBackend' in builder.renderer.backend ? bumpGL : bumpGPU)(
    attribute('position','vec3'),attribute('normal','vec3'),modelWorldMatrix,modelNormalMatrix,cameraViewMatrix,height,float(depth),
    float(builder.material.side),frontFacing))() as Node<'vec3'>;
}

function sourceNodes(color: Texture, roughness: Texture, height: Texture) {
  const p = Fn(builder => ('isWebGLBackend' in builder.renderer.backend ? positionGL : positionGPU)(attribute('position','vec3'), modelWorldMatrix))() as Node<'vec3'>;
  const n = Fn(builder => ('isWebGLBackend' in builder.renderer.backend ? normalGL : normalGPU)(attribute('normal','vec3'), modelNormalMatrix))() as Node<'vec3'>;
  const weights = n.abs().pow(4);
  // These two mixes reproduce the original authored three-axis graph, including its epsilon.
  const fy = weights.y.div(weights.x.add(weights.y).add(.00001));
  const fz = weights.z.div(weights.x.add(weights.y).add(weights.z));
  const sample = (image: Texture, scale: number) => {
    const q=p.mul(scale);
    return mix(mix(texture(image,q.yz).rgb,texture(image,q.xz).rgb,fy),texture(image,q.xy).rgb,fz);
  };
  // The packed source is only 840px. Repeat it per 1.2m stone panel rather
  // than enlarging it across four panels; image pixels/colours stay untouched.
  const albedo = sample(color,1/1.2);
  const r = sample(roughness,1/4.2).dot(vec3(1/3));
  const h = sample(height,1/4.2).dot(vec3(1/3));
  // Authored panels are 1.2m with 3.12mm joints. Analytic pixel coverage retains
  // narrow joints during motion instead of aliasing a hard step into an atlas.
  const q=p.mul(1/1.2), cell=q.fract();
  const distance=cell.min(vec3(1).sub(cell));
  const width=q.fwidth().max(.00001);
  const halfWidth=width.mul(.5);
  const lower=distance.sub(halfWidth).max(-.0013);
  const upper=distance.add(halfWidth).min(.0013);
  const seam=upper.sub(lower).max(0).div(width);
  const joints=seam.y.max(seam.z).mul(weights.x)
    .add(seam.x.max(seam.z).mul(weights.y))
    .add(seam.x.max(seam.y).mul(weights.z))
    .div(weights.x.add(weights.y).add(weights.z));
  return {
    color:mix(albedo,vec3(.33,.304,.267),joints),
    roughness:float(.32).add(r.clamp(0,1).mul(.09)),
    normal:sourceWorldHeightBump(h,.00014*.38),
  };
}

/** Preserve the authored wall image and world scale independently of unique GI UVs. */
export async function restoreSourceStoneWalls(root: Object3D, signal?: AbortSignal, lightingFallbacks = new Set<string>()): Promise<Texture[]> {
  const targets: Mesh[]=[];
  root.traverse(o => { if(o instanceof Mesh && (Array.isArray(o.material)?o.material:[o.material]).some(m => m.name.endsWith(SOURCE_NAME))) targets.push(o); });
  if(!targets.length) return [];
  const maps: Texture[]=[];
  try {
    for(const [file,usage] of [['cream-stone-original.png','color'],['stone-roughness-original.jpg','data'],['stone-height-original.jpg','data']] as const) {
      const map=await loadTexture(`/assets/source-walls/${file}`,usage,signal);
      map.wrapS=map.wrapT=RepeatWrapping;
      // TextureLoader's default flipY matches Blender image coordinates; no glTF atlas convention here.
      map.anisotropy=16; map.needsUpdate=true; maps.push(map);
    }
    const nodes=sourceNodes(maps[0],maps[1],maps[2]);
    let materials=0;
    for(const mesh of targets) {
      const original=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const updated=original.map(source => {
        if(!source.name.endsWith(SOURCE_NAME) || !(source instanceof MeshStandardMaterial || source instanceof MeshPhysicalNodeMaterial)) return source;
        // Use captured room diffuse only for legacy atlases selected by the manifest pass.
        // Convert out of BakedPhysicalMaterial so diffuse IBL is enabled again.
        const fallback=lightingFallbacks.has(source.name);
        const material=fallback?asPhysicalNodeMaterial(source as MeshStandardMaterial):source instanceof MeshPhysicalNodeMaterial?source:asPhysicalNodeMaterial(source);
        if(fallback) material.lightMap=null;
        material.map=null; material.roughnessMap=null; material.metalnessMap=null; material.normalMap=null;
        material.color.setRGB(1,1,1); material.metalness=0;
        material.colorNode=nodes.color; material.roughnessNode=nodes.roughness;
        material.normalNode=nodes.normal as Node<'vec3'>;
        material.userData.sourceWallRestored=true;
        material.userData.sourceWallLighting=fallback?'room-probe fallback for legacy atlas':'authored baked illumination';
        // The existing upload/disposal collector discovers Texture-valued properties.
        const record=material as unknown as Record<string,unknown>;
        record.mdStoneAlbedo=maps[0]; record.mdStoneRoughness=maps[1]; record.mdStoneHeight=maps[2];
        material.needsUpdate=true; materials++;
        return material;
      });
      mesh.material=Array.isArray(mesh.material)?updated:updated[0];
    }
    console.info('[MD wall repair] source stone at panel scale',JSON.stringify({materials,meshes:targets.length,albedoPixelsPerMeter:840/1.2,detailPixelsPerMeter:4096/4.2}));
    return maps;
  } catch(error) { maps.forEach(t=>t.dispose()); throw error; }
}
