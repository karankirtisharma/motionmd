import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {readGLB} from '../scripts/glb-storage.mjs';
const report=JSON.parse(await fs.readFile(new URL('../public/asset-delivery/report.json',import.meta.url)));
const index=JSON.parse(await fs.readFile(new URL('../src/generated/asset-delivery.json',import.meta.url)));
const results=[];
for(const entry of report){
 const url=Object.keys(index).find(url=>index[url].br===entry.entry.br);
 const source=await fs.readFile(new URL('../public'+url,import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),entry.sourceSHA256,'source asset must remain unchanged');
 const output=entry.entry.identity?await fs.readFile(new URL('../public'+entry.entry.identity,import.meta.url)):source;
 const a=readGLB(source),b=readGLB(output),changed=new Set(entry.images.map(image=>a.json.images[image.index].bufferView));
 for(const key of ['scenes','scene','nodes','materials','meshes','accessors','skins','animations','samplers','cameras'])assert.deepEqual(a.json[key],b.json[key],`${entry.id}: ${key} changed`);
 const bytes=(data,view)=>data.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
 for(let i=0;i<a.json.bufferViews.length;i++){
  const before=a.json.bufferViews[i],after=b.json.bufferViews[i];
  if(before.buffer===0&&!changed.has(i))assert.ok(bytes(a.binary,before).equals(bytes(b.binary,after)),`${entry.id}: binary view ${i} changed`);
  const oldMeshopt=before.extensions?.EXT_meshopt_compression,newMeshopt=after.extensions?.EXT_meshopt_compression;
  if(oldMeshopt?.buffer===0)assert.ok(bytes(a.binary,oldMeshopt).equals(bytes(b.binary,newMeshopt)),`${entry.id}: compressed geometry ${i} changed`);
 }
 for(const image of entry.images){
  const before=a.json.images[image.index],after=b.json.images[image.index];
  assert.equal(after.mimeType,'image/webp');
  const original=await sharp(bytes(a.binary,a.json.bufferViews[before.bufferView])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded=await sharp(bytes(b.binary,b.json.bufferViews[after.bufferView])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual(original.info,decoded.info);assert.ok(original.data.equals(decoded.data),'RGBA pixels changed');
  for(let t=0;t<a.json.textures.length;t++)if(a.json.textures[t].source===image.index)assert.equal(b.json.textures[t].extensions.EXT_texture_webp.source,image.index);
 }
 results.push({id:entry.id,images:entry.images.length,geometryAndAnimationsExact:true,sourceUnchanged:true});
}
console.log(JSON.stringify(results,null,2));
