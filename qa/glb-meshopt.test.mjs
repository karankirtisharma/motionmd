import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeMeshoptStreams } from '../scripts/glb-meshopt.mjs';
import { readGLB, compactGLB } from '../scripts/glb-storage.mjs';
import { writeGLB } from '../scripts/glb-images.mjs';

async function fixture(filter) {
  await MeshoptEncoder.ready;
  const count = 4096, stride = 12, data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { data[i * 3] = Math.sin(i / 16); data[i * 3 + 1] = i / 17; data[i * 3 + 2] = Math.cos(i / 13); }
  const bytes = filter ? MeshoptEncoder.encodeFilterExp(data, count, stride, 23, 'Separate') : new Uint8Array(data.buffer);
  const encoded = MeshoptEncoder.encodeVertexBufferLevel(bytes, count, stride, 3, 0);
  const json = { asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [{ byteLength: encoded.length }, { byteLength: bytes.length, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: bytes.length, byteStride: stride, target: 34962, extensions: {
      EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: encoded.length, byteStride: stride, count, mode: 'ATTRIBUTES', ...(filter ? { filter: 'EXPONENTIAL' } : {}) } } }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-1,0,-1], max: [1,count / 17,1] }],
    meshes: [{ name: 'preserved', primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }],
    nodes: [{ name: 'preserved node', mesh: 0, translation: [1,2,3] }], scenes: [{ nodes: [0] }], scene: 0,
    animations: [], materials: [], skins: [], extras: { source: 'untouched' } };
  return writeGLB(json, Buffer.from(encoded));
}
for (const filter of [false, true]) test(`Meshopt v1 preserves all decoded bytes ${filter ? 'after the source exponential filter' : 'without filters'}`, async () => {
  const source = await fixture(filter), copy = Buffer.from(source);
  const result = await optimizeMeshoptStreams(source), packed = compactGLB(result.buffer).buffer;
  assert.ok(source.equals(copy), 'Input source is immutable');
  assert.ok(result.streams.length > 0); assert.ok(packed.length < source.length);
  const a = readGLB(source), b = readGLB(packed);
  for (const key of ['meshes','nodes','accessors','animations','skins','materials','extras']) assert.deepEqual(a.json[key],b.json[key],key);
  assert.ok(b.json.extensionsRequired.includes('KHR_meshopt_compression'));
  assert.ok(!b.json.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.deepEqual(b.json.buffers[1].extensions, { KHR_meshopt_compression: { fallback: true } });
  await MeshoptDecoder.ready;
  const decode = ({ json, binary }) => { const e = json.bufferViews[0].extensions.EXT_meshopt_compression ?? json.bufferViews[0].extensions.KHR_meshopt_compression;
    const bytes = new Uint8Array(e.count * e.byteStride); MeshoptDecoder.decodeGltfBuffer(bytes,e.count,e.byteStride,binary.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter); return bytes; };
  assert.deepEqual(decode(a),decode(b));
  // Exercise the actual Three loader, not only the codec in isolation.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const oldScene = await loader.parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.length),'');
  const newScene = await loader.parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.length),'');
  assert.deepEqual(oldScene.scene.children[0].geometry.attributes.position.array,newScene.scene.children[0].geometry.attributes.position.array);
  for (const gltf of [oldScene,newScene]) gltf.scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});
test('uncompressed files are passed through without modifying the graph or binary', async () => {
  const source = writeGLB({ asset:{version:'2.0'}, buffers:[{byteLength:4}], bufferViews:[{buffer:0,byteLength:4}] },Buffer.from([1,2,3,4]));
  const result = await optimizeMeshoptStreams(source); assert.equal(result.buffer,source); assert.equal(result.streams.length,0);
});
