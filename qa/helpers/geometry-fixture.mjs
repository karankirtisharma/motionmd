import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Decode actual shipping geometry in Node without a DOM image loader. */
export async function geometryFixture(url) {
  const b=fs.readFileSync(new URL('../../public'+url,import.meta.url));
  const length=b.readUInt32LE(12), json=JSON.parse(b.subarray(20,20+length));
  const sourceMaterials=json.materials;
  delete json.images; delete json.textures; delete json.samplers;
  json.materials=sourceMaterials.map(m=>({name:m.name,doubleSided:m.doubleSided}));
  let data=Buffer.from(JSON.stringify(json));
  data=Buffer.concat([data,Buffer.alloc((4-data.length%4)%4,32)]);
  const header=Buffer.from(b.subarray(0,20));
  header.writeUInt32LE(b.length-length+data.length,8); header.writeUInt32LE(data.length,12);
  const blob=Buffer.concat([header,data,b.subarray(20+length)]);
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(blob.buffer.slice(blob.byteOffset,blob.byteOffset+blob.length),'');
  gltf.scene.updateMatrixWorld(true);
  return {root:gltf.scene,sourceMaterials};
}
