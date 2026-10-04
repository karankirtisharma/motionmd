import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export const PLAYER_RADIUS = 0.25;
export const PLAYER_HALF_SEGMENT = 0.60;
export const PLAYER_HALF_HEIGHT = PLAYER_HALF_SEGMENT + PLAYER_RADIUS;
export type ExplorationBounds = { minX: number; maxX: number; minZ: number; maxZ: number; height?: number };

export async function createCollisionWorld(scene: THREE.Object3D, collisionUrl?: string, preparedCollisionRoot?: THREE.Object3D, additionalUrls: string[] = [], bounds?: ExplorationBounds) {
  await RAPIER.init();
  const urls = [collisionUrl, ...additionalUrls].filter((url): url is string => !!url);
  const results = preparedCollisionRoot ? [] : await Promise.allSettled(urls.map((url) => new GLTFLoader().loadAsync(url)));
  const loaded = results.filter((result): result is PromiseFulfilledResult<GLTF> => result.status === 'fulfilled').map((result) => result.value);
  function disposeLoaded() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    loaded.forEach((gltf) => gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
        materials.add(material);
        Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
      });
    }));
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); textures.forEach((texture) => texture.dispose());
  }
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') { disposeLoaded(); throw failure.reason; }
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const root = preparedCollisionRoot ?? (loaded.length ? new THREE.Group().add(...loaded.map((gltf) => gltf.scene)) : scene);
  // The large original context ground was intentionally omitted from the first
  // architectural collider export. Reuse its exact loaded source primitive so
  // visitors can reach the entrance without falling through the visible ground.
  const isSourceGround = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((material) => /Neutral architectural ground/i.test(material.name));
  if (bounds && root !== scene) {
    scene.updateMatrixWorld(true);
    const sourceGround: THREE.Mesh[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && isSourceGround(mesh)) sourceGround.push(mesh);
    });
    for (const mesh of sourceGround) {
      const proxy = new THREE.Mesh(mesh.geometry, mesh.material);
      proxy.name = 'Original source neutral presentation ground';
      proxy.matrix.copy(mesh.matrixWorld); proxy.matrixAutoUpdate = false;
      root.add(proxy);
    }
  }
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const colliderNames = new Map<number, string>();
  let meshCount = 0, triangleCount = 0;
  try { root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position || mesh.userData.noCollision) return;
    if (!loaded.length && !preparedCollisionRoot) {
      const name = `${mesh.name} ${mesh.userData.sourceName ?? ''}`.toLowerCase();
      if (!/(floor|wall|stair|step|slab|column|chair|table|sofa|glaz|door)/.test(name) && !(bounds && isSourceGround(mesh))) return;
      if (/(trim|seam|led|light|label|handle|hinge|shadow|logo|text)/.test(name)) return;
      // Do not accidentally upload millions of decorative triangles into physics.
      if (mesh.geometry.attributes.position.count > 30000) return;
    }
    const vertices: number[] = [], triangles: number[] = [];
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertices.push(point.x, point.y, point.z);
    }
    const index = mesh.geometry.index;
    if (index) for (let i = 0; i < index.count; i++) triangles.push(index.getX(i));
    else for (let i = 0; i < position.count; i++) triangles.push(i);
    if (triangles.length < 3) return;
    const obstacle = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(triangles), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.6));
    colliderNames.set(obstacle.handle, String(mesh.userData.sourceName ?? mesh.name));
    triangleCount += triangles.length / 3;
    meshCount++;
  }); } catch (error) { world.free(); disposeLoaded(); throw error; }
  if (triangleCount < 1) { world.free(); disposeLoaded(); throw new Error('No architectural collision surfaces were available.'); }
  let perimeterColliders = 0;
  if (bounds) {
    const { minX, maxX, minZ, maxZ } = bounds;
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ) {
      world.free(); disposeLoaded(); throw new Error('Exploration bounds must describe a finite rectangle.');
    }
    const halfThickness = 0.25, height = Math.max(20, bounds.height ?? 20);
    const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
    const halfWidth = (maxX - minX) / 2, halfDepth = (maxZ - minZ) / 2;
    for (const [name, x, z, hx, hz] of [
      ['west', minX - halfThickness, centerZ, halfThickness, halfDepth + 0.5],
      ['east', maxX + halfThickness, centerZ, halfThickness, halfDepth + 0.5],
      ['north', centerX, minZ - halfThickness, halfWidth + 0.5, halfThickness],
      ['south', centerX, maxZ + halfThickness, halfWidth + 0.5, halfThickness],
    ] as const) {
      const perimeter = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, height / 2, hz).setTranslation(x, height / 2 - 2, z));
      colliderNames.set(perimeter.handle, `Exploration perimeter ${name}`); perimeterColliders++;
    }
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HALF_SEGMENT, PLAYER_RADIUS), body);
  const controller = world.createCharacterController(0.015);
  // A 1mm contact nudge avoids float-precision snags on broad triangulated floors.
  controller.setNormalNudgeFactor(0.001);
  controller.enableAutostep(0.27, 0.18, false);
  controller.enableSnapToGround(0.32);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.24);
  controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  controller.setSlideEnabled(true);
  world.timestep = 1 / 60;
  world.step();

  function place(feet: THREE.Vector3) {
    const center = { x: feet.x, y: feet.y + PLAYER_HALF_HEIGHT + 0.015, z: feet.z };
    body.setTranslation(center, true); body.setNextKinematicTranslation(center); world.step();
  }
  function cast(origin: THREE.Vector3, direction: THREE.Vector3, distance: number) {
    return world.castRay(new RAPIER.Ray(origin, direction), distance, true, undefined, undefined, capsule, body);
  }
  return {
    meshCount, triangleCount, perimeterColliders,
    world, capsule, body, controller, place, colliderNames,
    move(displacement: THREE.Vector3, dt: number, output: THREE.Vector3) {
      world.timestep = dt;
      controller.computeColliderMovement(capsule, displacement, undefined, undefined, (candidate) => candidate.handle !== capsule.handle);
      const movement = controller.computedMovement();
      const old = body.translation();
      body.setNextKinematicTranslation({ x: old.x + movement.x, y: old.y + movement.y, z: old.z + movement.z });
      world.step();
      const value = body.translation();
      output.set(value.x, value.y - PLAYER_HALF_HEIGHT - 0.015, value.z);
      return controller.computedGrounded();
    },
    groundAt(position: THREE.Vector3, maximumDrop = 8) {
      const origin = position.clone().add(new THREE.Vector3(0, 0.6, 0));
      const hit = cast(origin, new THREE.Vector3(0, -1, 0), maximumDrop + 0.6);
      return hit ? origin.y - hit.timeOfImpact : position.y;
    },
    canStandAt(feet: THREE.Vector3) {
      const center = { x: feet.x, y: feet.y + PLAYER_HALF_HEIGHT + 0.015, z: feet.z };
      return !world.intersectionWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, capsule.shape, undefined, undefined, capsule, body);
    },
    hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3, tolerance = 0.15) {
      const delta = b.clone().sub(a), length = delta.length();
      if (length < tolerance) return true;
      const hit = cast(a, delta.multiplyScalar(1 / length), Math.max(0, length - tolerance));
      return !hit;
    },
    cameraDistance(pivot: THREE.Vector3, camera: THREE.Vector3, clearance = 0.19) {
      const direction = camera.clone().sub(pivot), length = direction.length();
      if (length < 0.001) return 0;
      direction.multiplyScalar(1 / length);
      const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(clearance);
      const up = new THREE.Vector3(0, clearance, 0);
      let distance = length;
      for (const offset of [new THREE.Vector3(), right, right.clone().negate(), up, up.clone().negate()]) {
        const hit = cast(pivot.clone().add(offset), direction, length);
        if (hit) distance = Math.min(distance, Math.max(0.18, hit.timeOfImpact - clearance));
      }
      return distance;
    },
    dispose() {
      world.free();
      disposeLoaded();
    },
  };
}
