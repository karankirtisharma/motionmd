/**
 * Compress the runtime models for delivery.
 *
 *   node tools/compress-model.mjs
 *
 * Reads the float models in models-source/ (written by tools/optimise-model.mjs
 * from the kit) and writes two files per model into assets/models/:
 *
 *   <name>_meshopt.glb    EXT_meshopt_compression over quantized attributes.
 *                         The default download; needs the meshopt decoder
 *                         (WebAssembly).
 *   <name>_quantized.glb  KHR_mesh_quantization only. No decoder; used when
 *                         the page cannot run WebAssembly (a strict content
 *                         security policy without 'wasm-unsafe-eval').
 *
 * Geometry, node names, extras, materials and textures are kept. Positions are
 * quantized to 14 bits per axis of each mesh's bounds, texture coordinates to
 * 12 bits (where they lie in 0..1), normals to 8-bit octahedral (meshopt) or
 * 10 bits (quantized). Quantization moves each mesh's offset and scale into its
 * node; the original node translation is recorded in extras.lm_rest and the
 * runtime puts it back on load (src/scene/stage.mjs, restoreQuantizedNodes),
 * so the scene code sees the same node transforms and float positions as
 * before.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = [
  { source: 'models-source/Living_Maquette_LOD_web.glb', name: 'Living_Maquette' },
  { source: 'models-source/MotionFloor_Furnishings_LOD.glb', name: 'MotionFloor_Furnishings' },
];
const QUANTIZE = { quantizePosition: 14, quantizeTexcoord: 12 };

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const silent = { debug() {}, info() {}, warn() {}, error: console.error };

/** Record each mesh node's rest translation, and refuse what the runtime cannot restore. */
async function readAndMark(path) {
  const document = await io.read(path);
  document.setLogger(silent);
  const meshUse = new Map();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    meshUse.set(mesh, (meshUse.get(mesh) ?? 0) + 1);
    const rotation = node.getRotation();
    const scale = node.getScale();
    if (node.listChildren().length) throw new Error(`${node.getName()}: a mesh node with children would gain an extra node`);
    if (Math.abs(rotation[3]) < 0.999999 || scale.some((value) => Math.abs(value - 1) > 1e-6)) {
      throw new Error(`${node.getName()}: mesh nodes are expected to carry translation only`);
    }
    node.setExtras({ ...node.getExtras(), lm_rest: { translation: node.getTranslation() } });
  }
  if ([...meshUse.values()].some((count) => count > 1)) throw new Error('A mesh shared by several nodes is not supported');
  return document;
}

const outDir = join(root, 'assets/models');
mkdirSync(outDir, { recursive: true });
const kb = (bytes) => `${(bytes / 1000).toFixed(0)} KB`;
for (const model of MODELS) {
  const sourcePath = join(root, model.source);
  const sourceBytes = statSync(sourcePath).size;

  const compressed = await readAndMark(sourcePath);
  await compressed.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', ...QUANTIZE }));
  const meshoptBytes = await io.writeBinary(compressed);
  writeFileSync(join(outDir, `${model.name}_meshopt.glb`), meshoptBytes);

  const quantized = await readAndMark(sourcePath);
  await quantized.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ ...QUANTIZE, quantizeNormal: 10 }));
  const quantizedBytes = await io.writeBinary(quantized);
  writeFileSync(join(outDir, `${model.name}_quantized.glb`), quantizedBytes);

  const sourceGzip = gzipSync(await io.writeBinary(await io.read(sourcePath)), { level: 9 }).length;
  console.log(`${basename(model.source)}: ${kb(sourceBytes)} (${kb(sourceGzip)} gzip)`
    + `\n  -> ${model.name}_meshopt.glb    ${kb(meshoptBytes.length)} (${kb(gzipSync(meshoptBytes, { level: 9 }).length)} gzip)`
    + `\n  -> ${model.name}_quantized.glb  ${kb(quantizedBytes.length)} (${kb(gzipSync(quantizedBytes, { level: 9 }).length)} gzip)`);
}
