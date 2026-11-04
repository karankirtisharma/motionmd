import test from 'node:test';
import assert from 'node:assert/strict';
import raw from '../src/generated/immutable-scene-assets.json' with {type:'json'};
import { assetURL, resolveAssetDependency } from '../src/runtime/rendering/assets.ts';
import { versionedAssetPath } from '../src/server/assetRevision.ts';

test('local EXRs and relative same-origin KTX2 references use their true file hash and retain other parameters',()=>{
  const exr=Object.keys(raw).find(k=>k.endsWith('.exr')), ktx=Object.keys(raw).find(k=>k.endsWith('.ktx2'));
  if(!exr||!ktx) {assert.ok(process.env.NEXT_PUBLIC_ASSET_BASE_URL); return;}
  assert.equal(assetURL(exr+'?quality=full'),exr+'?quality=full&v='+raw[exr]);
  const origin='https://lounge.example', parent=origin+ktx.slice(0,ktx.lastIndexOf('/')+1)+'model.glb';
  const filename=ktx.slice(ktx.lastIndexOf('/')+1), expected=ktx+'?input=1&v='+raw[ktx]+'#surface';
  assert.equal(resolveAssetDependency(filename+'?input=1#surface','',parent),expected);
  assert.equal(resolveAssetDependency(origin+ktx+'?input=1#surface','',parent),origin+expected);
  assert.equal(resolveAssetDependency(ktx+'?v=old','',parent),ktx+'?v='+raw[ktx]);
  assert.equal(resolveAssetDependency('https://other.example'+ktx,'',parent),'https://other.example'+ktx);
  assert.equal(resolveAssetDependency(ktx,'https://cdn.example/release',parent),'https://cdn.example/release'+ktx);
  for(const value of ['blob:https://lounge.example/abc','data:application/octet-stream;base64,AQ==']) assert.equal(resolveAssetDependency(value,'',parent),value);
  assert.equal(versionedAssetPath('/assets/different.png',{},raw),'/assets/different.png');
  assert.equal(versionedAssetPath('/assets/unverified.exr',{}, {'/assets/unverified.exr':'unverified'}),'/assets/unverified.exr');
});
