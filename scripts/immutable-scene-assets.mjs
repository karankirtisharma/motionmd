import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { releaseSourceAssets } from './release-public.mjs';

const exr = Buffer.from([0x76,0x2f,0x31,0x01]);
const ktx2 = Buffer.from('ab4b5458203230bb0d0a1a0a','hex');

export async function immutableSceneAssetHashes(publicRoot, urls) {
  const hashes = {};
  for (const url of [...urls].sort()) {
    if (!/\.(exr|ktx2)$/i.test(url)) continue;
    if (!url.startsWith('/assets/') || /[\\%?#]/.test(url) || url.split('/').some(p => p === '..' || p === '.')) throw Error('Unsafe scene asset URL: ' + url);
    const hash = createHash('sha256'), signature = url.toLowerCase().endsWith('.exr') ? exr : ktx2;
    let checked = false;
    for await (const bytes of createReadStream(path.join(publicRoot, url))) {
      if (!checked && !bytes.subarray(0, signature.length).equals(signature)) throw Error('Invalid or unhydrated scene texture: ' + url);
      checked = true;
      hash.update(bytes);
    }
    if (!checked) throw Error('Empty scene texture: ' + url);
    hashes[url] = hash.digest('hex');
  }
  return hashes;
}

export async function writeImmutableSceneAssetHashes(root, generated, enabled) {
  const publicRoot = path.join(root, 'public');
  const hashes = enabled ? await immutableSceneAssetHashes(publicRoot, await releaseSourceAssets(publicRoot)) : {};
  const sizes = {};
  for (const url of Object.keys(hashes)) if (url.endsWith('.ktx2')) sizes[url] = (await fs.stat(path.join(publicRoot, url))).size;
  await fs.writeFile(path.join(generated, 'texture-transfer-sizes.json'), JSON.stringify(sizes) + '\n');
  const output = path.join(generated, 'immutable-scene-assets.json');
  await fs.writeFile(output + '.tmp', JSON.stringify(hashes, null, 2) + '\n');
  await fs.rename(output + '.tmp', output);
}
