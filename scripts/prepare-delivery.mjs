import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBrotliCompress, createBrotliDecompress, createGzip, createGunzip, constants } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { compactGLB } from './glb-storage.mjs';
import { pruneUnusedGeometry } from './glb-live-accessors.mjs';
import { writeLightingTransferSizes } from './lighting-transfer-sizes.mjs';
import { writeImmutableSceneAssetHashes } from './immutable-scene-assets.mjs';
import { optimizeGLBImages } from './glb-images.mjs';
import { optimizeMeshoptStreams } from './glb-meshopt.mjs';
import { prepareTextureDelivery } from './external-images.mjs';
import { prepareChairLightmap } from './chair-lightmap.mjs';
import { omitRetiredComputerImages } from './retired-computer-images.mjs';
import { hasRetiredStudioImage, omitRetiredStudioImage } from './retired-studio-image.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/asset-delivery');
const generated = path.join(root, 'src/generated');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(generated, { recursive: true });
const lightingManifest = JSON.parse(await fs.readFile(path.join(root, 'public/assets/scene-manifest.json'), 'utf8'));
await writeLightingTransferSizes(root, generated, lightingManifest);
await writeImmutableSceneAssetHashes(root, generated, !process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim());
const textureIndex = await prepareTextureDelivery(root, !process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim() && process.env.MD_GEOMETRY_STORAGE !== '0');
await prepareChairLightmap(root, !process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim() && process.env.MD_GEOMETRY_STORAGE !== '0');
if (process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim()) {
  await fs.writeFile(path.join(generated,'asset-delivery.json'),'{}\n');
  console.log('External asset origin: configure Brotli/Content-Encoding at the CDN; local rewrites are disabled.');
  process.exit(0);
}
const manifest = lightingManifest;
async function hashStream(...streams) {
  const hash = createHash('sha256');
  await pipeline(...streams, new Writable({ write(data, _, done) { hash.update(data); done(); } }));
  return hash.digest('hex');
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const index = {}, report = [], retained = new Set(Object.values(textureIndex).map(entry => path.basename(entry.webp)));
let previous=[]; try { previous=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8')); } catch {}
const chunks=[...manifest.chunks, {id:'character',url:manifest.character.url}];
// Physics uses GLBs too. Serve compressed, versioned ORIGINAL bytes for them;
// even their generator metadata and triangle ordering remain identical.
if (manifest.collisions?.url) {
  const urls=[manifest.collisions.url,...(manifest.collisions.additionalUrls ?? [])];
  for (const [i,url] of urls.entries()) chunks.push({id:'collision-'+(i+1),url,transportOnly:true});
}
for (const chunk of chunks) {
  const originalPath = path.resolve(root, 'public', '.' + chunk.url);
  if (!originalPath.startsWith(path.join(root, 'public/assets') + path.sep)) throw Error('Invalid asset path');
  const original = await fs.readFile(originalPath);
  if (original.length < 128 || original.subarray(0,4).toString() !== 'glTF') throw Error('Hydrate the source GLB before preparing delivery: ' + chunk.url);
  const sourceSHA256 = digest(original);
  const storageEnabled=!chunk.transportOnly && process.env.MD_GEOMETRY_STORAGE !== '0';
  const removeGlobe=storageEnabled && hasRetiredStudioImage(chunk.url,sourceSHA256,manifest.screen?.objectName);
  // Other rooms did not produce a meaningful Brotli gain in the exact-content A/B.
  const pruneGeometry=storageEnabled && ['studio','lounge','entrance','founder'].includes(chunk.id);
  const removeComputerImages=storageEnabled && chunk.id==='studio' && chunk.url==='/assets/architecture-v16/studio.glb';
  const pipelineVersion=removeComputerImages ? 6 : pruneGeometry ? 5 : removeGlobe ? 4 : 3;
  const cached=previous.find(r=>r.id===chunk.id && r.sourceSHA256===sourceSHA256 && r.pipelineVersion===pipelineVersion && r.storageEnabled===storageEnabled);
  if(cached){
    let valid=true;
    for(const [encoding,url] of Object.entries(cached.entry).filter(([key])=>['br','gzip','identity'].includes(key))){
      try {const streams=[createReadStream(path.join(root,'public',url))]; if(encoding==='br')streams.push(createBrotliDecompress());if(encoding==='gzip')streams.push(createGunzip());if(await hashStream(...streams)!==cached.sha256)valid=false;}catch{valid=false;}
    }
    if(valid){index[chunk.url]=cached.entry;report.push(cached); for(const key of ['identity','br','gzip'])if(cached.entry[key])retained.add(path.basename(cached.entry[key]));continue;}
  }
  const display=removeComputerImages ? omitRetiredComputerImages(original) : removeGlobe ? omitRetiredStudioImage(original) : null;
  const pruned=pruneGeometry ? pruneUnusedGeometry(display?.buffer ?? original) : null;
  const imageResult=storageEnabled?await optimizeGLBImages(pruned?.buffer ?? display?.buffer ?? original):{buffer:original,images:[]};
  const meshopt = storageEnabled ? await optimizeMeshoptStreams(imageResult.buffer) : {buffer:original,streams:[]};
  const compact = storageEnabled ? compactGLB(meshopt.buffer) : {buffer:original,verifiedRanges:0};
  const saved = original.length - compact.buffer.length;
  // Tiny gains do not justify another identity representation.
  const optimized = saved >= 65536 || saved > original.length * .01;
  const bytes = optimized ? compact.buffer : original;
  const sha256 = digest(bytes), entry = { decodedBytes: bytes.length };
  let source = originalPath;
  if (optimized) {
    const name = sha256 + '.glb';
    retained.add(name); source = path.join(output,name);
    let valid = false;
    try { valid = await hashStream(createReadStream(source)) === sha256; } catch {}
    if (!valid) { await fs.writeFile(source + '.tmp',bytes); await fs.rename(source + '.tmp',source); }
    entry.identity = '/asset-delivery/' + name;
  }
  for (const encoding of ['br', 'gzip']) {
    const name = sha256 + '.q9.glb.' + (encoding === 'br' ? 'br' : 'gz');
    retained.add(name);
    const target = path.join(output, name);
    let valid = false;
    try { valid = await hashStream(createReadStream(target), encoding === 'br' ? createBrotliDecompress() : createGunzip()) === sha256; } catch {}
    if (!valid) {
      const temporary = target + '.tmp';
      await pipeline(createReadStream(source), encoding === 'br' ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : createGzip({ level: 6 }), createWriteStream(temporary));
      const decoded = await hashStream(createReadStream(temporary), encoding === 'br' ? createBrotliDecompress() : createGunzip());
      if (decoded !== sha256) throw Error('Compression roundtrip failed: ' + chunk.url);
      await fs.rename(temporary, target);
    }
    entry[encoding] = '/asset-delivery/' + name;
    entry[encoding + 'Bytes'] = (await fs.stat(target)).size;
  }
  index[chunk.url] = entry;
  report.push({ id: chunk.id, pipelineVersion, storageEnabled, entry, retiredImage:display?.retiredImage,
    prunedGeometry:pruned && optimized ? {accessors:pruned.removedAccessors,views:pruned.removedViews} : undefined,
    images:imageResult.images, meshoptStreams:meshopt.streams, sourceSHA256, sha256, sourceBytes: original.length, bytes: bytes.length, verifiedRanges: compact.verifiedRanges,
    br: (await fs.stat(path.join(root, 'public', entry.br))).size, gzip: (await fs.stat(path.join(root, 'public', entry.gzip))).size });
}
await fs.writeFile(path.join(generated, 'asset-delivery.json.tmp'), JSON.stringify(index, null, 2) + '\n');
await fs.rename(path.join(generated,'asset-delivery.json.tmp'),path.join(generated,'asset-delivery.json'));
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
// A running preview/rolling deployment can still reference the previous build.
// Prune only with the server stopped, never as a side effect of preparing a build.
// Only this generator's content-addressed files inside its exact output directory qualify.
if (process.env.MD_PRUNE_DELIVERY === '1') for (const name of await fs.readdir(output)) {
  const target = path.resolve(output,name);
  if (path.dirname(target) !== output) throw Error('Invalid output path');
  if (/^[a-f0-9]{64}(?:(?:\.q9)?\.glb(?:\.br|\.gz)?|\.webp)(?:\.tmp)?$/.test(name) && !retained.has(name)) await fs.unlink(target);
}
const sum = key => report.reduce((value, entry) => value + entry[key], 0);
console.log('Lossless delivery verified: ' + (sum('sourceBytes') / 1e6).toFixed(1) + ' MB source → ' + (sum('bytes') / 1e6).toFixed(1) + ' MB pixel/geometry-exact payload → Brotli ' + (sum('br') / 1e6).toFixed(1) + ' MB / gzip ' + (sum('gzip') / 1e6).toFixed(1) + ' MB.');
