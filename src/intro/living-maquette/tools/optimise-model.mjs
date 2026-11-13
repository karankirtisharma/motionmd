/**
 * Make the runtime derivative of the kit's LOD model: the same nodes, meshes
 * and materials, with the four embedded 512 px PNG base-colour images
 * re-encoded as WebP (EXT_texture_webp). Geometry, names and extras are left
 * byte for byte, so the scene adapter and manifest apply unchanged.
 *
 *   node tools/optimise-model.mjs <kit>/03_models/Living_Maquette_LOD.glb models-source/Living_Maquette_LOD_web.glb [--quality 0.86]
 *
 * The images are encoded by Chrome through Playwright (see tools/capture.mjs),
 * which keeps this free of native image libraries.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/optimise-model.mjs <input.glb> <output.glb> [--quality 0.86]');
  process.exit(1);
}
const quality = rest.includes('--quality') ? Number(rest[rest.indexOf('--quality') + 1]) : 0.86;

const source = readFileSync(input);
if (source.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a binary glTF file');
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;
const bin = source.subarray(binStart, binStart + source.readUInt32LE(20 + jsonLength));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const dir = process.env.PLAYWRIGHT_DIR;
    if (!dir) throw new Error('Playwright is not installed. Run `npm i -D playwright`, or set PLAYWRIGHT_DIR to a node_modules folder that has it.');
    return createRequire(dir.endsWith('/') ? dir : `${dir}/`)('playwright');
  }
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
  headless: true,
});
const page = await browser.newPage();
await page.goto('about:blank');

const replaced = new Map(); // bufferView index -> Buffer
for (const [index, image] of (json.images ?? []).entries()) {
  if (image.bufferView === undefined || image.mimeType !== 'image/png') continue;
  const view = json.bufferViews[image.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const encoded = await page.evaluate(async ({ base64, q }) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, dataUrl: canvas.toDataURL('image/webp', q) };
  }, { base64: bytes.toString('base64'), q: quality });
  const webp = Buffer.from(encoded.dataUrl.split(',')[1], 'base64');
  replaced.set(image.bufferView, webp);
  image.mimeType = 'image/webp';
  console.log(`image ${index} ${image.name ?? ''}  ${encoded.width}x${encoded.height}  ${(bytes.length / 1024).toFixed(0)} KB png -> ${(webp.length / 1024).toFixed(0)} KB webp`);
}
await browser.close();

// Textures point at their WebP image through the extension (no PNG fallback is kept).
for (const texture of json.textures ?? []) {
  const image = json.images[texture.source];
  if (image?.mimeType !== 'image/webp') continue;
  texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: texture.source } };
  delete texture.source;
}
const declare = (key) => { json[key] = [...new Set([...(json[key] ?? []), 'EXT_texture_webp'])]; };
declare('extensionsUsed');
declare('extensionsRequired');

// Rebuild the binary chunk view by view, 4-byte aligned, in the original order.
const order = json.bufferViews.map((view, index) => ({ view, index })).sort((a, b) => (a.view.byteOffset ?? 0) - (b.view.byteOffset ?? 0));
const parts = [];
let offset = 0;
for (const { view, index } of order) {
  const bytes = replaced.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  view.byteOffset = offset;
  view.byteLength = bytes.length;
  parts.push(bytes);
  offset += bytes.length;
  const padding = (4 - (offset % 4)) % 4;
  if (padding) { parts.push(Buffer.alloc(padding)); offset += padding; }
}
json.buffers[0].byteLength = offset;
json.asset = { ...json.asset, extras: { ...(json.asset.extras ?? {}), derivative: 'Living Maquette runtime derivative: base-colour images re-encoded as WebP; geometry unchanged' } };

let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
const binBytes = Buffer.concat(parts);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
const chunk = (type, bytes) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(bytes.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, bytes]);
};
const result = Buffer.concat([header, chunk(0x4e4f534a, jsonBytes), chunk(0x004e4942, binBytes)]);
writeFileSync(output, result);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`${input.split('/').pop()}: ${kb(source.length)} (${kb(gzipSync(source, { level: 9 }).length)} gzip)`);
console.log(`${output.split('/').pop()}: ${kb(result.length)} (${kb(gzipSync(result, { level: 9 }).length)} gzip)`);
