import { Mesh, MeshStandardMaterial, RepeatWrapping, Texture, type Object3D } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Fn, attribute, glslFn, modelNormalMatrix, modelWorldMatrix, mix, texture, vec2, vec3, wgslFn } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { asPhysicalNodeMaterial } from './BakedPhysicalMaterial';
import { loadTexture } from './assets';

// These four source graphs use the same REF76 image, BOX projection and metre
// scale. Preserve their individual ramps instead of matching only one name.
const SOURCE_RAMPS: Record<string, [number[], number[]]> = {
 'EH54 | polished warm-grey cloud marble': [[.145,.138,.126],[.48,.451,.4]],
 'PL86 | ground wing polished existing marble': [[.145,.138,.126],[.48,.451,.4]],
 'FR82 | polished ivory large format stone': [[.23,.205,.17],[.61,.565,.49]],
 'FR84 | honed polished table stone': [[.23,.205,.17],[.61,.565,.49]],
};
const sourceRamp = (name: string) => SOURCE_RAMPS[name.replace(/^.*?__/, '')];
const worldGL = glslFn(`vec3 mdFloorWorld(vec3 p, mat4 m) { vec3 w=(m*vec4(p,1.0)).xyz; return vec3(w.x,-w.z,w.y); }`);
const worldGPU = wgslFn(`fn mdFloorWorld(p:vec3<f32>,m:mat4x4<f32>)->vec3<f32> { let w=(m*vec4<f32>(p,1.0)).xyz; return vec3<f32>(w.x,-w.z,w.y); }`);
const normalGL = glslFn(`vec3 mdFloorNormal(vec3 n, mat3 m) { vec3 w=normalize(m*n); return vec3(w.x,-w.z,w.y); }`);
const normalGPU = wgslFn(`fn mdFloorNormal(n:vec3<f32>,m:mat3x3<f32>)->vec3<f32> { let w=normalize(m*n); return vec3<f32>(w.x,-w.z,w.y); }`);

// Cycles image BOX projection, blend=.15; formulas from Blender's Apache-2.0
// intern/cycles/kernel/svm/image.h. Coordinates are world metres as in the source graph.
const weightsGL = glslFn(`vec3 mdFloorWeights(vec3 n) {
 vec3 a=abs(n); a/=max(a.x+a.y+a.z,1e-8); float L=.575;
 if(a.x>L*(a.x+a.y)&&a.x>L*(a.x+a.z))return vec3(1,0,0);
 if(a.y>L*(a.x+a.y)&&a.y>L*(a.y+a.z))return vec3(0,1,0);
 if(a.z>L*(a.x+a.z)&&a.z>L*(a.y+a.z))return vec3(0,0,1);
 if(a.z<(1.0-L)*(a.y+a.x)){float t=clamp((a.x/(a.x+a.y)-.425)/.15,0.0,1.0);return vec3(t,1.0-t,0);}
 if(a.x<(1.0-L)*(a.y+a.z)){float t=clamp((a.y/(a.y+a.z)-.425)/.15,0.0,1.0);return vec3(0,t,1.0-t);}
 if(a.y<(1.0-L)*(a.x+a.z)){float t=clamp((a.x/(a.x+a.z)-.425)/.15,0.0,1.0);return vec3(t,0,1.0-t);}
 return ((2.0-L)*a+vec3(L-1.0))/(2.0*L-1.0);
}`);
const weightsGPU = wgslFn(`fn mdFloorWeights(n:vec3<f32>)->vec3<f32> {
 var a=abs(n); a/=max(a.x+a.y+a.z,1e-8); let L=.575;
 if(a.x>L*(a.x+a.y)&&a.x>L*(a.x+a.z)){return vec3<f32>(1,0,0);}
 if(a.y>L*(a.x+a.y)&&a.y>L*(a.y+a.z)){return vec3<f32>(0,1,0);}
 if(a.z>L*(a.x+a.z)&&a.z>L*(a.y+a.z)){return vec3<f32>(0,0,1);}
 if(a.z<(1.0-L)*(a.y+a.x)){let t=clamp((a.x/(a.x+a.y)-.425)/.15,0.0,1.0);return vec3<f32>(t,1.0-t,0);}
 if(a.x<(1.0-L)*(a.y+a.z)){let t=clamp((a.y/(a.y+a.z)-.425)/.15,0.0,1.0);return vec3<f32>(0,t,1.0-t);}
 if(a.y<(1.0-L)*(a.x+a.z)){let t=clamp((a.x/(a.x+a.z)-.425)/.15,0.0,1.0);return vec3<f32>(t,0,1.0-t);}
 return ((2.0-L)*a+vec3<f32>(L-1.0))/(2.0*L-1.0);
}`);

