import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, Vector3, Triangle, Matrix3, type Object3D, type BufferAttribute, type InterleavedBufferAttribute } from 'three';
import { exteriorCollision } from '../interaction/exteriorCollision.ts';

const WALL_FRONT = -10.674499869346619;
const ROOM_SIDE = 1.2;
const FLOOR_MATERIAL = 'entrance__EH54 | polished warm-grey cloud marble';
const STONE_MATERIAL = 'entrance__EH54 | scanned cream limestone panels';
const west = exteriorCollision.find(p => p.name === 'west lounge terrace')!;
// Join the adjacent slab's flat face, covering its now-internal 12 mm bevel.
const APRON_END = Math.min(...west.vertices.filter((_, i) => i % 3 === 2 && Math.abs(west.vertices[i - 1] - west.max[1]) < 1e-6));

type Vertex = { world: Vector3; values: Record<string, number[]> };
function clip(poly: Vertex[], axis: 'x' | 'z', value: number, positive: boolean) {
  const result: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = a.world[axis] - value, db = b.world[axis] - value;
    const keepA = positive ? da >= 0 : da <= 0, keepB = positive ? db >= 0 : db <= 0;
    if (keepA) result.push(a);
    if (keepA !== keepB) {
      const t = da / (da - db);
      result.push({ world: a.world.clone().lerp(b.world, t), values: Object.fromEntries(Object.keys(a.values).map(name => [name, a.values[name].map((v, j) => v + (b.values[name][j] - v) * t)])) });
    }
  }
  return result;
}

/** The vestibule finish projects 1.35 m beyond the measured exterior wall.
 * Split that outside portion from the indoor marble, finish it in the existing
 * exterior limestone, and join the adjacent slab at its -10 mm finished level.
 * Run on both visible source and collision roots before loading materials. */
