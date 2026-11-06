import assert from 'node:assert/strict';
import { readGLB } from './glb-storage.mjs';
import { writeGLB } from './glb-images.mjs';

// Retire only the two exclusive workstation screenshots. Export masters remain
// intact; delivered GLBs contain neither the old maps nor their BIN payloads.
export function omitRetiredComputerImages(source) {
  const { json, binary } = readGLB(source);
  const imageStart = json.images.length - 2;
  const removedTextures = new Set(json.textures.flatMap((t, i) => t.source >= imageStart ? [i] : []));
  assert.equal(removedTextures.size, 4);
  assert.deepEqual(json.images.slice(imageStart).map(i => i.name), ['MD_workflow_01', 'MD_workflow_02']);
  const removed = json.images.slice(imageStart).map(i => i.bufferView);
  for (let i = 0; i < 2; i++) {
    const m = json.materials.find(m => m.name === `WS72 | calibrated Workstation screen ${i + 1}`);
    assert.ok(m, 'screen material changed: re-audit export');
    assert.equal(json.textures[m.emissiveTexture.index].source, imageStart + i);
    assert.equal(json.textures[m.pbrMetallicRoughness.baseColorTexture.index].source, imageStart + i);
    delete m.emissiveTexture; delete m.pbrMetallicRoughness.baseColorTexture;
  }
  function assertTextureReferences(value, key = '') {
    if (!value || typeof value !== 'object') return;
    if (/Texture$/.test(key) && 'index' in value) { assert.ok(!removedTextures.has(value.index), 'screenshot is shared with another material'); value.index -= [...removedTextures].filter(i => i < value.index).length; }
    for (const [key, child] of Object.entries(value)) assertTextureReferences(child, key);
  }
  assertTextureReferences(json.materials);
  json.images.splice(imageStart); json.textures = json.textures.filter((_, i) => !removedTextures.has(i));
  assert.ok(json.textures.every(t => t.source === undefined || t.source < imageStart));
  const bytes = removed.reduce((sum, i) => sum + json.bufferViews[i].byteLength, 0);
  const mapping = new Map(); let next = 0;
  json.bufferViews.forEach((_, i) => { if (!removed.includes(i)) mapping.set(i, next++); });
  json.bufferViews = json.bufferViews.filter((_, i) => !removed.includes(i));
  function remap(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'bufferView' && typeof child === 'number') {
        assert.ok(mapping.has(child), 'retired image BIN view has another consumer'); value[key] = mapping.get(child);
      } else remap(child);
    }
  }
  remap(json);
  return { buffer: writeGLB(json, binary), retiredImage: { names: ['MD_workflow_01', 'MD_workflow_02'], bytes } };
}
