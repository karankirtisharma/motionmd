import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// The architectural collision export stops visitors, but it never covered every drawn
// surface: the hall's full-height limestone, several ceilings and wall claddings have
// no collider. The follow camera swung straight through them and looked at the visitor
// from behind a wall. These surfaces go into a second, ray-only world that only the
// camera boom queries, so where a visitor can walk is exactly what it was.

/** Only broad surfaces can hide a visitor; rods, trims, foliage and ornaments stay passable. */
const MINIMUM_AREA = 0.02;
const SAMPLE_ABOVE = 4096, SAMPLE_STRIDE = 32;

const seeThrough = (material: THREE.Material | undefined) => {
  if (!material) return true;
  const surface = material as THREE.MeshPhysicalMaterial;
  return material.visible === false || material.transparent || material.opacity < 1 || Number(surface.transmission) > 0
    || /glass|glaz/i.test(material.name);
};

export function createCameraOccluders(scene: THREE.Object3D) {
  const started = performance.now();
  const kept: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edge = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.BatchedMesh).isBatchedMesh) return;
    const position = mesh.geometry?.attributes.position;
    if (!position) return;
    if ((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(seeThrough)) return;
    // The lift cabin, its doors and hydraulics move; a frozen copy would block an empty shaft.
    for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
      if (!parent.visible || parent.userData.liftRole || parent.name === 'MD source | founder-lift') return;
    }
    const index = mesh.geometry.index, count = Math.floor((index?.count ?? position.count) / 3);
    const corner = (triangle: number, vertex: number) => index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
    const area = (triangle: number) => {
      a.fromBufferAttribute(position, corner(triangle, 0)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, corner(triangle, 1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, corner(triangle, 2)).applyMatrix4(mesh.matrixWorld);
      return edge.subVectors(b, a).cross(c.sub(a)).length() / 2;
    };
    // Dense ornament (millions of leaf triangles) is recognised from a sample instead of a full pass.
    if (count > SAMPLE_ABOVE) {
      let broad = false;
      for (let triangle = 0; triangle < count && !broad; triangle += SAMPLE_STRIDE) broad = area(triangle) >= MINIMUM_AREA;
      if (!broad) return;
    }
    for (let triangle = 0; triangle < count; triangle++) {
      if (area(triangle) < MINIMUM_AREA) continue;
      // area() left a at the first corner and b at the second; c was consumed by the cross product.
      c.fromBufferAttribute(position, corner(triangle, 2)).applyMatrix4(mesh.matrixWorld);
      kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  });
  if (!kept.length) return undefined;
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const triangles = kept.length / 9;
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(kept), Uint32Array.from({ length: triangles * 3 }, (_, i) => i)));
  world.step();
  const ball = new RAPIER.Ball(0.19), identity = { x: 0, y: 0, z: 0, w: 1 };
  console.info('[MD camera occluders]', { triangles, ms: Math.round(performance.now() - started) });
  return {
    triangles,
    /** Longest clear boom, up to `length`, from the pivot along a unit direction. */
    distance(pivot: THREE.Vector3, direction: THREE.Vector3, length: number, clearance: number) {
      ball.radius = clearance;
      // A surface the pivot already touches is not an obstacle to moving away from it.
      const sweep = world.castShape(pivot, identity, direction, ball, 0.01, length, false);
      const center = world.castRay(new RAPIER.Ray(pivot, direction), length, false);
      return Math.max(0, Math.min(length, sweep ? sweep.time_of_impact - 0.01 : length, center ? center.timeOfImpact - clearance : length));
    },
    dispose() { world.free(); },
  };
}