export function repairEntranceApron(root: Object3D) {
  root.updateMatrixWorld(true);
  const candidates: Mesh[] = [];
  let stone: Mesh['material'] | undefined;
  root.traverse(o => {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
    if (o.material.name === STONE_MATERIAL) stone = o.material;
    if ((o.material.name === FLOOR_MATERIAL || o.userData.sourceName === 'EH52 vestibule ground finish') && !o.geometry.userData.mdEntranceApron) candidates.push(o);
  });
  let repaired = 0;
  for (const object of candidates) {
    const old = object.geometry, box = new Box3().setFromObject(object);
    if (Math.abs(box.min.x + 2.34) > .001 || Math.abs(box.max.z + 9.327) > .001 || Math.abs(box.max.y) > .001) continue;
    const attributes = Object.entries(old.attributes) as [string, BufferAttribute | InterleavedBufferAttribute][];
    const output = Object.fromEntries(attributes.map(([name]) => [name, [] as number[]]));
    const vertex = (i: number): Vertex => ({ world: new Vector3().fromBufferAttribute(old.attributes.position, i).applyMatrix4(object.matrixWorld), values: Object.fromEntries(attributes.map(([name, a]) => [name, Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j))])) });
    const emit = (poly: Vertex[]) => {
      for (let j = 1; j + 1 < poly.length; j++) {
        const tri = [poly[0], poly[j], poly[j + 1]];
        if (tri[1].world.clone().sub(tri[0].world).cross(tri[2].world.clone().sub(tri[0].world)).lengthSq() < 1e-18) continue;
        for (const v of tri) for (const [name] of attributes) output[name].push(...v.values[name]);
      }
    };
    const count = old.index?.count ?? old.attributes.position.count;
    for (let i = 0; i < count; i += 3) {
      const tri = [0, 1, 2].map(j => vertex(old.index ? old.index.getX(i + j) : i + j));
      // Retain all floor behind the wall and all floor on the indoor side.
      emit(clip(tri, 'z', WALL_FRONT, false));
      emit(clip(clip(tri, 'z', WALL_FRONT, true), 'x', ROOM_SIDE, true));
    }
    // Close the two new vertical cuts. Lighting UVs on the tiny exposed edge
    // come from the directly adjoining original top face, not an empty island.
    const inverse = object.matrixWorld.clone().invert();
    const normalToLocal = new Matrix3().getNormalMatrix(inverse);
    const tops: Vertex[][] = [];
    for (let i = 0; i < count; i += 3) {
      const tri = [0, 1, 2].map(j => vertex(old.index ? old.index.getX(i + j) : i + j));
      if (tri.every(v => Math.abs(v.world.y - box.max.y) < 1e-5)) tops.push(tri);
    }
    const capVertex = (world: Vector3, normal: Vector3): Vertex => {
      const projected = world.clone(); projected.y = box.max.y;
      let donor = tops[0], bary = new Vector3();
      for (const tri of tops) {
        new Triangle(...tri.map(v => v.world) as [Vector3, Vector3, Vector3]).getBarycoord(projected, bary);
        if (Math.min(bary.x, bary.y, bary.z) >= -1e-5) { donor = tri; break; }
      }
      const values = Object.fromEntries(attributes.map(([name, a]) => [name, Array.from({length: a.itemSize}, (_, j) => donor[0].values[name][j]*bary.x + donor[1].values[name][j]*bary.y + donor[2].values[name][j]*bary.z)]));
      values.position = world.clone().applyMatrix4(inverse).toArray();
      if (values.normal) values.normal = normal.clone().applyMatrix3(normalToLocal).normalize().toArray();
      return {world, values};
    };
    emit([[ROOM_SIDE,box.min.y,WALL_FRONT],[ROOM_SIDE,box.min.y,box.max.z],[ROOM_SIDE,box.max.y,box.max.z],[ROOM_SIDE,box.max.y,WALL_FRONT]].map(p=>capVertex(new Vector3(p[0],p[1],p[2]),new Vector3(-1,0,0))));
    emit([[box.min.x,box.min.y,WALL_FRONT],[ROOM_SIDE,box.min.y,WALL_FRONT],[ROOM_SIDE,box.max.y,WALL_FRONT],[box.min.x,box.max.y,WALL_FRONT]].map(p=>capVertex(new Vector3(p[0],p[1],p[2]),new Vector3(0,0,1))));
    const retained = new BufferGeometry();
    for (const [name, a] of attributes) retained.setAttribute(name, new Float32BufferAttribute(output[name], a.itemSize, a.normalized));
    retained.userData = { ...old.userData, mdEntranceApron: true };
    retained.computeBoundingBox(); retained.computeBoundingSphere(); object.geometry = retained;
    // Subtraction makes an L-shaped floor; the exporter's former box hull tag is no longer valid.
    if (object.userData.collisionShape === 'convexHull') object.userData.collisionShape = 'trimesh';
    // The outdoor solid meets the neighbouring terrace at the same finished level.
    const minX = box.min.x, maxZ = APRON_END, minY = box.min.y, top = -.01;
    const apronGeometry = new BoxGeometry(ROOM_SIDE - minX, top - minY, maxZ - WALL_FRONT);
    apronGeometry.translate((minX + ROOM_SIDE) / 2, (minY + top) / 2, (WALL_FRONT + maxZ) / 2);
    apronGeometry.applyMatrix4(object.matrixWorld.clone().invert());
    apronGeometry.setAttribute('uv1', apronGeometry.attributes.uv.clone());
    apronGeometry.userData.mdEntranceApron = true;
    const material = stone ?? object.material;
    const apron = new Mesh(apronGeometry, material);
    apron.name = 'MD_EntranceExteriorApron';
    apron.matrix.copy(object.matrix); apron.matrixAutoUpdate = false;
    apron.userData = { sourceName: 'Measured exterior limestone apron', exteriorApron: true };
    object.parent!.add(apron);
    old.dispose();
    repaired++;
  }
  if (repaired) root.updateMatrixWorld(true);
  return repaired;
}
