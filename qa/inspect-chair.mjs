import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function loadGeometry(path) {
  const bytes = fs.readFileSync(path), length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers;
  json.materials = json.materials?.map(m => ({ name: m.name }));
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
  const header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - length, 8);
  header.writeUInt32LE(encoded.length, 12);
  const blob = Buffer.concat([header, encoded, bytes.subarray(20 + length)]);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
}

if (process.argv[1]?.endsWith('inspect-chair.mjs')) {
  const manifest = JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
  const founder = await loadGeometry('public' + manifest.chunks.find(c => c.id === 'founder').url);
  founder.scene.updateMatrixWorld(true);
  founder.scene.traverse(o => {
    if (!o.isMesh || !/FC91|HF89|dashboard/.test(o.material.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    console.log(JSON.stringify({name:o.name,material:o.material.name,min:b.min.toArray(),max:b.max.toArray(),matrix:o.matrixWorld.toArray()}));
  });
  for (const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]) {
    const gltf = await loadGeometry('public'+url); gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o=>{
      if (!o.isMesh || !/FC91|HF89/.test(o.userData.sourceName ?? '')) return;
      const b=new THREE.Box3().setFromObject(o);
      console.log(JSON.stringify({collider:o.userData.sourceName,min:b.min.toArray(),max:b.max.toArray()}));
    });
  }
}
