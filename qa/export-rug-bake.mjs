/** Export the shipped receiver for scripts/lightmaps/bake-founder-rug.py.
 * Usage: node qa/export-rug-bake.mjs <external-work-folder>/rug.json
 * Positions/normals use Blender Z-up; the lighting V coordinate is unflipped.
 */
import fs from 'node:fs';
import * as THREE from 'three';
import { loadGeometry } from './inspect-chair.mjs';

if (!process.argv[2]) throw new Error('Pass an output rug.json path outside the website.');
const scene = (await loadGeometry('public/assets/architecture-v21/founder.glb')).scene;
scene.updateMatrixWorld(true);
let rug;
scene.traverse(object => {
  if (object.isMesh && object.material.name === 'founder__FR79 | antique bronze hand knotted rug') rug = object;
});
if (!rug) throw new Error('Source rug missing');
const { position, uv1, normal } = rug.geometry.attributes;
const positions = [], normals = [], uv = [];
const vector = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().getNormalMatrix(rug.matrixWorld);
for (let i = 0; i < position.count; i++) {
  vector.fromBufferAttribute(position, i).applyMatrix4(rug.matrixWorld);
  positions.push(vector.x, -vector.z, vector.y);
  vector.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
  normals.push(vector.x, -vector.z, vector.y);
  uv.push(uv1.getX(i), 1 - uv1.getY(i));
}
const data = { positions, normals, uv, index: Array.from(rug.geometry.index.array) };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
console.log({ vertices: position.count, triangles: data.index.length / 3 });
