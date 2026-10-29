import sharp from 'sharp';
import { readGLB } from './glb-storage.mjs';

export function writeGLB(json, binary) {
  const raw = Buffer.from(JSON.stringify(json));
  const text = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const head = Buffer.alloc(20), tail = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67,0); head.writeUInt32LE(2,4); head.writeUInt32LE(28 + text.length + bin.length,8);
  head.writeUInt32LE(text.length,12); head.writeUInt32LE(0x4e4f534a,16);
  tail.writeUInt32LE(bin.length,0); tail.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([head,text,tail,bin]);
}

/** Build-only, pixel-exact PNG replacement. Never resize or touch geometry/animation. */
export async function optimizeGLBImages(source) {
  const {json,binary} = readGLB(source), parts=[binary], images=[];
  let length=binary.length;
  for (const [index,image] of (json.images ?? []).entries()) {
    if (image.mimeType !== 'image/png' || image.bufferView === undefined) continue;
    const view=json.bufferViews[image.bufferView];
    if (view.buffer !== 0 || view.extensions || view.byteLength < 65536) continue;
    if (json.images.filter(other => other.bufferView === image.bufferView).length !== 1) continue;
    // Image-only storage: do not rewrite a buffer view shared with accessors.
    if ((json.accessors ?? []).some(a => a.bufferView === image.bufferView || a.sparse?.indices.bufferView === image.bufferView || a.sparse?.values.bufferView === image.bufferView)) continue;
    const textures=(json.textures ?? []).filter(t => t.source === index);
    if (!textures.length || textures.some(t => t.extensions?.KHR_texture_basisu || t.extensions?.EXT_texture_webp)) continue;
    const input=binary.subarray(view.byteOffset ?? 0,(view.byteOffset ?? 0)+view.byteLength);
    const meta=await sharp(input).metadata();
    if (meta.depth !== 'uchar' || meta.pages > 1 || meta.orientation || meta.icc) continue;
    const output=await sharp(input).webp({lossless:true,effort:6}).toBuffer();
    if (output.length >= input.length*.95) continue;
    const before=await sharp(input).ensureAlpha().raw().toBuffer();
    const after=await sharp(output).ensureAlpha().raw().toBuffer();
    // Some WebP encoders discard RGB behind zero alpha. Reject those images too.
    if (!before.equals(after)) continue;
    const padding=(4-length%4)%4; if(padding){parts.push(Buffer.alloc(padding));length+=padding;}
    json.bufferViews[image.bufferView]={...view,byteOffset:length,byteLength:output.length};
    parts.push(output);length+=output.length;image.mimeType='image/webp';
    for(const texture of textures){texture.extensions={...texture.extensions,EXT_texture_webp:{source:index}};delete texture.source;}
    images.push({index,width:meta.width,height:meta.height,before:input.length,after:output.length,pixelExact:true});
  }
  if (!images.length) return {buffer:source,images};
  for(const field of ['extensionsUsed','extensionsRequired'])json[field]=[...new Set([...(json[field] ?? []),'EXT_texture_webp'])];
  json.buffers[0].byteLength=length;
  return {buffer:writeGLB(json,Buffer.concat(parts)),images};
}
