import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { asPhysicalNodeMaterial } from './BakedPhysicalMaterial.ts';
import { assetURL, loadTexture } from './assets.ts';
import { founderExteriorSource } from './exteriorLightingGeometry.ts';

export type ExteriorLightReceiver = { name: string; sourceMesh: string; material: string; triangleOffsets: number[]; signature: string; uvOffset: number; uvCount: number };
export type ExteriorLightMetadata = { atlas: string; uv: string; receivers: ExteriorLightReceiver[]; size: number[] };

/** The founder-side exterior slab was also exported with inward-facing triangles. */
export function repairFounderExteriorWinding(root: Object3D) {
  let triangles=0;
  root.traverse(object=>{
    if(!(object instanceof Mesh)||object.name!==founderExteriorSource.mesh||object.geometry.userData.mdFounderExteriorWinding)return;
    const g=object.geometry,index=g.index;if(!index)return;
    const vertices=new Set<number>();
    for(const i of founderExteriorSource.triangleOffsets){
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
      index.setX(i+1,c);index.setX(i+2,b);vertices.add(a);vertices.add(b);vertices.add(c);triangles++;
    }
    const normal=g.attributes.normal,tangent=g.attributes.tangent;
    for(const i of vertices){if(normal)normal.setXYZ(i,-normal.getX(i),-normal.getY(i),-normal.getZ(i));if(tangent)tangent.setW(i,-tangent.getW(i));}
    index.needsUpdate=true;if(normal)normal.needsUpdate=true;if(tangent)tangent.needsUpdate=true;g.userData.mdFounderExteriorWinding=true;
  });
  return triangles;
}

/** Hash the exact ordered source positions, rejecting stale lighting after geometry edits. */
export function exteriorReceiverSignature(mesh: Mesh, offsets: readonly number[]) {
  const index=mesh.geometry.index,p=mesh.geometry.attributes.position;
  if(!index)throw new Error('Exterior lighting requires indexed source geometry.');
  const f=new Float32Array(1),bits=new Uint32Array(f.buffer);let hash=2166136261;
  for(const offset of offsets)for(let j=0;j<3;j++)for(let axis=0;axis<3;axis++){
    f[0]=p.getComponent(index.getX(offset+j),axis);hash=Math.imul(hash^bits[0],16777619);
  }
  return (hash>>>0).toString(16).padStart(8,'0');
}

/** Extract only measured exterior faces; preserve every source vertex attribute. */
export function splitExteriorLightingReceivers(root: Object3D,metadata: ExteriorLightMetadata,uvs: Float32Array) {
  const sources=new Map<string,Mesh>();root.traverse(o=>{if(o instanceof Mesh)sources.set(o.name,o)});
  const receivers: Mesh[]=[];
  // Validate the whole release before mutating any source geometry.
  for(const r of metadata.receivers){const source=sources.get(r.sourceMesh);
    if(!source||Array.isArray(source.material)||source.material.name!==r.material||exteriorReceiverSignature(source,r.triangleOffsets)!==r.signature)throw new Error(`Exterior lighting geometry mismatch: ${r.sourceMesh}`);
    if(r.uvCount!==r.triangleOffsets.length*6||r.uvOffset+r.uvCount>uvs.length)throw new Error(`Invalid exterior lighting UV payload: ${r.name}`);
  }
  for(const r of metadata.receivers){
    const source=sources.get(r.sourceMesh)!,g=source.geometry,index=g.index!,geometry=new BufferGeometry();
    const vertexIds=r.triangleOffsets.flatMap(i=>[index.getX(i),index.getX(i+1),index.getX(i+2)]);
    for(const [name,a]of Object.entries(g.attributes)){
      const values=new Float32Array(vertexIds.length*a.itemSize);
      for(let i=0;i<vertexIds.length;i++)for(let c=0;c<a.itemSize;c++)values[i*a.itemSize+c]=a.getComponent(vertexIds[i],c);
      geometry.setAttribute(name,new Float32BufferAttribute(values,a.itemSize,a.normalized));
    }
    geometry.setAttribute('uv2',new Float32BufferAttribute(uvs.slice(r.uvOffset,r.uvOffset+r.uvCount),2));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const receiver=new Mesh(geometry,source.material);receiver.name=r.name;
    receiver.position.copy(source.position);receiver.quaternion.copy(source.quaternion);receiver.scale.copy(source.scale);
    receiver.matrix.copy(source.matrix);receiver.matrixAutoUpdate=source.matrixAutoUpdate;receiver.userData={...source.userData,exteriorLightingReceiver:true};
    receiver.castShadow=source.castShadow;receiver.receiveShadow=source.receiveShadow;receiver.renderOrder=source.renderOrder;
    source.parent!.add(receiver);receivers.push(receiver);
    const selected=new Set(r.triangleOffsets),remaining:number[]=[];
    for(let i=0;i<index.count;i+=3)if(!selected.has(i))remaining.push(index.getX(i),index.getX(i+1),index.getX(i+2));
    // Source meshes are unique primitives; the new receiver owns copied attributes.
    g.setIndex(remaining);g.computeBoundingBox();g.computeBoundingSphere();
  }
  return receivers;
}

/** Apply the new illumination-only bake without altering stone texture or source UVs. */
export async function installExteriorLighting(root: Object3D,signal?: AbortSignal): Promise<Texture[]> {
  const response=await fetch(assetURL('/assets/exterior-finish-v24/lighting.json'),{signal});
  if(!response.ok)throw new Error('Could not load exterior lighting metadata.');
  const metadata=await response.json() as ExteriorLightMetadata;
  const uvResponse=await fetch(assetURL(metadata.uv),{signal});if(!uvResponse.ok)throw new Error('Could not load exterior lighting UVs.');
  const uvs=new Float32Array(await uvResponse.arrayBuffer());
  const light=await loadTexture(metadata.atlas,'linear',signal);
  try{
    light.flipY=false;light.channel=2;light.repeat.y=-1;light.offset.y=1;light.needsUpdate=true;
    const receivers=splitExteriorLightingReceivers(root,metadata,uvs);
    for(const receiver of receivers){
      const source=receiver.material;
      if(!(source instanceof MeshStandardMaterial||source instanceof MeshPhysicalNodeMaterial))throw new Error(`Invalid exterior stone material: ${receiver.name}`);
      const material=asPhysicalNodeMaterial(source as unknown as MeshStandardMaterial,true);material.lightMap=light;material.lightMapIntensity=Math.PI;
      material.userData.exteriorLighting='Cycles indirect and practical diffuse; corrected source geometry';material.needsUpdate=true;receiver.material=material;
    }
    return [light];
  }catch(error){light.dispose();throw error;}
}
