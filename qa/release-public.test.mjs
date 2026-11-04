import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { writeGLB } from '../scripts/glb-images.mjs';
import { releaseSourceAssets,stageReleasePublic } from '../scripts/release-public.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
async function put(root,url,data) {
  const p=path.join(root,url);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,data);
}
async function fixture(t) {
  const base=await fs.realpath(os.tmpdir()),tmp=await fs.mkdtemp(path.join(base,'md-release-test-')),pub=path.join(tmp,'public');
  assert.equal(path.dirname(tmp),base);
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  for (const f of ['basis/basis_transcoder.js','basis/basis_transcoder.wasm','environment/qwantani-sunset-2k.hdr',
     'source-walls/greige-marble-original.png','source-walls/stone-height-original.jpg','source-walls/stone-roughness-original.jpg',
     'surface-v5/bronze-source-grain.png','character/Rocketbox-MIT-LICENSE.txt']) await put(pub,'assets/'+f,'fixture');
  const model='/assets/room/model.glb';
  const glb=writeGLB({asset:{version:'2.0'},buffers:[{byteLength:4}],images:[{uri:'../tiles/wood.ktx2'}]},Buffer.alloc(4));
  await put(pub,model,glb); await put(pub,'assets/tiles/wood.ktx2','stone');
  await put(pub,'assets/scene-manifest.json',JSON.stringify({chunks:[{url:model}],colorPipeline:{url:'/assets/table.gz',rawURL:'/assets/table'}}));
  await put(pub,'assets/table','lookup');await put(pub,'assets/table.gz','compressed');
  await put(pub,'assets/retired/old.glb','version https://git-lfs.github.com/spec/v1');await put(pub,'studio/card.webp','studio');
  const payload=writeGLB({asset:{version:'2.0'},buffers:[{byteLength:4}],images:[{uri:'../tiles/wood.ktx2'}],extras:{optimized:true}},Buffer.alloc(4));
  const id=hash(payload),prefix='/asset-delivery/'+id,br=brotliCompressSync(payload),gz=gzipSync(payload);
  const entry={identity:prefix+'.glb',br:prefix+'.q9.glb.br',gzip:prefix+'.q9.glb.gz',decodedBytes:payload.length,brBytes:br.length,gzipBytes:gz.length};
  await put(pub,entry.identity,payload);await put(pub,entry.br,br);await put(pub,entry.gzip,gz);
  await put(pub,'asset-delivery/report.json',JSON.stringify([{entry,sha256:id,sourceSHA256:hash(glb)}]));
  const prior='/asset-delivery/'+hash(glb)+'.glb';await put(pub,prior,glb);
  return {pub,model,entry,prior,id,glb,payload,stage:path.join(tmp,'stage')};
}

test('staged public retains rollback, external model images, Studio and raw compatibility assets',async t=>{
  const {pub,model,entry,prior,glb,payload,stage}=await fixture(t);
  const results=await stageReleasePublic(pub,stage,{[model]:entry});
  assert.equal(results.omittedModelBytes,glb.length);
  assert.equal(results.oldHashBytes,glb.length);
  assert.equal(results.unselectedAssetBytes,Buffer.byteLength('version https://git-lfs.github.com/spec/v1'));
  await assert.rejects(fs.access(path.join(stage,model)),{code:'ENOENT'});
  await assert.rejects(fs.access(path.join(stage,'assets/retired/old.glb')),{code:'ENOENT'});
  assert.ok((await fs.readFile(path.join(pub,model))).equals(glb));
  assert.ok((await fs.readFile(path.join(stage,entry.identity))).equals(payload));
  for(const f of [prior,entry.br,entry.gzip,'assets/tiles/wood.ktx2','assets/table','assets/character/Rocketbox-MIT-LICENSE.txt','studio/card.webp'])
    assert.ok((await fs.readFile(path.join(stage,f))).equals(await fs.readFile(path.join(pub,f))));
});

test('missing or invalid encoding stops staging before the output is created',async t=>{
  const {pub,model,entry,stage}=await fixture(t);
  await fs.appendFile(path.join(pub,entry.gzip),'damage');
  await assert.rejects(stageReleasePublic(pub,stage,{[model]:entry}),/Invalid identity/);
  await assert.rejects(fs.access(stage),{code:'ENOENT'});
});

test('source revisions require fresh derivative proof, while no-identity delivery retains originals',async t=>{
  const {pub,model,entry,stage,glb}=await fixture(t);
  const replacement=writeGLB({asset:{version:'2.0'},extras:{revised:true}},Buffer.alloc(4));
  await put(pub,model,replacement);
  await assert.rejects(stageReleasePublic(pub,stage,{[model]:entry}),/Source master changed/);
  await put(pub,model,glb);
  await stageReleasePublic(pub,stage,{[model]:{br:entry.br,gzip:entry.gzip}});
  assert.ok((await fs.readFile(path.join(stage,model))).equals(glb));
  await assert.rejects(stageReleasePublic(pub,pub,{}),/separate/);
});

test('current manifests include every external model image and the fallback LUT',async()=>{
  const root=new URL('../public/',import.meta.url);
  const inputs=await releaseSourceAssets(fileURLToPath(root));
  for(const file of ['/assets/color/blender-agx-medium-high.rgba16f','/assets/v2/textures/studio-hero-base.ktx2','/assets/basis/basis_transcoder.wasm'])
    assert.ok(inputs.has(file),file);
});
