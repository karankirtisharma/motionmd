import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {optimizeGLBImages,writeGLB} from '../scripts/glb-images.mjs';import {readGLB,compactGLB} from '../scripts/glb-storage.mjs';
async function fixture(shared=false){
 const pixels=Buffer.alloc(256*256*4);for(let i=0;i<256*256;i++){pixels[i*4]=i%256;pixels[i*4+1]=(i/256)|0;pixels[i*4+2]=123;pixels[i*4+3]=255;}
 const png=await sharp(pixels,{raw:{width:256,height:256,channels:4}}).png({compressionLevel:0}).toBuffer();
 const json={asset:{version:'2.0'},buffers:[{byteLength:png.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:png.length}],images:[{bufferView:0,mimeType:'image/png'}],textures:[{source:0}],nodes:[{name:'Untouched character'}],animations:[],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}]};
 if(shared)json.images.push({bufferView:0,mimeType:'image/png'});
 return{source:writeGLB(json,png),pixels,json};
}
test('embedded PNG optimization preserves decoded pixels and material/animation references',async()=>{
 const {source,pixels,json}=await fixture(),original=Buffer.from(source);
 const optimized=await optimizeGLBImages(source);assert.equal(optimized.images.length,1);assert.ok(source.equals(original),'never modify caller buffer');
 const result=compactGLB(optimized.buffer).buffer,{json:out,binary}=readGLB(result),view=out.bufferViews[0];
 assert.ok(result.length<source.length*.5);assert.deepEqual(out.materials,json.materials);assert.deepEqual(out.nodes,json.nodes);assert.deepEqual(out.animations,json.animations);
 assert.equal(out.textures[0].extensions.EXT_texture_webp.source,0);assert.ok(out.extensionsRequired.includes('EXT_texture_webp'));
 const decoded=await sharp(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength)).ensureAlpha().raw().toBuffer();assert.ok(decoded.equals(pixels));
});
test('shared image storage is retained rather than rewriting another image underneath it',async()=>{
 const {source}=await fixture(true);const result=await optimizeGLBImages(source);assert.equal(result.images.length,0);assert.equal(result.buffer,source);
});
