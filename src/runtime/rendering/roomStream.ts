import { Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMeshoptDecoder } from './meshoptDecode';
import { fetchAssetBuffer } from './fetchAsset';
import index from '../../generated/room-stream.json';
import { repairGlassNormals } from './glassNormals';
import { repairCollapsedBrushFrame } from './brushTangents';
import { relocateDoorwayPlanter } from './doorwayPlanter';
import { partitionSourceGeometry } from './spatialVisibility';

type Packet={url:string;bytes:number};
type Room={base:Packet;details:Packet[]};
export const roomStreams:Record<string,Room> = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim() ? {} : index;

export async function streamRoomDetails(content:Object3D, signal:AbortSignal, nearest:()=>string, freeze:(root:Object3D)=>void, updated:()=>void) {
  const decoder=createMeshoptDecoder(signal), loader=new GLTFLoader().setMeshoptDecoder(decoder);
  const rooms=Object.entries(roomStreams).map(([id,room])=>{
    const targets=new Map<number,Mesh>();
    content.getObjectByName('MD source | '+id)?.traverse(node=>{
      if(node instanceof Mesh && typeof node.geometry.userData.mdRoomSlot==='number') targets.set(node.geometry.userData.mdRoomSlot,node);
    });
    return {id,targets,queue:[...room.details]};
  });
  try {
    while(rooms.some(room=>room.queue.length)) {
      signal.throwIfAborted();
      const active=rooms.filter(room=>room.queue.length);
      const room=active.find(r=>r.id===nearest())??active[0];
      const item=room.queue.shift()!;
      const bytes=await fetchAssetBuffer(item.url,{signal,expectedBytes:item.bytes});
      const gltf=await loader.parseAsync(bytes,'');
      const meshes:Mesh[]=[];
      gltf.scene.traverse(node=>{if(node instanceof Mesh)meshes.push(node)});
      try {
        signal.throwIfAborted();
        for(const source of meshes) {
          const slot=source.geometry.userData.mdRoomSlot, target=room.targets.get(slot);
          if(!target)throw Error('Unexpected streamed geometry '+room.id+' '+slot);
          target.geometry.dispose();target.geometry=source.geometry;
          room.targets.delete(slot);
          relocateDoorwayPlanter(target);
          repairGlassNormals(target);
          repairCollapsedBrushFrame(target);
          target.visible = true;
          const parent = target.parent!;
          partitionSourceGeometry(target);
          if (!target.parent) {
            const replacement = parent.children.find(child=>child.name===target.name);
            if (replacement) freeze(replacement);
            target.geometry.dispose();
          }
        }
        updated();
      } finally {
        for(const mesh of meshes) {
          for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();
          if(signal.aborted)mesh.geometry.dispose();
        }
      }
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    if(rooms.some(room=>room.targets.size)) throw Error('Room geometry delivery incomplete');
  } finally {decoder.dispose();}
}