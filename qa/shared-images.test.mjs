import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { Texture } from 'three';
import { embeddedSourceKey, identifySharedImages } from '../src/runtime/rendering/sharedImages.ts';

test('only identical embedded artwork/plant images from the three shipping rooms share a source key', async () => {
  const keys = new Map();
  for (const file of ['architecture-v19/entrance', 'architecture-v16/studio', 'architecture-v21/founder']) {
    const fd = await open(new URL('../public/assets/' + file + '.glb', import.meta.url), 'r');
    try {
      const header = Buffer.alloc(20);
      await fd.read(header, 0, header.length, 0);
      const jsonBytes = Buffer.alloc(header.readUInt32LE(12));
      await fd.read(jsonBytes, 0, jsonBytes.length, 20);
      const json = JSON.parse(jsonBytes);
      const associations = new Map(json.textures.map((_, index) => [new Texture(), { textures: index }]));
      await identifySharedImages({ json, associations, async getDependency(kind, index) {
        assert.equal(kind, 'bufferView');
        const view = json.bufferViews[index];
        const bytes = new Uint8Array(view.byteLength);
        await fd.read(bytes, 0, bytes.length, 28 + jsonBytes.length + (view.byteOffset ?? 0));
        return bytes.buffer;
      } });
      for (const [texture, { textures }] of associations) {
        const image = json.images[json.textures[textures].source];
        const key = embeddedSourceKey(texture);
        if (key === texture.source.uuid) continue;
        assert.equal(embeddedSourceKey(texture.clone()), key);
        const item = keys.get(image.name) ?? { key, files: new Set() };
        assert.equal(item.key, key);
        item.files.add(file);
        keys.set(image.name, item);
      }
    } finally { await fd.close(); }
  }
  assert.equal(keys.size, 8);
  assert.ok([...keys.values()].every(entry => entry.files.size === 2));
});

test('changed artwork with an identical name stays distinct, and an unavailable fingerprint uses the decoded source', async () => {
  async function source(byte) {
    const texture = new Texture();
    await identifySharedImages({
      json: { textures: [{ source: 0 }], images: [{ name: 'founder_art', mimeType: 'image/png', bufferView: 0 }] },
      associations: new Map([[texture, { textures: 0 }]]),
      async getDependency() {
        if (byte === null) throw new Error('unavailable');
        return Uint8Array.of(byte).buffer;
      },
    });
    return texture;
  }
  assert.notEqual(embeddedSourceKey(await source(1)), embeddedSourceKey(await source(2)));
  const fallback = await source(null);
  assert.equal(embeddedSourceKey(fallback), fallback.source.uuid);
});