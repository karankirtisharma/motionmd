import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Vector3,
} from 'three';
import { sampleScreenSurface } from './curvedSurface.ts';

/** A real flat display at the chord through the authored left and right edges.
 * The top and bottom reveals join that face to the existing curved housing. */
export function installFlatPanel(meshes: readonly Mesh[]) {
  if (!meshes.length) throw new Error('Cannot fit a display without its source mesh.');
  const face = meshes[0], source = meshes.map(mesh => ({ geometry: mesh.geometry, visible: mesh.visible }));
  const nearest = findScreenCorners(meshes), sourceMeshes = Array.from(meshes);
  const front = nearest[3].clone().sub(nearest[0]).cross(nearest[1].clone().sub(nearest[0])).normalize();
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => sampleScreenSurface(sourceMeshes, u, v, front));
  const [topLeft, topRight, , bottomLeft] = corners;
  const right = new Vector3().subVectors(topRight, topLeft);
  const down = new Vector3().subVectors(bottomLeft, topLeft);
  const normal = down.clone().cross(right).normalize();
  if (!normal.lengthSq()) throw new Error('The presentation frame has no measurable face.');
  // Close the rectangle in the edge plane rather than retaining export rounding
  // on a fourth independent vertex. This is also the native iframe's exact plane.
  corners[2] = topLeft.clone().add(right).add(down);
  function point(u: number, v: number) {
    return topLeft.clone().addScaledVector(right, u).addScaledVector(down, v);
  }

  const transform = new Matrix4().copy(face.matrixWorld).invert();
  const faceIndices = [0, 2, 1, 0, 3, 2];
  const rectangle = geometry(corners, faceIndices, transform);
  rectangle.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  rectangle.name = 'Presentation display | flat glass';

  const columns = new Set([0, 1]);
  for (const mesh of meshes) {
    const uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      if (uv.getY(i) === 0 || uv.getY(i) === 1) columns.add(Math.max(0, Math.min(1, uv.getX(i))));
    }
  }
  const edge = Array.from(columns).sort((a, b) => a - b);
  const revealVertices: Vector3[] = [], revealIndices: number[] = [];
  for (const v of [0, 1]) {
    const start = revealVertices.length;
    for (const u of edge) revealVertices.push(sampleScreenSurface(sourceMeshes, u, v, normal), point(u, v));
    for (let i = 0; i + 1 < edge.length; i++) {
      const a = start + 2 * i;
      for (const [j, k, l] of [[a, a + 2, a + 1], [a + 1, a + 2, a + 3]]) {
        const area = revealVertices[k].clone().sub(revealVertices[j]).cross(revealVertices[l].clone().sub(revealVertices[j]));
        if (area.lengthSq() > 1e-18) revealIndices.push(j, k, l);
      }
    }
  }
  const revealGeometry = geometry(revealVertices, revealIndices, transform);
  // Match PL78 | dark bronze reveals in the shipped GLB. Its finish uses
  // authored linear color and PBR factors, without any texture or UV atlas.
  const finish = new MeshStandardMaterial({ color: new Color(.024, .017, .011), roughness: .30, metalness: .78, side: DoubleSide });
  const reveal = new Mesh(revealGeometry, finish);
  reveal.name = 'Presentation display | bronze housing returns';
  reveal.receiveShadow = true;

  const worldVertices = [...corners, ...revealVertices];
  const collision = {
    vertices: new Float32Array(worldVertices.flatMap(vertex => vertex.toArray())),
    indices: new Uint32Array([...faceIndices, ...revealIndices.map(i => i + 4)]),
  };
  // No Blender source data or shared GLB geometry is mutated.
  const previousMarker = face.userData.nativeStudioFace;
  face.userData.nativeStudioFace = true;
  face.geometry = rectangle;
  for (let i = 1; i < meshes.length; i++) meshes[i].visible = false;
  face.add(reveal);
  let disposed = false;
  return {
    face, corners, normal, point, collision,
    dispose() {
      if (disposed) return;
      disposed = true;
      face.remove(reveal);
      if (previousMarker === undefined) delete face.userData.nativeStudioFace;
      else face.userData.nativeStudioFace = previousMarker;
      meshes.forEach((mesh, i) => { mesh.geometry = source[i].geometry; mesh.visible = source[i].visible; });
      rectangle.dispose(); revealGeometry.dispose(); finish.dispose();
    },
  };
}

function geometry(points: readonly Vector3[], indices: number[], transform: Matrix4) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => p.clone().applyMatrix4(transform).toArray()), 3));
  result.setIndex(indices); result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

export function findScreenCorners(meshes: readonly Mesh[]): Vector3[] {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const result = new Vector3(); let nearest = Infinity;
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const uv = mesh.geometry.getAttribute('uv'), pos = mesh.geometry.getAttribute('position');
      if (!uv || !pos) continue;
      for (let i = 0; i < uv.count; i++) {
        const d = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
        if (d < nearest) { nearest = d; result.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); }
      }
    }
    if (!Number.isFinite(nearest)) throw new Error('The presentation display has no usable UV surface.');
    return result;
  });
}
