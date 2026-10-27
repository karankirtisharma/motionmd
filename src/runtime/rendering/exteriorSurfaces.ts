import { Mesh, Vector3, BufferGeometry, Float32BufferAttribute, type BufferAttribute, type InterleavedBufferAttribute, type Object3D } from 'three';
import { exteriorCollision } from '../interaction/exteriorCollision.ts';
import { repairLoungeInternalGroove } from './exteriorGroove.ts';

/** Five exterior source components (including the entry steps) were exported inside-out.
 * Repair only those measured closed components; positions and UVs stay intact. */
export function repairExteriorWinding(root: Object3D) {
  let triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof Mesh) || Array.isArray(object.material) || object.material.name !== 'shell__EH54 | scanned cream limestone panels' || object.geometry.userData.mdExteriorWinding) return;
    const g=object.geometry, p=g.attributes.position, index=g.index;
    if (!index) return;
    const reversed = new Set<number>();
    for(const piece of exteriorCollision) {
      if(!piece.repairWinding || piece.sourceMeshName!==object.name) continue;
      for(const i of piece.sourceTriangleOffsets) {
        const b=index.getX(i+1),c=index.getX(i+2);
        index.setX(i+1,c);index.setX(i+2,b);triangles++;
      }
      for(const i of piece.sourceVertexIndices) reversed.add(i);
    }
    const normal=g.attributes.normal,tangent=g.attributes.tangent;
    for(const i of reversed) {
      if(normal)normal.setXYZ(i,-normal.getX(i),-normal.getY(i),-normal.getZ(i));
      if(tangent)tangent.setW(i,-tangent.getW(i));
    }
    if(reversed.size){index.needsUpdate=true;if(normal)normal.needsUpdate=true;if(tangent)tangent.needsUpdate=true;g.userData.mdExteriorWinding=true;}
  });
  return triangles;
}

type ExteriorPiece = (typeof exteriorCollision)[number];
const JOIN_EPSILON = 1e-5;
const SOUTH = exteriorCollision.find(p => p.name === 'south return')!;
const WEST = exteriorCollision.find(p => p.name === 'west studio terrace')!;
const SOUTH_EDGE_DX = WEST.min[0] - SOUTH.min[0];
function alignSouthEdge(x: number) { return x <= SOUTH.min[0] + .01201 ? x + SOUTH_EDGE_DX : x; }

/** The south cap was authored 3 mm above the adjoining terrace finish. */
export function exteriorCollisionVertices(piece: ExteriorPiece): Float32Array {
  const vertices = new Float32Array(piece.vertices);
  if (piece.name === 'south return') {
    const dy = -.01 - piece.max[1];
    for (let i = 0; i < vertices.length; i += 3) { vertices[i] = alignSouthEdge(vertices[i]); vertices[i + 1] += dy; }
  }
  return vertices;
}

type ClipVertex = { point: Vector3; attributes: Record<string, number[]> };
type Plane = { normal: Vector3; constant: number };

/** The source returns are convex bevelled solids. Keep their exact bevel planes. */
function returnPlanes(piece: ExteriorPiece): Plane[] {
  const vertices: number[] = [...piece.vertices];
  const planes: Plane[] = [];
  if (piece.name === 'south return') for (let i = 0; i < vertices.length; i += 3) { vertices[i] = alignSouthEdge(vertices[i]); vertices[i + 1] += -.01 - piece.max[1]; }
  for (let i = 0; i < piece.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => new Vector3().fromArray(vertices, piece.indices[i + j] * 3));
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const constant = normal.dot(a);
    if (!planes.some(p => p.normal.distanceToSquared(normal) < 1e-10 && Math.abs(p.constant - constant) < 1e-5)) planes.push({ normal, constant });
  }
  return planes;
}

function clipPolygon(poly: ClipVertex[], plane: Plane, inside: boolean): ClipVertex[] {
  const result: ClipVertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = plane.normal.dot(a.point) - plane.constant, db = plane.normal.dot(b.point) - plane.constant;
    const keepA = inside ? da <= JOIN_EPSILON : da > JOIN_EPSILON;
    const keepB = inside ? db <= JOIN_EPSILON : db > JOIN_EPSILON;
    if (keepA) result.push(a);
    if (keepA !== keepB) {
      const t = Math.max(0, Math.min(1, da / (da - db)));
      result.push({
        point: a.point.clone().lerp(b.point, t),
        attributes: Object.fromEntries(Object.keys(a.attributes).map(name => [name, a.attributes[name].map((v, j) => v + (b.attributes[name][j] - v) * t)])),
      });
    }
  }
  return result;
}

/** Subtract a convex solid from one face, retaining only its visible outside. */
function subtractReturn(poly: ClipVertex[], planes: Plane[]): ClipVertex[][] {
  let remaining = poly;
  const outside: ClipVertex[][] = [];
  for (const plane of planes) {
    const fragment = clipPolygon(remaining, plane, false);
    if (fragment.length >= 3) outside.push(fragment);
    remaining = clipPolygon(remaining, plane, true);
    if (remaining.length < 3) break;
  }
  return outside;
}

