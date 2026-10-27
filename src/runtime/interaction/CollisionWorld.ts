import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { repairArchitecturalJoins } from '../rendering/architecturalJoins.ts';
import { repairStudioThreshold } from '../rendering/floorThreshold.ts';
import { repairEntranceApron } from '../rendering/entranceApron.ts';
import { chairCollision } from './chairCollision.ts';
import { exactBox } from './exactBox.ts';
import { exteriorCollision } from './exteriorCollision.ts';
import { exteriorCollisionGeometry } from '../rendering/exteriorSurfaces.ts';
import { facadeCollision } from './facadeCollision.ts';
import { clubCollision } from './clubCollision.ts';

// Measured shipping rig: idle hands span 0.648 m; running crown reaches 1.886 m.
// Keep the support offset separate from the visual sole and cover the actual body.
export const PLAYER_RADIUS = 0.25;
export const PLAYER_HALF_SEGMENT = 0.70;
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
  // Apply the same measured finish repairs to visible and collision geometry.
  repairArchitecturalJoins(root);
  repairStudioThreshold(root);
  repairEntranceApron(root);
  const point = new THREE.Vector3();
  const colliderNames = new Map<number, string>();
  const workstationColliders: RAPIER.Collider[] = [];
  let workstationConfigured = false;
    let workstationPlacement: { offset: THREE.Vector3; rotation: THREE.Quaternion } | undefined;
    let workstationAngle = 0;
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
    const position = mesh.geometry.attributes.position;
    const vertices = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = point.x; vertices[i * 3 + 1] = point.y; vertices[i * 3 + 2] = point.z;
    }
    const index = mesh.geometry.index;
    const triangles = new Uint32Array(index?.count ?? position.count);
    for (let i = 0; i < triangles.length; i++) triangles[i] = index ? index.getX(i) : i;
    if (triangles.length < 3) return;
    let descriptor = mesh.userData.collisionShape === 'convexHull'
      ? RAPIER.ColliderDesc.convexMesh(vertices, triangles)
      : RAPIER.ColliderDesc.trimesh(vertices, triangles, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
    // These two source treads are axis-aligned solid blocks. A box avoids
    // capsule contacts against the bevel triangles of their narrow risers.
    if (/^EXT77 \| entry stair (lower|upper)$/.test(String(mesh.userData.sourceName ?? ''))) {
      const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(vertices, 3));
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5), center = box.getCenter(new THREE.Vector3());
      descriptor = RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z).setTranslation(center.x, center.y, center.z);
    }
    const box = mesh.userData.collisionShape === 'convexHull' || /^FC91 Installed \|/.test(String(mesh.userData.sourceName ?? '')) ? undefined : exactBox(vertices, triangles);
    if (box) {
      const half=box.getSize(new THREE.Vector3()).multiplyScalar(.5), center=box.getCenter(new THREE.Vector3());
      descriptor=RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z);
    }
    if (!descriptor) throw new Error(`Invalid collision envelope: ${mesh.name}`);
    let obstacle: RAPIER.Collider;
    try { obstacle = world.createCollider(descriptor.setFriction(0.6)); }
    catch (error) { throw new Error(`Invalid collision geometry ${mesh.userData.sourceName ?? mesh.name}: ${String(error)}`); }
    colliderNames.set(obstacle.handle, String(mesh.userData.sourceName ?? mesh.name));
    if (/^FC91 Installed \|/.test(String(mesh.userData.sourceName ?? ''))) workstationColliders.push(obstacle);
    triangleCount += triangles.length / 3;
    meshCount++;
  }); } catch (error) { world.free(); disposeLoaded(); throw error; }
  // These two leather components were absent from the export's collision selection.
  // Their source-derived hull error stays below the existing 15 mm contact offset.
  if (workstationColliders.length) for (const piece of chairCollision) {
    const descriptor = RAPIER.ColliderDesc.convexMesh(new Float32Array(piece.vertices), new Uint32Array(piece.indices));
    if (!descriptor) throw new Error(`Invalid chair ${piece.name} collision envelope`);
    const collider = world.createCollider(descriptor);
    workstationColliders.push(collider); colliderNames.set(collider.handle, `FC91 Installed | ${piece.name} contact envelope`);
    meshCount++; triangleCount += piece.indices.length / 3;
  }
  // The source collision export omitted five finished exterior slabs. Use their
  // exact closed source surfaces (including bevels), with outward winding.
  if ([...colliderNames.values()].includes('Main FFL continuous floor')) {
    // The four decorative club chairs had only their cushions in the export.
    // Their outer hulls protect the wraparound backs/arms; they are not sit targets.
    for (const piece of clubCollision) {
      const descriptor = RAPIER.ColliderDesc.convexMesh(new Float32Array(piece.vertices), new Uint32Array(piece.indices));
      if (!descriptor) throw new Error(`Invalid club-chair envelope: ${piece.name}`);
      const collider = world.createCollider(descriptor);
      colliderNames.set(collider.handle, piece.name);
      meshCount++; triangleCount += piece.indices.length / 3;
    }
    for (const piece of facadeCollision) {
      const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(piece.vertices), new Uint32Array(piece.indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
      colliderNames.set(collider.handle, `Source facade | ${piece.name}`);
      meshCount++; triangleCount += piece.indices.length / 3;
    }
    for (const piece of exteriorCollision) {
      if (piece.existingCollider) continue;
      const fixed = exteriorCollisionGeometry(piece);
      const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(fixed.vertices, fixed.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
      colliderNames.set(collider.handle, `Source exterior | ${piece.name}`);
      meshCount++; triangleCount += piece.indices.length / 3;
    }
  }
  if (triangleCount < 1) { world.free(); disposeLoaded(); throw new Error('No architectural collision surfaces were available.'); }
  // The founder rug's visible pile was omitted from the architectural hulls.
  // Support soles at its measured surface instead of the stone 35 mm below it.
  const rugBounds = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && /founder__FR79 \| (antique bronze hand knotted rug|reference wool fiber)$/.test(mesh.material.name)) rugBounds.union(new THREE.Box3().setFromObject(mesh));
  });
  if (!rugBounds.isEmpty()) {
    const size = rugBounds.getSize(new THREE.Vector3()).multiplyScalar(0.5), center = rugBounds.getCenter(new THREE.Vector3());
    const rug = world.createCollider(RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z).setTranslation(center.x, center.y, center.z));
    colliderNames.set(rug.handle, 'Founder rug surface');
  }
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
  // Predicting a horizontal torso path through a staircase ignores the height
  // gained by stepping up. Only the authored tread/ramp/landing solids skip
  // this speed prediction; rails, posts and every physical KCC sweep remain.
  const stairSupportColliders = new Set([...colliderNames].filter(([, name]) =>
    /^(?:V13 \| helical stair (?:walking ramp|landing)|V16 \| Unified marble landing and short steps|V(?:18|19) \| Unified curved pavement and rounded short steps|EXT77 \| entry stair (?:lower|upper)|EH42 stair (?:(?:lower|upper) (?:closed tread|nosing) \d+|intermediate landing|top landing))$/.test(name),
  ).map(([handle]) => handle));
  const predictiveObstacle = (candidate: RAPIER.Collider) => !stairSupportColliders.has(candidate.handle);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HALF_SEGMENT, PLAYER_RADIUS), body);
  // Keep the established hand/shoulder guard; remove the extra stopping reserve,
  // rather than shrinking protection around the skin or changing stair support.
  const torsoShape = new RAPIER.Capsule(0.35, 0.35);
  const torsoOffset = 1.05 - PLAYER_HALF_HEIGHT;
  const torso = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.35).setTranslation(0, torsoOffset, 0), body);
  const torsoController = world.createCharacterController(0.015);
  torsoController.setNormalNudgeFactor(0.001);
  let deskClearance = false;
  const controller = world.createCharacterController(0.015);
  // A 1mm contact nudge avoids float-precision snags on broad triangulated floors.
  controller.setNormalNudgeFactor(0.001);
  // The short stone treads need a smaller landing probe than the capsule diameter.
  controller.enableAutostep(0.27, 0.08, false);
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
  const cameraShape = new RAPIER.Ball(0.19);
  const cameraDirection = new THREE.Vector3();
  const identityRotation = { x: 0, y: 0, z: 0, w: 1 };
  return {
    meshCount, triangleCount, perimeterColliders,
    world, capsule, body, controller, place, colliderNames, torso,
    setDeskClearance(active: boolean) {
      // Authored desk contact IK owns body placement during the measured approach.
      // Keep head clearance, use torso depth, and suspend only the shoulder guard.
      deskClearance = active; torso.setEnabled(!active);
      const radius = active ? 0.10 : PLAYER_RADIUS;
      capsule.setShape(new RAPIER.Capsule(PLAYER_HALF_HEIGHT - radius, radius));
    },
    restoreNavigationClearance(feet: THREE.Vector3) {
      // The full navigation margin includes arm swing. Expand only once that
      // margin fits, so releasing a desk pose cannot push the idle body sideways.
      const shape = new RAPIER.Capsule(PLAYER_HALF_HEIGHT - PLAYER_RADIUS, PLAYER_RADIUS);
      const center = { x: feet.x, y: feet.y + PLAYER_HALF_HEIGHT + 0.015, z: feet.z };
      if (world.intersectionWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, undefined, capsule, body)) return false;
      const shoulderCenter = { x: center.x, y: center.y + torsoOffset, z: center.z };
      if (world.intersectionWithShape(shoulderCenter, identityRotation, torsoShape, undefined, undefined, capsule, body)) return false;
      capsule.setShape(shape); deskClearance = false; torso.setEnabled(true); return true;
    },
    move(displacement: THREE.Vector3, dt: number, output: THREE.Vector3, ignoreWorkstation = false) {
      world.timestep = dt;
      // Gravity is only a support probe while standing. Do not convert it into
      // sideways motion down a triangulated stair ramp. Walking still slides
      // along walls and slopes exactly as before.
      let restingOnStairRamp = false;
      if (Math.hypot(displacement.x, displacement.z) <= 0.00001) {
        const p = body.translation();
        const support = cast(new THREE.Vector3(p.x,p.y-PLAYER_HALF_HEIGHT+.2,p.z),new THREE.Vector3(0,-1,0),.7);
        restingOnStairRamp = !!support && /helical stair walking ramp/i.test(colliderNames.get(support.collider.handle) ?? '');
      }
      controller.setSlideEnabled(!restingOnStairRamp);
      const keep = (candidate: RAPIER.Collider) => candidate.parent()?.handle !== body.handle && (!ignoreWorkstation || !workstationColliders.includes(candidate));
      let desired: { x: number; y: number; z: number } = displacement;
      if (!deskClearance) {
        torsoController.computeColliderMovement(torso, displacement, undefined, undefined, keep);
        const guarded=torsoController.computedMovement();
        // The foot capsule owns support/step height. Shoulder contact must not
        // turn a cabinet bevel into a ramp for the whole character.
        desired={x:guarded.x,y:displacement.y,z:guarded.z};
      }
      controller.computeColliderMovement(capsule, desired, undefined, undefined, keep);
      const movement = controller.computedMovement();
      const grounded = controller.computedGrounded();
      const horizontal = Math.hypot(desired.x, desired.z);
      // A near-zero-time, purely upward support contact can consume Rapier's
      // horizontal iteration on large slabs. Resolve the tangent separately;
      // it still queries every wall/obstacle with the same full capsule.
      if (horizontal > .0001 && Math.hypot(movement.x,movement.z) < horizontal * .95 && controller.numComputedCollisions() > 0) {
        let supportOnly = true;
        for(let i=0;i<controller.numComputedCollisions();i++) {
          const hit=controller.computedCollision(i);
          if(!hit || hit.normal1.y < .9999) { supportOnly=false; break; }
        }
        if(supportOnly) {
          controller.computeColliderMovement(capsule,{x:desired.x,y:0,z:desired.z},undefined,undefined,keep);
          const tangent=controller.computedMovement();
          movement.x=tangent.x; movement.z=tangent.z;
        }
      }
      // Autostep may adjust the lower capsule's result. Sweep the upper body
      // through that final displacement as well, so it cannot creep into a
      // cabinet lip or overhang after the first shoulder solve.
      if(!deskClearance && Math.hypot(movement.x,movement.y,movement.z) > 1e-8) {
        const limit=world.castShape(torso.translation(),identityRotation,movement,torsoShape,.015,1,false,undefined,undefined,capsule,body,keep);
        if(limit) {
          const t=Math.max(0,Math.min(1,limit.time_of_impact));
          movement.x*=t;movement.y*=t;movement.z*=t;
        }
      }
      const old = body.translation();
      const next={x:old.x+movement.x,y:old.y+movement.y,z:old.z+movement.z};
      // At metre-scale floor extents the f32 convex contact can settle a few
      // millimetres below its support. Reconcile only a nearby horizontal top;
      // stair risers, ramps, falling and step-height changes keep the KCC result.
      if(grounded && displacement.y <= 0) {
        const footY=next.y-PLAYER_HALF_HEIGHT-.015;
        const oldFootY=old.y-PLAYER_HALF_HEIGHT-.015;
        // Sweep from the previous support height. Rapier's snap can occasionally
        // cross a flat top by more than the local 25 mm reconciliation window.
        // Starting above the old foot catches that crossing, not a slab underside.
        const rayY=Math.max(oldFootY,footY)+.03;
        const support=world.castRayAndGetNormal(new RAPIER.Ray({x:next.x,y:rayY,z:next.z},{x:0,y:-1,z:0}),rayY-footY+.03,true,undefined,undefined,capsule,body,keep);
        if(support && support.normal.y > .9999) {
          const surface=rayY-support.timeOfImpact;
          if(surface-footY > -.002 && surface <= Math.max(oldFootY,footY)+.025) next.y=Math.max(next.y,surface+PLAYER_HALF_HEIGHT+.016);
        }
      }
      body.setNextKinematicTranslation(next);
      world.step();
      const value = body.translation();
      output.set(value.x, value.y - PLAYER_HALF_HEIGHT - 0.015, value.z);
      return grounded;
    },
    speedForClearance(direction: THREE.Vector3, requestedSpeed: number) {
      if (deskClearance || direction.lengthSq() < 1e-8) return requestedSpeed;
      const length = Math.hypot(direction.x, direction.z);
      const velocity = { x: direction.x / length, y: 0, z: direction.z / length };
      const hit = world.castShape(torso.translation(), identityRotation, velocity, torsoShape, .015, 1.2, false, undefined, undefined, capsule, body, predictiveObstacle);
      // Slow the stride progressively, then approach the actual body contact.
      // A permanent stride-length reserve creates an invisible wall after the
      // gait has already settled. Keep the physical guard and contact skin.
      if (!hit) return requestedSpeed;
      const gap = Math.max(0, hit.time_of_impact);
      // Quadratic braking settles long strides early; the bounded final approach
      // avoids an asymptotic crawl while still reaching zero at physical contact.
      return Math.min(requestedSpeed, 3 * gap, Math.max(.12, 2.5 * gap * gap));
    },
    groundAt(position: THREE.Vector3, maximumDrop = 8) {
      const origin = position.clone().add(new THREE.Vector3(0, 0.6, 0));
      const down = new THREE.Vector3(0, -1, 0);
      let support = -Infinity;
      // A single f32 ray can miss exactly on a coplanar triangle edge and
      // find the slab underside. Millimetre neighbours stabilize placement
      // without changing the capsule's normal, per-frame movement solver.
      for (const [dx, dz] of [[0, 0], [-0.002, 0], [0.002, 0], [0, -0.002], [0, 0.002]]) {
        origin.x = position.x + dx; origin.z = position.z + dz;
        const hit = cast(origin, down, maximumDrop + 0.6);
        if (hit) support = Math.max(support, origin.y - hit.timeOfImpact);
      }
      return Number.isFinite(support) ? support : position.y;
    },
    canStandAt(feet: THREE.Vector3) {
      const center = { x: feet.x, y: feet.y + PLAYER_HALF_HEIGHT + 0.015, z: feet.z };
      if (world.intersectionWithShape(center, identityRotation, capsule.shape, undefined, undefined, capsule, body)) return false;
      return deskClearance || !world.intersectionWithShape({ x: center.x, y: center.y + torsoOffset, z: center.z }, identityRotation, torsoShape, undefined, undefined, capsule, body);
    },
    configureWorkstation(offset: THREE.Vector3, rotation: THREE.Quaternion, height: (y: number) => number) {
      if (workstationConfigured) return;
      for (const collider of workstationColliders) {
        const shape = collider.shape;
        if (shape instanceof RAPIER.ConvexPolyhedron || shape instanceof RAPIER.TriMesh) {
          const vertices = shape.vertices.slice();
          for (let i = 1; i < vertices.length; i += 3) vertices[i] = height(vertices[i]);
          collider.setShape(shape instanceof RAPIER.ConvexPolyhedron
            ? new RAPIER.ConvexPolyhedron(vertices, shape.indices)
            : new RAPIER.TriMesh(vertices, shape.indices, shape.flags));
        }
        collider.setTranslation(offset); collider.setRotation(rotation);
      }
        workstationPlacement = { offset: offset.clone(), rotation: rotation.clone() };
        workstationConfigured = true; world.step();
    },
      swivelWorkstation(pivot: THREE.Vector3, angle: number) {
        if (!workstationPlacement || angle === workstationAngle) return;
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        const offset = workstationPlacement.offset.clone().sub(pivot).applyQuaternion(turn).add(pivot);
        const rotation = turn.multiply(workstationPlacement.rotation);
        // Cushion, armrests, backrest and headrest all turn above the fixed spindle.
        for (const collider of workstationColliders) { collider.setTranslation(offset); collider.setRotation(rotation); }
        workstationAngle = angle; world.step();
      },
    hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3, tolerance = 0.15) {
      const delta = b.clone().sub(a), length = delta.length();
      if (length < tolerance) return true;
      const hit = cast(a, delta.multiplyScalar(1 / length), Math.max(0, length - tolerance));
      return !hit;
    },
    cameraDistance(pivot: THREE.Vector3, camera: THREE.Vector3, clearance = 0.19) {
      const direction = cameraDirection.subVectors(camera, pivot), length = direction.length();
      if (length < 0.001) return 0;
      direction.multiplyScalar(1 / length);
      cameraShape.radius = clearance;
      // Sweep the entire camera volume, including corners missed by five rays.
      const hit = world.castShape(pivot, identityRotation, direction, cameraShape, 0.01, length, true, undefined, undefined, capsule, body);
      // Never impose a minimum boom length: in a tight corner that would push
      // the camera through the obstacle that just stopped the sweep.
      const centerHit = cast(pivot, direction, length);
      return Math.max(0, Math.min(length, hit ? hit.time_of_impact - 0.01 : length,
        centerHit ? centerHit.timeOfImpact - clearance : length));
    },
    dispose() {
      world.free();
      disposeLoaded();
    },
  };
}