/** Keep the photographic source detail independent of unique lighting atlas density. */
export async function restoreSourceStoneFloors(root:Object3D, signal?:AbortSignal):Promise<Texture[]> {
 const targets:Mesh[]=[];
 root.traverse(o=>{if(o instanceof Mesh&&(Array.isArray(o.material)?o.material:[o.material]).some(m=>sourceRamp(m.name)))targets.push(o);});
 if(!targets.length)return [];
 const map=await loadTexture('/assets/source-walls/greige-marble-original.png','color',signal);
 try {
  map.wrapS=map.wrapT=RepeatWrapping;map.anisotropy=16;map.needsUpdate=true;
  const p=Fn(b=>('isWebGLBackend' in b.renderer.backend?worldGL:worldGPU)(attribute('position','vec3'),modelWorldMatrix))() as Node<'vec3'>;
  const n=Fn(b=>('isWebGLBackend' in b.renderer.backend?normalGL:normalGPU)(attribute('normal','vec3'),modelNormalMatrix))() as Node<'vec3'>;
  const w=Fn(b=>('isWebGLBackend' in b.renderer.backend?weightsGL:weightsGPU)(n))() as Node<'vec3'>;
  const q=p.mul(0.3571428656578064);
  const x=texture(map,vec2(n.x.lessThan(0).select(q.y.oneMinus(),q.y),q.z)).rgb;
  const y=texture(map,vec2(n.y.greaterThan(0).select(q.x.oneMinus(),q.x),q.z)).rgb;
  const z=texture(map,vec2(n.z.greaterThan(0).select(q.y.oneMinus(),q.y),q.x)).rgb;
  const sample=x.mul(w.x).add(y.mul(w.y)).add(z.mul(w.z));
  // Authored REF76 color ramp, evaluated in scene-linear Rec.709.
  const fac=sample.dot(vec3(.2126,.7152,.0722)).sub(.1).div(.56).clamp(0,1);
  let materials=0;
  for(const mesh of targets){const list=Array.isArray(mesh.material)?mesh.material:[mesh.material];const updated=list.map(source=>{
   const ramp=sourceRamp(source.name);
   if(!ramp||!(source instanceof MeshStandardMaterial||source instanceof MeshPhysicalNodeMaterial))return source;
   const material=source instanceof MeshPhysicalNodeMaterial?source:asPhysicalNodeMaterial(source);
   material.map=null;material.color.setRGB(1,1,1);
   material.colorNode=mix(vec3(ramp[0][0],ramp[0][1],ramp[0][2]),vec3(ramp[1][0],ramp[1][1],ramp[1][2]),fac);
   (material as unknown as Record<string,unknown>).mdMarbleAlbedo=map;
   material.userData.sourceFloorRestored=true;material.needsUpdate=true;materials++;return material;
  });mesh.material=Array.isArray(mesh.material)?updated:updated[0];}
  console.info('[MD floor repair]',JSON.stringify({materials,sourceImage:'greige_marble_albedo.png',pixelsPerMeter:1254/2.8,bakedLightingRetained:true}));return [map];
 }catch(error){map.dispose();throw error;}
}
