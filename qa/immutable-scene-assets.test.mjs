import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { immutableSceneAssetHashes } from '../scripts/immutable-scene-assets.mjs';

test('only declared scene EXRs and KTX2s are hashed from real bytes, and revisions change with those bytes', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'md-raw-revision-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const assets=path.join(root,'assets');await fs.mkdir(assets);
  const a=Buffer.from([0x76,0x2f,0x31,0x01,0,1]), b=Buffer.from('ab4b5458203230bb0d0a1a0a01','hex');
  await fs.writeFile(path.join(assets,'a.exr'),a);await fs.writeFile(path.join(assets,'b.ktx2'),b);
  const urls=new Set(['/assets/a.exr','/assets/b.ktx2','/assets/other.png']), hashes=await immutableSceneAssetHashes(root,urls);
  assert.deepEqual(hashes,{'/assets/a.exr':createHash('sha256').update(a).digest('hex'),'/assets/b.ktx2':createHash('sha256').update(b).digest('hex')});
  await fs.appendFile(path.join(assets,'a.exr'),Buffer.from([2])); const next=await immutableSceneAssetHashes(root,urls);
  assert.notEqual(next['/assets/a.exr'], hashes['/assets/a.exr']);assert.equal(next['/assets/b.ktx2'],hashes['/assets/b.ktx2']);
  await fs.writeFile(path.join(assets,'b.ktx2'),'version https://git-lfs.github.com/spec/v1');
  await assert.rejects(immutableSceneAssetHashes(root,urls),/unhydrated/);
});