/** Resolve all four exterior cap/terrace intersections, including buried fascia.
 * Only measured source components are touched. The rendered solid union retains
 * its outline; the south cap is aligned to the common finished level. UVs and
 * other attributes are interpolated at cuts rather than projected anew. */
export function repairExteriorOverlap(root: Object3D) {
  let changed = 0;
  root.updateMatrixWorld(true);
  const caps = exteriorCollision.filter(p => /return$/.test(p.name)).map(piece => ({ piece, min: piece.min.map((v,axis)=>piece.name==='south return'&&axis===0?alignSouthEdge(v):v), planes: returnPlanes(piece) }));
  const terraces = exteriorCollision.filter(p => /terrace$/.test(p.name));
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.name !== terraces[0].sourceMeshName || object.geometry.userData.mdExteriorOverlap) return;
    const g = object.geometry, index = g.index;
    if (!index) return;
    const attrs = Object.entries(g.attributes) as [string, BufferAttribute | InterleavedBufferAttribute][];
    const position = g.attributes.position;
    const south = caps.find(c => c.piece.name === 'south return')!.piece;
    const inverse = object.matrixWorld.clone().invert();
    const dy = -.01 - south.max[1];
    for (const i of south.sourceVertexIndices) {
      const point = new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      point.y += dy; point.x = alignSouthEdge(point.x); point.applyMatrix4(inverse); position.setXYZ(i, point.x, point.y, point.z);
    }
    const values = Object.fromEntries(attrs.map(([name, attr]) => [name, Array.from({ length: attr.count * attr.itemSize }, (_, i) => attr.getComponent(Math.floor(i / attr.itemSize), i % attr.itemSize))]));
    const selected = new Set<number>(terraces.flatMap(p => [...p.sourceTriangleOffsets]));
    const result: number[] = [];
    const vertex = (i: number): ClipVertex => ({
      point: new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld),
      attributes: Object.fromEntries(attrs.map(([name, attr]) => [name, Array.from({ length: attr.itemSize }, (_, j) => attr.getComponent(i, j))])),
    });
    for (let i = 0; i < index.count; i += 3) {
      const original = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (!selected.has(i)) { result.push(...original); continue; }
      let polygons = [original.map(vertex)], touched = false;
      for (const cap of caps) {
        const next: ClipVertex[][] = [];
        for (const poly of polygons) {
          // Most terrace triangles lie far from either return. Retain them exactly.
          if ([0, 2].some(axis => Math.max(...poly.map(v => v.point.getComponent(axis))) < cap.min[axis] - JOIN_EPSILON || Math.min(...poly.map(v => v.point.getComponent(axis))) > cap.piece.max[axis] + JOIN_EPSILON)) { next.push(poly); continue; }
          const cut = subtractReturn(poly, cap.planes);
          if (cut.length !== 1 || cut[0].length !== poly.length || cut[0].some((v, j) => v.point.distanceToSquared(poly[j].point) > 1e-16)) touched = true;
          next.push(...cut);
        }
        polygons = next;
      }
      if (!touched) { result.push(...original); continue; }
      changed++;
      for (const poly of polygons) for (let j = 1; j + 1 < poly.length; j++) {
        const tri = [poly[0], poly[j], poly[j + 1]];
        if (tri[1].point.clone().sub(tri[0].point).cross(tri[2].point.clone().sub(tri[0].point)).lengthSq() < 1e-18) continue;
        for (const v of tri) {
          const id = values.position.length / 3;
          for (const [name] of attrs) values[name].push(...v.attributes[name]);
          result.push(id);
        }
      }
    }
    for (const [name, attr] of attrs) g.setAttribute(name, new Float32BufferAttribute(values[name], attr.itemSize, attr.normalized));
    g.setIndex(result); g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.mdExteriorOverlap = true;
  });
  return changed;
}

/** Collision uses the same repaired internal terrace surface as the renderer. */
export function exteriorCollisionGeometry(piece: ExteriorPiece) {
  const vertices = exteriorCollisionVertices(piece);
  if (piece.name !== 'west lounge terrace') return { vertices, indices: new Uint32Array(piece.indices) };
  const source = new BufferGeometry(); source.setAttribute('position',new Float32BufferAttribute(vertices,3)); source.setIndex([...piece.indices]);
  const fixed = repairLoungeInternalGroove(source);
  const result = { vertices: fixed.attributes.position.array as Float32Array, indices: new Uint32Array(fixed.index!.array) };
  source.dispose(); fixed.dispose(); return result;
}

/** Run after overlap repairs; source triangle offsets are no longer needed here. */
export function repairExteriorGroove(root: Object3D) {
  let repaired=0;root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!(o instanceof Mesh)||o.name!==exteriorCollision[0].sourceMeshName||o.geometry.userData.mdLoungeGroove)return;
    const old=o.geometry;o.geometry=repairLoungeInternalGroove(old,o.matrixWorld);old.dispose();repaired++;
  });return repaired;
}
