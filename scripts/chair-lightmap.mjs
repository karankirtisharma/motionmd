import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DataTexture, HalfFloatType, LinearFilter, RGBAFormat } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { EXRExporter } from 'three/addons/exporters/EXRExporter.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const chairSource='/assets/chair-v22/lighting/founder-chair-indirect.exr';

/** Deduplicate exact RGBA16F tiles, including the original one-texel neighbor
 * on all sides. This represents every legal UV, including other poses and
 * future geometry, without relying on a conservative chart occupancy guess. */
export function packLinearTiles(source,width,height,tile=64) {
  if(!(source instanceof Uint16Array) || source.length!==width*height*4 || width%tile || height%tile) throw Error('Expected complete half-float RGBA tiles');
  const pitch=tile+2, gridX=width/tile,gridY=height/tile;
  const unique=[],indices=[],hashes=new Map(),raw=Buffer.allocUnsafe(pitch*pitch*8);
  const src=Buffer.from(source.buffer,source.byteOffset,source.byteLength);
  for(let ty=0;ty<gridY;ty++) for(let tx=0;tx<gridX;tx++) {
    for(let j=0;j<pitch;j++) {
      const y=Math.max(0,Math.min(height-1,ty*tile+j-1)),x=tx*tile;
      const dst=j*pitch*8,base=(y*width+x)*8;
      src.copy(raw,dst,base-(x>0?8:0),base-(x>0?8:0)+8);
      src.copy(raw,dst+8,base,base+tile*8);
      const last=base+tile*8-(x+tile===width?8:0);
      src.copy(raw,dst+(tile+1)*8,last,last+8);
    }
    const key=digest(raw);let index=hashes.get(key);
    if(index===undefined){index=unique.length;hashes.set(key,index);unique.push(Buffer.from(raw));}
    else if(!unique[index].equals(raw))throw Error('Chair atlas tile digest collision');
    indices.push(index);
  }
  // Power-of-two page dimensions retain the original binary texel phase when
  // the shader translates coordinates to a different page in the atlas.
  const pot=v=>2**Math.ceil(Math.log2(v));
  let atlasWidth=pot(Math.ceil(Math.sqrt(unique.length))*pitch);
  let columns=Math.floor(atlasWidth/pitch),atlasHeight=pot(Math.ceil(unique.length/columns)*pitch);
  if(atlasHeight<atlasWidth/2){
    const candidate=atlasWidth/2,c=Math.floor(candidate/pitch),h=pot(Math.ceil(unique.length/c)*pitch);
    if(c>0 && candidate*h<=atlasWidth*atlasHeight){atlasWidth=candidate;atlasHeight=h;columns=c;}
  }
  if(columns>256 || Math.ceil(unique.length/columns)>256)throw Error('Chair tile lookup exceeds RG8 addressing');
  const pixels=new Uint16Array(atlasWidth*atlasHeight*4),out=Buffer.from(pixels.buffer);
  for(const [i,bytes] of unique.entries()){
    const left=i%columns*pitch,top=Math.floor(i/columns)*pitch;
    for(let j=0;j<pitch;j++) bytes.copy(out,((top+j)*atlasWidth+left)*8,j*pitch*8,(j+1)*pitch*8);
  }
  const indexMap=new Uint8Array(gridX*gridY*2);
  indices.forEach((index,i)=>{indexMap[i*2]=index%columns;indexMap[i*2+1]=Math.floor(index/columns);});
  return {pixels,indexMap,uniqueTiles:unique.length,width,height,tile,pitch,gridX,gridY,atlasWidth,atlasHeight};
}

export async function prepareChairLightmap(root,enabled) {
  const metaFile=path.join(root,'src/generated/chair-lightmap.json');
  let info={};
  if(enabled) {
    const source=await fs.readFile(path.join(root,'public',chairSource)),sourceSHA256=digest(source);
    let old;
    try {old=JSON.parse(await fs.readFile(metaFile,'utf8'));}catch{}
    if(old?.version===1 && old.sourceSHA256===sourceSHA256 && /^\/asset-delivery\/[a-f0-9]{64}\.exr$/.test(old.url)) {
      try {
        const output=await fs.readFile(path.join(root,'public',old.url));
        if(digest(output)===path.basename(old.url,'.exr') && digest(Buffer.from(old.indices,'base64'))===old.indexSHA256)return old;
      } catch{}
    }
    const parse=bytes=>new EXRLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const full=parse(source);
    if(full.width===4096 && full.height===4096 && full.type===HalfFloatType && full.format===RGBAFormat &&
       full.minFilter===LinearFilter && full.magFilter===LinearFilter && !full.generateMipmaps && !full.flipY) {
      const p=packLinearTiles(full.data,full.width,full.height);
      if(p.pixels.byteLength+p.indexMap.byteLength<full.data.byteLength/2) {
        const texture=new DataTexture(p.pixels,p.atlasWidth,p.atlasHeight,RGBAFormat,HalfFloatType);
        let encoded;
        try {encoded=Buffer.from(await new EXRExporter().parse(texture,{type:HalfFloatType}));}
        finally {texture.dispose();}
        const restored=parse(encoded);
        if(restored.width===p.atlasWidth && restored.height===p.atlasHeight &&
          Buffer.from(restored.data.buffer,restored.data.byteOffset,restored.data.byteLength).equals(Buffer.from(p.pixels.buffer))) {
          const url='/asset-delivery/'+digest(encoded)+'.exr';
          await fs.writeFile(path.join(root,'public',url),encoded);
          info={version:1,source:chairSource,sourceSHA256,url,indices:Buffer.from(p.indexMap).toString('base64'),indexSHA256:digest(p.indexMap),
            width:p.width,height:p.height,tile:p.tile,pitch:p.pitch,gridX:p.gridX,gridY:p.gridY,atlasWidth:p.atlasWidth,atlasHeight:p.atlasHeight,
            sourceBytes:source.length,packedBytes:encoded.length,uniqueTiles:p.uniqueTiles};
        }
      }
    }
  }
  await fs.mkdir(path.dirname(metaFile),{recursive:true});
  await fs.writeFile(metaFile+'.tmp',JSON.stringify(info)+'\n');await fs.rename(metaFile+'.tmp',metaFile);
  return info;
}
