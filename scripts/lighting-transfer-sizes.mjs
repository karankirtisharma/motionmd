import fs from 'node:fs/promises';
import path from 'node:path';

// Version-specific sizes bound read-ahead by encoded source bytes, rather than
// by a number of files (individual lightmaps vary dramatically in size).
export async function writeLightingTransferSizes(root, generated, manifest) {
  const urls = new Set([
    // The chair selects a packed variant or its source on demand. Never warm both.
    ...(manifest.materials ?? []).filter(entry => entry.name !== 'founder__FC91 | fine ivory leather.003').map(entry => entry.lightMap),
    manifest.environment?.url, ...(manifest.reflectionProbes ?? []).map(probe => probe.url),
    manifest.exteriorFinish?.lightMap,
  ].filter(url => typeof url === 'string' && /^\/assets\/[^?#]*\.exr$/i.test(url)));
  const sizes = {};
  for (const url of urls) sizes[url] = (await fs.stat(path.join(root, 'public', url))).size;
  await fs.writeFile(path.join(generated, 'lighting-transfer-sizes.json'), JSON.stringify(sizes) + '\n');
}
