/**
 * Assemble the preview for a static host that serves only web file types and
 * must not carry the site's name: a self-contained folder.
 *
 *   node tools/hosted-preview.mjs [--out hosted] [--brand "Studio name"]
 *
 * It holds index.html, dist/ and the assets the preview loads. Two things
 * differ from the local preview, and only these:
 *   - the header shows a placeholder where the site shows its own name;
 *   - the .glb files are written as { "base64": "…" } in .json files,
 *     for hosts that refuse the .glb extension. The bytes are the same.
 * Run `npm run build` first.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const out = resolve(root, option('out', 'hosted'));
const brand = option('brand', 'Studio name');

if (!existsSync(join(root, 'dist/demo.js'))) throw new Error('Run `npm run build` first.');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets/models'), { recursive: true });

// The page: index.html with the placeholder name and the wrapped models.
const page = readFileSync(join(root, 'index.html'), 'utf8');
const mount = '<main id="living-maquette" data-asset-base="./assets/"></main>';
if (!page.includes(mount)) throw new Error('index.html no longer has the expected mount element.');
writeFileSync(join(out, 'index.html'), page
  .replace(mount, `<main id="living-maquette" data-asset-base="./assets/" data-brand="${brand.replace(/"/g, '&quot;')}" data-models="json"></main>`)
  .replace(/<title>[^<]*<\/title>/, '<title>Living Maquette intro preview</title>'));

// Scripts, styles and fonts as built (the build report is not part of the page).
cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true, filter: (source) => !source.endsWith('build-report.json') && !source.endsWith('living-maquette.js') });
// Stills and study images as they are.
cpSync(join(root, 'assets/images'), join(out, 'assets/images'), { recursive: true });
cpSync(join(root, 'assets/models/scene_manifest.json'), join(out, 'assets/models/scene_manifest.json'));
for (const name of ['Living_Maquette_meshopt.glb', 'Living_Maquette_quantized.glb', 'MotionFloor_Furnishings_meshopt.glb', 'MotionFloor_Furnishings_quantized.glb']) {
  const bytes = readFileSync(join(root, 'assets/models', name));
  writeFileSync(join(out, 'assets/models', `${name}.json`), JSON.stringify({ file: name, bytes: bytes.length, base64: bytes.toString('base64') }));
}

const files = [];
const walk = (folder) => {
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push({ as: relative(out, path).split('\\').join('/'), path, bytes: statSync(path).size });
  }
};
walk(out);
files.sort((a, b) => (a.as === 'index.html' ? -1 : b.as === 'index.html' ? 1 : a.as.localeCompare(b.as)));
writeFileSync(join(out, 'files.json'), JSON.stringify(files.map(({ as, path }) => ({ as, path })), null, 1));
console.log(`${files.length} files, ${(files.reduce((sum, file) => sum + file.bytes, 0) / 1e6).toFixed(2)} MB in ${relative(root, out)}/`);
