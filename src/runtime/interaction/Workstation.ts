import * as THREE from 'three';

/** Calibrated against the evaluated v21 founder GLB and its named collision meshes.
 * All distances are metres; the original GLB and source Blender geometry stay intact. */
export const WORKSTATION = {
  id: 'founder-desk',
  sourceSeat: [15.5748868, 4.265, -3.7747329],
  sourceForward: [-0.975887, 0, -0.218281],
  seat: [15.42, 4.265, -5.3],
  cushionHeight: 4.8264914 - 4.265,
  desk: { min: [16.125, 5.02, -6.85], max: [17.275, 5.05799985, -3.75] },
  screen: [20.79, 6.3285, -5.3],

  // Preserve the original executive chair dimensions.
  scale: 1,
  seatDrop: 0.12,
} as const;

/** Retract only the pedestal; the complete upholstered assembly translates rigidly.
 * Source bounds: base crown starts at 4.343, recline mechanism at 4.560 metres. */
export function chairHeight(y: number) {
  return y - WORKSTATION.seatDrop * THREE.MathUtils.clamp((y - 4.343) / (4.560 - 4.343), 0, 1);
}

function setChairHeight(mesh: THREE.Mesh) {
  const geometry = mesh.geometry.clone();
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const toLocal = mesh.matrixWorld.clone().invert();
  const toWorldNormal = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld), toLocalNormal = toWorldNormal.clone().invert();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    const inPedestal = p.y > 4.343 && p.y < 4.560;
    p.y = chairHeight(p.y); p.applyMatrix4(toLocal); position.setXYZ(i, p.x, p.y, p.z);
    if (normal && inPedestal) {
      n.fromBufferAttribute(normal, i).applyMatrix3(toWorldNormal);
      n.y /= 1 - WORKSTATION.seatDrop / (4.560 - 4.343);
      n.applyMatrix3(toLocalNormal).normalize(); normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  mesh.geometry = geometry;
}

export function createWorkstation(scene: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && /^founder__FC9[12] \|/.test(mesh.material.name)) meshes.push(mesh);
  });
  if (!meshes.length) return undefined;
  for (const mesh of meshes) setChairHeight(mesh);
  const group = new THREE.Group(); group.name = 'Founder interactive desk chair';
  const source = new THREE.Vector3(...WORKSTATION.sourceSeat);
  group.position.copy(source); scene.add(group); group.updateMatrixWorld(true);
  for (const mesh of meshes) group.attach(mesh);
  group.scale.setScalar(WORKSTATION.scale);
  const rotation = Math.PI / 2 - Math.atan2(WORKSTATION.sourceForward[0], WORKSTATION.sourceForward[2]);
  group.rotation.y = rotation;
  const seat = new THREE.Vector3(...WORKSTATION.seat);
  const forward = new THREE.Vector3(1, 0, 0);
  const transform = new THREE.Matrix4(), rotationMatrix = new THREE.Matrix4().makeRotationY(rotation);
  const offset = new THREE.Vector3(), rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
  group.position.copy(seat); group.updateMatrixWorld(true);
  offset.copy(seat).sub(source.clone().applyMatrix4(rotationMatrix));
  transform.copy(rotationMatrix).setPosition(offset);
  return {
    id: WORKSTATION.id, group, meshes, seat: seat.clone().addScaledVector(forward, 0.20), forward,
    floor: seat.y, height: WORKSTATION.cushionHeight - WORKSTATION.seatDrop,
    screen: new THREE.Vector3(...WORKSTATION.screen),
    deskHeight: WORKSTATION.desk.max[1],
    deskFront: WORKSTATION.desk.min[0],
    // Wrist is near the front edge; palm and fingers extend onto the desktop.
    wrists: [new THREE.Vector3(16.145, WORKSTATION.desk.max[1] + 0.0396, -5.49), new THREE.Vector3(16.145, WORKSTATION.desk.max[1] + 0.0396, -5.11)],
    approach: new THREE.Vector3(15.80, seat.y, -6.32),
    aligned: new THREE.Vector3(15.98, seat.y, -5.3),
    collisionTransform: { offset, rotation: rotationQuaternion, height: chairHeight },
    transform,
  };
}

export type Workstation = NonNullable<ReturnType<typeof createWorkstation>>;
