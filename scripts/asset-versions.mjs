// Writes public/assets/asset-versions.json: a short content hash for every served asset.
// The runtime appends ?v=<hash> to each asset URL, and next.config.ts marks versioned
// requests immutable, so returning visitors load the scene from their browser cache.
// Generated at build (prebuild); not committed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'public', 'assets');
const output = path.join(assets, 'asset-versions.json');
const skip = new Set(['asset-versions.json', 'scene-manifest.json']); // both are fetched no-store
const files = {};
let bytes = 0;
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { walk(file); continue; }
    if (!item.isFile() || skip.has(item.name)) continue;
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r'), chunk = Buffer.allocUnsafe(1 << 22);
    try { for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) { hash.update(chunk.subarray(0, n)); bytes += n; } }
    finally { fs.closeSync(fd); }
    files['/' + path.relative(path.join(root, 'public'), file).split(path.sep).join('/')] = hash.digest('hex').slice(0, 16);
  }
}
const started = Date.now();
walk(assets);
fs.writeFileSync(output, JSON.stringify({ generated: new Date().toISOString(), files }));
console.log(`Asset versions: ${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(0)} MB hashed in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
