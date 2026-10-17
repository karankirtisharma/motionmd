/** Export the relocated upholstery with its exact native and lighting UVs. */
import fs from 'node:fs';
import * as THREE from 'three';
import { loadGeometry } from './inspect-chair.mjs';
import { createWorkstation } from '../src/runtime/interaction/Workstation.ts';

if (!process.argv[2]) throw new Error('Pass an external chair.json output path.');
const scene = (await loadGeometry('public/assets/architecture-v21/founder.glb')).scene;
const chair = createWorkstation(scene);
const leather = chair.meshes.find(mesh => /fine ivory leather/.test(mesh.material.name));
const { position, normal, uv, uv1 } = leather.geometry.attributes;
const positions = [], normals = [], materialUV = [], lightingUV = [];
const p = new THREE.Vector3(), n = new THREE.Matrix3().getNormalMatrix(leather.matrixWorld);
for (let i = 0; i < position.count; i++) {
  p.fromBufferAttribute(position, i).applyMatrix4(leather.matrixWorld);
  positions.push(p.x, -p.z, p.y);
  p.fromBufferAttribute(normal, i).applyMatrix3(n).normalize();
  normals.push(p.x, -p.z, p.y);
  materialUV.push(uv.getX(i), 1 - uv.getY(i));
  lightingUV.push(uv1.getX(i), 1 - uv1.getY(i));
}
fs.writeFileSync(process.argv[2], JSON.stringify({ positions, normals, materialUV, uv: lightingUV, index: Array.from(leather.geometry.index.array) }));
console.log({ vertices: position.count, triangles: leather.geometry.index.count / 3 });
