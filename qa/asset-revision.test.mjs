import test from 'node:test';
import assert from 'node:assert/strict';
import { assetRevision, versionedAssetPath, assetCacheControl } from '../src/server/assetRevision.ts';
const digest = 'a'.repeat(64), entry = {br:`/asset-delivery/${digest}.q9.glb.br`};
test('only a current generated payload hash enables immutable caching', () => {
  assert.equal(assetRevision(entry),digest);
  assert.equal(assetCacheControl(digest,entry),'public, max-age=31536000, immutable');
  for (const revision of [null,'old','b'.repeat(64)]) assert.equal(assetCacheControl(revision,entry),'public, max-age=0, must-revalidate');
  assert.equal(assetCacheControl(digest,{br:'/asset-delivery/custom.glb.br'}),'public, max-age=0, must-revalidate');
});
test('local GLBs are versioned without changing their dependency directory or unrelated query parameters', () => {
  const entries = {'/assets/room/scene.glb':entry};
  assert.equal(versionedAssetPath('/assets/room/scene.glb?test=1#detail',entries),`/assets/room/scene.glb?test=1&v=${digest}#detail`);
  assert.equal(versionedAssetPath('/assets/room/scene.glb?v=stale',entries),`/assets/room/scene.glb?v=${digest}`);
  for (const path of ['/assets/unknown.glb','/assets/room/map.png','https://cdn.example/scene.glb','blob:local']) assert.equal(versionedAssetPath(path,entries),path);
});
