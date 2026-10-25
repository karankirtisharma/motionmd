/** Replace only validated atlas image payloads with external KTX2.
 * node tooling/convert-glb-textures.mjs lounge [entrance ...] --write
 * Retains exact meshopt bytes, geometry/accessor semantics, source extras and material factors.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(app, '../..');
const args = process.argv.slice(2), write = args.includes('--write');
const option = name => args.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const assets = path.resolve(option('assets') || path.join(app, 'public/assets'));
const reports = path.resolve(option('reports') || path.join(root, 'work/ktx-validation'));
const publicPrefix = option('public-prefix') || '/assets';
assert(!path.relative(root, assets).startsWith('..') && !path.relative(root, reports).startsWith('..'), 'Staged assets and reports must stay inside the workspace.');
assert(/^\/assets(?:\/[a-zA-Z0-9_-]+)*$/.test(publicPrefix), 'Unsafe public asset prefix.');
const zones = args.filter(a => !a.startsWith('--'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const align = n => (n + 3) & ~3;
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
function assert(value, message) { if (!value) throw new Error(message); }
function parse(bytes) {
  assert(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB header.');
  let document, binary;
  for (let i = 12; i < bytes.length;) {
    const size = bytes.readUInt32LE(i), type = bytes.readUInt32LE(i + 4); i += 8;
    assert(i + size <= bytes.length, 'GLB chunk outside payload.');
    if (type === 0x4e4f534a) document = JSON.parse(bytes.subarray(i, i + size).toString('utf8').trimEnd());
    else if (type === 0x004e4942) binary = bytes.subarray(i, i + size);
    else throw new Error('Unexpected GLB chunk type; refusing destructive rewrite.');
    i += size;
  }
  assert(document && binary, 'Missing GLB JSON or binary.');
  return { document, binary };
}
function serialize(document, binary) {
  const text = Buffer.from(JSON.stringify(document));
  const textSize = align(text.length), binSize = align(binary.length);
  const out = Buffer.alloc(12 + 8 + textSize + 8 + binSize);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(textSize, 12); out.writeUInt32LE(0x4e4f534a, 16); out.fill(0x20, 20, 20 + textSize); text.copy(out, 20);
  out.writeUInt32LE(binSize, 20 + textSize); out.writeUInt32LE(0x004e4942, 24 + textSize); binary.copy(out, 28 + textSize);
  return out;
}
function dataForView(document, binary, index) {
  const view = document.bufferViews[index];
  const storage = view.extensions?.EXT_meshopt_compression ?? view;
  assert(storage.buffer === 0, `Cannot verify non-physical view ${index}.`);
  return binary.subarray(storage.byteOffset ?? 0, (storage.byteOffset ?? 0) + storage.byteLength);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const stable = x => JSON.stringify(canonical(x));

const summaries = [];
assert(zones.length && zones.every(x => ['lounge', 'entrance', 'shell', 'gallery', 'founder', 'studio'].includes(x)), 'Specify exact zone names.');
for (const zone of zones) {
  const filename = path.join(assets, 'geometry', `${zone}.glb`);
  const original = fs.readFileSync(filename), source = parse(original), document = structuredClone(source.document);
  const atlasNamePattern = new RegExp(`^${zone}(?:-[a-z0-9]+)*-(?:base|normal|orm)$`);
  if (document.images.some(image => atlasNamePattern.test(image.name ?? '') && image.uri?.endsWith('.ktx2')) && !document.images.some(image => atlasNamePattern.test(image.name ?? '') && image.mimeType === 'image/png')) {
    console.log(JSON.stringify({ zone, alreadyConverted: true })); continue;
  }
  const replaced = [], removedViews = new Set();
  const atlasNames = document.images.filter(image => atlasNamePattern.test(image.name ?? '')).map(image => image.name);
  assert(atlasNames.length, `${zone}: no identified atlas image payloads.`);
  for (const name of atlasNames) {
    const indices = document.images.flatMap((image, i) => image.name === name ? [i] : []);
    assert(indices.length === 1, `${name}: expected one source atlas image.`);
    const imageIndex = indices[0], image = document.images[imageIndex];
    const validation = json(path.join(reports, `${name}.json`));
    const encoded = fs.readFileSync(path.join(assets, 'textures', `${name}.ktx2`));
    const png = fs.readFileSync(path.join(assets, 'textures', `${name}.png`));
    assert(validation.ok && validation.sourceSHA256 === hash(png) && validation.outputSHA256 === hash(encoded), `${name}: missing or stale successful texture validation.`);
    assert(image.mimeType === 'image/png' && Number.isInteger(image.bufferView), `${name}: expected embedded source PNG.`);
    assert(hash(dataForView(document, source.binary, image.bufferView)) === hash(png), `${name}: embedded atlas differs from validated original PNG.`);
    assert(!document.images.some((other, i) => i !== imageIndex && other.bufferView === image.bufferView), `${name}: image view is shared unexpectedly.`);
    removedViews.add(image.bufferView);
    delete image.bufferView; image.uri = `../textures/${name}.ktx2`; image.mimeType = 'image/ktx2';
    let uses = 0;
    for (const texture of document.textures ?? []) if (texture.source === imageIndex) {
      texture.extensions = { ...(texture.extensions ?? {}), KHR_texture_basisu: { source: imageIndex } }; delete texture.source; uses++;
    }
    assert(uses > 0, `${name}: unused atlas.`);
    replaced.push({ name, imageIndex, originalBytes: png.length, bytes: encoded.length, uses, quality: validation.quality });
  }
  const ranges = [...removedViews].map(i => {
    const v = source.document.bufferViews[i];
    assert(v.buffer === 0 && !v.extensions?.EXT_meshopt_compression, 'Atlas unexpectedly shares compressed geometry.');
    const start = v.byteOffset ?? 0, dataEnd = start + v.byteLength, end = align(dataEnd);
    for (let p = dataEnd; p < end; p++) assert(source.binary[p] === 0, 'Nonzero data in proposed PNG alignment padding.');
    return { start, end };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) assert(ranges[i].start >= ranges[i - 1].end, 'Overlapping atlas payload ranges.');
  const translated = offset => {
    let remove = 0;
    for (const r of ranges) { assert(offset < r.start || offset >= r.end, 'Retained data points into removed atlas.'); if (offset >= r.end) remove += r.end - r.start; }
    return offset - remove;
  };
  const parts = []; let cursor = 0;
  for (const r of ranges) { parts.push(source.binary.subarray(cursor, r.start)); cursor = r.end; }
  parts.push(source.binary.subarray(cursor)); const binary = Buffer.concat(parts);
  const mapping = new Map(), views = [];
  for (const [oldIndex, view] of document.bufferViews.entries()) if (!removedViews.has(oldIndex)) {
    const storage = view.extensions?.EXT_meshopt_compression ?? view;
    if (storage.buffer === 0) {
      const begin = storage.byteOffset ?? 0, end = begin + storage.byteLength;
      assert(!ranges.some(r => begin < r.end && end > r.start), 'Retained view overlaps atlas removal.');
      storage.byteOffset = translated(begin);
    }
    mapping.set(oldIndex, views.length); views.push(view);
  }
  document.bufferViews = views;
  function remapViews(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'extras') continue; // User metadata is not part of the glTF buffer-view graph.
      if (key === 'bufferView' && Number.isInteger(item)) { assert(mapping.has(item), 'A retained object references a removed image view.'); value[key] = mapping.get(item); }
      else remapViews(item);
    }
  }
  remapViews(document);
  document.buffers[0].byteLength = binary.length;
  const samplerMap = new Map(), samplerIndex = new Map(), samplers = [];
  for (const [i, sampler] of (document.samplers ?? []).entries()) {
    const key = stable(sampler);
    if (!samplerMap.has(key)) { samplerMap.set(key, samplers.length); samplers.push(sampler); }
    samplerIndex.set(i, samplerMap.get(key));
  }
  for (const texture of document.textures ?? []) if (texture.sampler !== undefined) texture.sampler = samplerIndex.get(texture.sampler);
  if (document.samplers) document.samplers = samplers;
  document.extensionsUsed = [...new Set([...(document.extensionsUsed ?? []), 'KHR_texture_basisu'])];
  document.extensionsRequired = [...new Set([...(document.extensionsRequired ?? []), 'KHR_texture_basisu'])];
  const output = serialize(document, binary), check = parse(output);
  for (const property of ['nodes', 'meshes', 'materials', 'scenes', 'scene', 'skins', 'animations']) assert(stable(check.document[property]) === stable(source.document[property]), `${zone}: ${property} changed unexpectedly.`);
  for (const [before, after] of mapping) assert(hash(dataForView(source.document, source.binary, before)) === hash(dataForView(check.document, check.binary, after)), `${zone}: retained view ${before} data changed.`);
  const expectedAccessors = structuredClone(source.document.accessors); remapViews(expectedAccessors);
  assert(stable(expectedAccessors) === stable(check.document.accessors), `${zone}: accessor semantics changed.`);
  const summary = { zone, geometryBytesUnchanged: true, geometryObjectsUnchanged: true, materialsUnchanged: true, sourceSHA256: hash(original), outputSHA256: hash(output), originalGLBBytes: original.length, glbBytes: output.length, textureURLs: replaced.map(t => `${publicPrefix}/textures/${t.name}.ktx2`), textureBytes: replaced.reduce((sum, t) => sum + t.bytes, 0), originalSamplers: source.document.samplers?.length ?? 0, samplers: samplers.length, replaced, written: write };
  if (write) {
    const backupDir = path.join(root, 'work/glb-originals'); fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${zone}-${hash(original).slice(0, 12)}.glb`); if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
    fs.writeFileSync(filename + '.tmp', output); fs.renameSync(filename + '.tmp', filename);
    // Re-read immediately before modifying JSON, preserving independently generated runtime data.
    const manifestPath = path.join(assets, 'scene-manifest.json');
    if (fs.existsSync(manifestPath)) {
    const manifest = json(manifestPath);
    const chunk = manifest.chunks.find(c => c.id === zone); assert(chunk, `${zone}: no manifest chunk.`);
    chunk.bytes = output.length;
    chunk.textureURLs = replaced.map(t => `${publicPrefix}/textures/${t.name}.ktx2`);
    chunk.textureBytes = replaced.reduce((sum, t) => sum + t.bytes, 0);
    manifest.textureCompression = { format: 'KTX2 UASTC', quality: 'Slower, no RDO', mipmaps: true, report: `${publicPrefix}/texture-validation.json`, geometryChanged: false };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    const reportFile = path.join(assets, 'texture-validation.json');
    const report = fs.existsSync(reportFile) ? json(reportFile) : { encoder: 'Khronos KTX 4.4.2', chunks: [] };
    report.chunks = [...report.chunks.filter(c => c.zone !== zone), summary];
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  }
  summaries.push(summary); console.log(JSON.stringify(summary));
}
