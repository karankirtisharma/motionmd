import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HalfFloatType, LinearFilter } from 'three';
import metadata from '../src/generated/chair-lightmap.json' with {type:'json'};
import { packLinearTiles } from '../scripts/chair-lightmap.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
test('identical interiors with different neighboring texels do not share guttered pages',()=>{
  const w=12,h=4,source=new Uint16Array(w*h*4);
  for(let y=0;y<h;y++) source[(y*w+8)*4]=123;
  const packed=packLinearTiles(source,w,h,4);
  assert.equal(packed.uniqueTiles,3);
  assert.notDeepEqual(packed.indexMap.slice(0,2),packed.indexMap.slice(2,4));
});

test('the shipping chair atlas reconstructs every source pixel and every clamped bilinear edge bit-exactly',{
  skip:!metadata.url,
},async()=>{
  const read=async u=>fs.readFile(new URL('../public'+u,import.meta.url));
  const [s,b]=await Promise.all([read(metadata.source),read(metadata.url)]);
  assert.equal(digest(s),metadata.sourceSHA256);assert.ok(metadata.url.includes(digest(b)));
  const parse=bytes=>new EXRLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const full=parse(s),atlas=parse(b),map=Buffer.from(metadata.indices,'base64');
  assert.equal(full.type,HalfFloatType);assert.equal(full.minFilter,LinearFilter);
  assert.equal(full.magFilter,LinearFilter);assert.equal(full.generateMipmaps,false);assert.equal(full.flipY,false);
  assert.equal(atlas.type,full.type);assert.equal(atlas.colorSpace,full.colorSpace);assert.equal(digest(map),metadata.indexSHA256);
  const {tile,pitch,gridX,gridY,width,height,atlasWidth,atlasHeight}=metadata;
  assert.deepEqual([atlas.width,atlas.height],[atlasWidth,atlasHeight]);assert.deepEqual([full.width,full.height],[width,height]);
  const before=Buffer.from(full.data.buffer,full.data.byteOffset,full.data.byteLength),after=Buffer.from(atlas.data.buffer,atlas.data.byteOffset,atlas.data.byteLength);
  for(let y=0;y<gridY;y++)for(let x=0;x<gridX;x++){
    const offset=(y*gridX+x)*2,ax=map[offset]*pitch,ay=map[offset+1]*pitch;
    for(let j=0;j<pitch;j++){
      const sy=Math.max(0,Math.min(height-1,y*tile+j-1));
      const src=(sy*width+x*tile)*8,dst=((ay+j)*atlasWidth+ax)*8;
      assert.ok(before.subarray(src,src+tile*8).equals(after.subarray(dst+8,dst+(tile+1)*8)),'all interior texels');
      const left=src-(x>0?8:0),right=src+(tile-(x+1===gridX?1:0))*8;
      assert.ok(before.subarray(left,left+8).equals(after.subarray(dst,dst+8)),'left clamped gutter');
      assert.ok(before.subarray(right,right+8).equals(after.subarray(dst+(pitch-1)*8,dst+pitch*8)),'right clamped gutter');
    }
  }
  assert.ok(atlas.data.byteLength+map.byteLength<full.data.byteLength*.14);
});
