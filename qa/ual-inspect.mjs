// List the clips and skeleton of a Quaternius Universal Animation Library GLB (textures stripped).
//   node qa/ual-inspect.mjs <file.glb>
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadGLB(file) {
  const b = fs.readFileSync(file), length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers;
  (json.materials ?? []).forEach(m => { delete m.pbrMetallicRoughness?.baseColorTexture; delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.pbrMetallicRoughness?.metallicRoughnessTexture; });
  let data = Buffer.from(JSON.stringify(json)); data = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4, 32)]);
  const header = Buffer.from(b.subarray(0, 20)); header.writeUInt32LE(b.length - length + data.length, 8); header.writeUInt32LE(data.length, 12);
  const blob = Buffer.concat([header, data, b.subarray(20 + length)]);
  return new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('ual-inspect.mjs')) {
  const gltf = await loadGLB(process.argv[2]);
  const bones = []; gltf.scene.traverse(o => { if (o.isBone) bones.push(o.name); });
  const meshes = []; gltf.scene.traverse(o => { if (o.isMesh) meshes.push(`${o.name}${o.isSkinnedMesh ? ' (skinned)' : ''}`); });
  console.log('bones', bones.length, bones.join(','));
  console.log('meshes', meshes.join(', '));
  const box = new THREE.Box3().setFromObject(gltf.scene); console.log('bounds', box.min.toArray().map(v => v.toFixed(2)), box.max.toArray().map(v => v.toFixed(2)));
  for (const clip of gltf.animations) {
    const root = clip.tracks.find(t => /(^|_)(root|hips|pelvis)[^.]*\.position$/i.test(t.name));
    let travel = '';
    if (root) { const v = root.values, n = v.length / 3; travel = `${root.name} d=(${(v[(n - 1) * 3] - v[0]).toFixed(2)},${(v[(n - 1) * 3 + 1] - v[1]).toFixed(2)},${(v[(n - 1) * 3 + 2] - v[2]).toFixed(2)})`; }
    console.log(clip.name.padEnd(28), clip.duration.toFixed(2) + 's', clip.tracks.length, 'tracks', travel);
  }
}
