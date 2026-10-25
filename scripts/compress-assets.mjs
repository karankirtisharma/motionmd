// Writes <chunk>.glb.gz next to each large scene GLB (gzip level 9, byte-identical after
// decompression). Vercel's CDN does not compress model/gltf-binary responses, so the runtime
// fetches the .gz and inflates it with the browser's native DecompressionStream.
// Skips files whose .gz is newer than the source; on a deployment that ships only the .gz
// (raw GLBs listed in .vercelignore) there is nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'assets', 'scene-manifest.json'), 'utf8'));
const MIN_BYTES = 4 * 1024 * 1024;
let written = 0, before = 0, after = 0;
for (const chunk of manifest.chunks) {
  const file = path.join(publicDir, '.' + chunk.url);
  const gz = file + '.gz';
  if (!fs.existsSync(file)) { if (fs.existsSync(gz)) after += fs.statSync(gz).size; continue; }
  const size = fs.statSync(file).size;
  if (size < MIN_BYTES) continue;
  before += size;
  if (!fs.existsSync(gz) || fs.statSync(gz).mtimeMs < fs.statSync(file).mtimeMs) {
    await pipeline(fs.createReadStream(file), zlib.createGzip({ level: 9, memLevel: 9 }), fs.createWriteStream(gz));
    written++;
  }
  after += fs.statSync(gz).size;
}
console.log(`Compressed GLBs: ${written} written; ${(before / 1e6).toFixed(0)} MB -> ${(after / 1e6).toFixed(0)} MB gzip.`);
