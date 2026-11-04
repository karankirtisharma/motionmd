import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import verified from './verified-texture-images.json' with { type: 'json' };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Original PNGs stay available. These specific source/output pairs passed
 * browser ImageBitmap and HTMLImageElement RGBA readback, including normal maps.
 * A source revision or different encoder result falls back to the original. */
export async function prepareTextureDelivery(root, enabled) {
  const output = path.join(root, 'public', 'asset-delivery');
  const index = {};
  if (enabled) {
    for (const [url, proof] of Object.entries(verified)) {
      let original;
      try { original = await fs.readFile(path.join(root, 'public', url)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (sha256(original) !== proof.source) continue;
      const name = `${proof.webp}.webp`;
      const target = path.join(output, name);
      let bytes;
      try { bytes = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!bytes || sha256(bytes) !== proof.webp) {
        bytes = await sharp(original).webp({ lossless: true, effort: 5 }).toBuffer();
        if (sha256(bytes) !== proof.webp || bytes.length >= original.length) continue;
        await fs.writeFile(target + '.tmp', bytes);
        await fs.rename(target + '.tmp', target);
      }
      index[url] = { webp: '/asset-delivery/' + name, sourceBytes: original.length, webpBytes: bytes.length };
    }
  }
  const manifest = path.join(root, 'src/generated/texture-delivery.json');
  await fs.writeFile(manifest + '.tmp', JSON.stringify(index, null, 2) + '\n');
  await fs.rename(manifest + '.tmp', manifest);
  const saved = Object.values(index).reduce((sum, entry) => sum + entry.sourceBytes - entry.webpBytes, 0);
  console.log(`Verified image variants: ${Object.keys(index).length} textures, ${(saved / 1e6).toFixed(2)} MB smaller than their PNG representations.`);
  return index;
}
