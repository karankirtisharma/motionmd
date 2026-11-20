import { Float32BufferAttribute, Mesh, Vector3, type Object3D } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type Node from 'three/src/nodes/core/Node.js';
import { attribute, cameraPosition, cameraProjectionMatrix, float, max, min, mix, modelWorldMatrix, positionLocal, screenSize, vec4 } from 'three/tsl';

const ROD_MATERIALS = /MF suspended rod bronze$|MF bronze installation end highlights$/;

/** The suspended bronze installation is made of rods a few millimetres thick.
 * From across the room each rod is narrower than a pixel, so it breaks into dots
 * that crawl as the camera moves. Keep every rod at least about one pixel wide on
 * screen by widening it around its own vertical axis in the vertex stage; close
 * up, where a rod already covers more than a pixel, nothing changes. */
export function stabiliseThinRods(root: Object3D) {
  root.updateMatrixWorld(true);
  let rods = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || Array.isArray(object.material) || !ROD_MATERIALS.test(object.material.name)) return;
    const material = object.material, geometry = object.geometry, index = geometry.index, positions = geometry.getAttribute('position');
    if (!(material instanceof MeshPhysicalNodeMaterial) || !index || !positions || geometry.getAttribute('mdRodAxis')) return;
    // Connected triangles form one rod (or one end cap).
    const parent = new Uint32Array(positions.count).map((_, i) => i);
    const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let t = 0; t < index.count; t += 3) {
      const a = find(index.getX(t)), b = find(index.getX(t + 1)), c = find(index.getX(t + 2));
      parent[b] = a; parent[c] = a;
    }
    const world = Array.from({ length: positions.count }, (_, i) => new Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
    const sums = new Map<number, { x: number; z: number; n: number; radius: number }>();
    for (let i = 0; i < world.length; i++) {
      const key = find(i), entry = sums.get(key) ?? { x: 0, z: 0, n: 0, radius: 0 };
      entry.x += world[i].x; entry.z += world[i].z; entry.n++; sums.set(key, entry);
    }
    for (let i = 0; i < world.length; i++) {
      const entry = sums.get(find(i))!;
      entry.radius = Math.max(entry.radius, Math.hypot(world[i].x - entry.x / entry.n, world[i].z - entry.z / entry.n));
    }
    const inverse = object.matrixWorld.clone().invert(), axis = new Float32Array(positions.count * 4), point = new Vector3();
    for (let i = 0; i < world.length; i++) {
      const entry = sums.get(find(i))!;
      point.set(entry.x / entry.n, world[i].y, entry.z / entry.n).applyMatrix4(inverse);
      axis.set([point.x, point.y, point.z, Math.max(entry.radius, 1e-4)], i * 4);
    }
    geometry.setAttribute('mdRodAxis', new Float32BufferAttribute(axis, 4));
    // The pinned r186 types omit matrix element access on this uniform.
    const projection = cameraProjectionMatrix as unknown as { element(column: number): { element(row: number): Node<'float'> } };
    const rod = attribute('mdRodAxis', 'vec4');
    const distance = modelWorldMatrix.mul(vec4(rod.xyz, 1)).xyz.distance(cameraPosition);
    // World size of one pixel at that distance (perspective cameras only).
    const pixel = distance.mul(2).div(projection.element(1).element(1).mul(screenSize.y));
    const perspective = float(1).sub(projection.element(3).element(3));
    const scale = mix(float(1), min(max(float(1), pixel.mul(0.7).div(rod.w)), float(8)), perspective);
    material.positionNode = rod.xyz.add(positionLocal.sub(rod.xyz).mul(scale));
    material.needsUpdate = true;
    rods += sums.size;
  });
  console.info('[MD thin rods]', { rods });
  return rods;
}
