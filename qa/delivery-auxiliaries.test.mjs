import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { readGLB } from '../scripts/glb-storage.mjs';
import { hasRetiredStudioImage, omitRetiredStudioImage } from '../scripts/retired-studio-image.mjs';

const pub=new URL('../public/',import.meta.url);
const read=url=>fs.readFileSync(new URL('.'+url,pub));
const manifest=JSON.parse(read('/assets/scene-manifest.json'));
const index=JSON.parse(fs.readFileSync(new URL('../src/generated/asset-delivery.json',import.meta.url)));
test('collision variants decode to the entire original file, including node transforms and triangle ordering', {
  skip:!!process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim(),
},() => {
  for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]) {
    const source=read(url),entry=index[url];
    assert.ok(entry && !entry.identity,url+' retains the original identity representation');
    assert.ok(brotliDecompressSync(read(entry.br)).equals(source));
    assert.ok(gunzipSync(read(entry.gzip)).equals(source));
  }
});

test('only the retired two globe bindings and their storage change in the pinned TV source', () => {
  const url='/assets/architecture-v16/lounge.glb',source=read(url);
  const digest=createHash('sha256').update(source).digest('hex');
  assert.equal(hasRetiredStudioImage(url,digest,'different display'),false);
  assert.equal(hasRetiredStudioImage(url,'new export',manifest.screen.objectName),false);
  if(!hasRetiredStudioImage(url,digest,manifest.screen.objectName)) return;
  const a=readGLB(source), stripped=omitRetiredStudioImage(source),b=readGLB(stripped.buffer);
  const material=a.json.materials[19];
  assert.equal(material.emissiveTexture.index,27);assert.equal(material.pbrMetallicRoughness.baseColorTexture.index,28);
  assert.equal(a.json.images[9].name,'golden_globe_display');assert.equal(a.json.images[9].bufferView,183);
  assert.ok(b.binary.equals(a.binary));
  const expected=structuredClone(a.json);
  delete expected.materials[19].emissiveTexture;
  delete expected.materials[19].pbrMetallicRoughness.baseColorTexture;
  expected.textures.splice(27,2);expected.images.splice(9,1);
  expected.bufferViews.splice(183,1);
  for(const accessor of expected.accessors) if(accessor.bufferView>183) accessor.bufferView--;
  assert.deepEqual(b.json,expected,'all other geometry, node and material bindings still reference the same bytes');
  assert.ok(fs.readFileSync(new URL('.'+url,pub)).equals(source),'master is untouched');
});
