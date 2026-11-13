/**
 * Bundle the intro for static hosting: node tools/build.mjs
 *
 *   dist/living-maquette.js   library entry (mountLivingMaquette); first-paint code only
 *   dist/demo.js              standalone preview on the simulated host
 *   dist/chunks/*             shared code and the lazily loaded renderer (three.js r186)
 *   dist/intro.css, demo.css  styles, with the subset fonts copied next to them
 *   dist/build-report.json    byte sizes, raw and gzip, for the runtime-cost record
 *
 * A site that already bundles three.js imports src/index.mjs instead, so that
 * its own bundler shares one copy of three.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = { bundle: true, minify: true, target: ['es2020'], logLevel: 'warning', legalComments: 'none' };

const js = await build({
  ...common,
  absWorkingDir: root,
  entryPoints: { 'living-maquette': 'src/index.mjs', demo: 'src/demo/demo.mjs' },
  format: 'esm',
  splitting: true,
  outdir: out,
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  banner: { js: '/* Living Maquette intro. three.js r186 (MIT) is bundled in the scene chunk. */' },
});

await build({
  ...common,
  absWorkingDir: root,
  entryPoints: { intro: 'src/ui/intro.css', demo: 'src/demo/demo.css' },
  outdir: out,
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]',
});

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(out).filter((path) => !path.endsWith('build-report.json')).map((path) => {
  const bytes = readFileSync(path);
  return { file: relative(root, path), bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}).sort((a, b) => a.file.localeCompare(b.file));

// What the first paint needs versus what arrives later.
const outputs = js.metafile.outputs;
const staticClosure = (entry) => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const item of outputs[file]?.imports ?? []) if (item.kind === 'import-statement') visit(item.path);
  };
  visit(entry);
  return [...seen];
};
const size = (list) => list.reduce((sum, file) => {
  const found = files.find((item) => item.file === file);
  return { bytes: sum.bytes + (found?.bytes ?? 0), gzip: sum.gzip + (found?.gzip ?? 0) };
}, { bytes: 0, gzip: 0 });
const firstPaint = staticClosure('dist/living-maquette.js');
const lazy = Object.keys(outputs).filter((file) => file.endsWith('.js') && !firstPaint.includes(file) && !staticClosure('dist/demo.js').filter((f) => !firstPaint.includes(f)).includes(file));

const report = {
  built: new Date().toISOString(),
  three: JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version,
  firstPaintScript: { files: firstPaint, ...size(firstPaint) },
  lazySceneScript: { files: lazy, ...size(lazy) },
  files,
};
writeFileSync(join(out, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`first paint script: ${(report.firstPaintScript.gzip / 1024).toFixed(1)} KB gzip (${firstPaint.length} files)`);
console.log(`lazy scene script:  ${(report.lazySceneScript.gzip / 1024).toFixed(1)} KB gzip (${lazy.length} files)`);
for (const file of files) console.log(`${String(file.bytes).padStart(9)}  ${String(file.gzip).padStart(8)} gz  ${file.file}`);
