import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { readGLB } from './glb-storage.mjs';
import { writeGLB } from './glb-images.mjs';

// Only interior furnishings can stream. Structure, chair extraction, display housings,
// stair receivers and all collision assets stay on the original entry path.
const furnishing = /potted_plant_01_|shrub_01|WS72 \||FR84 \||FR79 \| reference wool fiber|HF89 \| (?:ivory wool|linen leather|warm taupe|display port interior)|marble_bust_01/;

function packet(doc, binary, indices, opening) {
  const g = structuredClone(doc), original = g.meshes[0].primitives;
  const selected = new Set(indices);
  const parts = [], views = [], accessors = [], seen = new Map(), attrs = new Map();
  let offset = 0;
  function pack(data) {
    const padding = (4-offset%4)%4;
    parts.push(Buffer.alloc(padding),data); offset += padding + data.length;
    return offset-data.length;
  }
  function view(i) {
    if (seen.has(i)) return seen.get(i);
    const v = structuredClone(doc.bufferViews[i]);
    for (const ref of [v, v.extensions?.EXT_meshopt_compression, v.extensions?.KHR_meshopt_compression]) {
      if (ref?.buffer !== 0) continue;
      const start = ref.byteOffset ?? 0;
      ref.byteOffset = pack(binary.subarray(start,start+ref.byteLength));
    }
    seen.set(i,views.length); views.push(v); return views.length-1;
  }
  function accessor(i) {
    if (attrs.has(i)) return attrs.get(i);
    const a = structuredClone(doc.accessors[i]);
    if (a.sparse) throw Error('Unexpected sparse room geometry');
    if (a.bufferView !== undefined) a.bufferView = view(a.bufferView);
    attrs.set(i,accessors.length); accessors.push(a); return accessors.length-1;
  }
  function placeholder(i) {
    const a = doc.accessors[i], pos = a.type==='VEC3' && a.min && a.max;
    const copy = {type:a.type,componentType:a.componentType,count:3,normalized:a.normalized};
    if(pos && a.componentType===5126) {
      const b=Buffer.alloc(36);
      [...a.min,...a.max,...a.min].forEach((v,j)=>b.writeFloatLE(v,j*4));
      copy.bufferView=views.length; views.push({buffer:0,byteOffset:pack(b),byteLength:b.length});
      copy.min=a.min; copy.max=a.max;
    }
    accessors.push(copy);return accessors.length-1;
  }
  g.meshes[0].primitives = original.flatMap((p,i)=>{
    if (!opening && !selected.has(i)) return [];
    const map=opening && selected.has(i) ? placeholder : accessor;
    p.attributes=Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,map(v)]));
    p.indices=map(p.indices);
    if (selected.has(i)) p.extras={...p.extras,mdRoomSlot:i};
    if (!opening) delete p.material;
    return [p];
  });
  if(opening) for(const image of g.images??[]) {if(image.bufferView!==undefined)image.bufferView=view(image.bufferView);}
  else {
    for(const k of ['textures','images','samplers','materials']) delete g[k];
    g.extensionsUsed=g.extensionsUsed.filter(k=>k.includes('meshopt'));
    g.extensionsRequired=g.extensionsRequired?.filter(k=>k.includes('meshopt'));
    delete g.nodes[0].extras;
  }
  g.accessors=accessors;g.bufferViews=views;g.buffers[0].byteLength=offset;
  return writeGLB(g,Buffer.concat(parts));
}

export async function buildRoomPackets(root, entries, manifest) {
  const directory=path.join(root,'public','room-stream');
  await fs.mkdir(directory,{recursive:true});
  const index={};
  async function save(bytes) {
    const hash=createHash('sha256').update(bytes).digest('hex'),name=hash+'.glb.br';
    try { await fs.access(path.join(directory,name)); }
    catch (error) {
      if(error.code!=='ENOENT')throw error;
      const temporary=path.join(directory,name+'.'+randomUUID()+'.tmp');
      await fs.writeFile(temporary,brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}));
      await fs.rename(temporary,path.join(directory,name));
    }
    return {url:'/room-stream/'+name,bytes:bytes.length};
  }
  for(const room of manifest.chunks.filter(c=>['studio','founder'].includes(c.id))) {
    if(!entries[room.url]?.identity) continue;
    const {json,binary}=readGLB(await fs.readFile(path.join(root,'public',entries[room.url].identity)));
    if(json.meshes.length!==1 || json.nodes.length!==1 || json.animations?.length || json.skins?.length) continue;
    const groups=[],slots=[];
    let batch=[],weight=0;
    for(const [i,p] of json.meshes[0].primitives.entries()) {
      if (!furnishing.test(json.materials[p.material].name)) continue;
      slots.push(i);batch.push(i);weight+=json.accessors[p.indices].count;
      if(weight>=500000){groups.push(batch);batch=[];weight=0;}
    }
    if(batch.length)groups.push(batch);
    if(!slots.length)continue;
    const base=await save(packet(json,binary,slots,true)), details=[];
    for(const group of groups)details.push(await save(packet(json,binary,group,false)));
    index[room.id]={base,details};
  }
  await fs.writeFile(path.join(directory,'index.json'),JSON.stringify(index)+'\n');
  await fs.writeFile(path.join(root,'src/generated/room-stream.json'),JSON.stringify(index)+'\n');
}