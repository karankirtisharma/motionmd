import * as THREE from 'three';

type DisplayPlane = { center: THREE.Vector3; normal: THREE.Vector3; corners: THREE.Vector3[] };

// Measured connected components of the v16 export, before spatial partitioning.
// Only the wide curved shell and bezel; stand, hinge, ports and rear detail stay.
const shells: Record<string, { vertices: number; indices: number; remove: number[][] }> = {"Box_Studio_textured_rug002_48":{"vertices":334116,"indices":526392,"remove":[[16044,28344],[29244,41544],[58488,70788],[87732,100032],[116976,129276],[146220,158520],[175464,187764],[204708,217008],[233952,246252],[263196,275496],[292440,304740],[321684,333984],[350928,363228],[380172,392472],[409416,421716],[438660,450960],[467904,480204],[497148,509448]]},"Box_Studio_textured_rug002_50":{"vertices":173506,"indices":572832,"remove":[[0,576],[31824,32400],[63648,64224],[95472,96048],[127296,127872],[159120,159696],[190944,191520],[222768,223344],[254592,255168],[286416,286992],[318240,318816],[350064,350640],[381888,382464],[413712,414288],[445536,446112],[477360,477936],[509184,509760],[541008,541584]]}};

export function prepareSlimMonitorHousings(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh, spec = shells[object.name];
    if (!mesh.isMesh || !spec || mesh.geometry.userData.slimMonitor) return;
    const source = mesh.geometry, index = source.index;
    if (!index || source.getAttribute('position').count !== spec.vertices || index.count !== spec.indices) return;
    const retained: number[] = []; let range = 0;
    for (let i = 0; i < index.count; i++) {
      while (range < spec.remove.length && i >= spec.remove[range][1]) range++;
      if (range < spec.remove.length && i >= spec.remove[range][0]) continue;
      retained.push(index.getX(i));
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(retained); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.userData = { ...source.userData, slimMonitor: true };
    mesh.geometry = geometry;
  });
}

/** Closed 22 mm panels plus narrow rear mounts. Shared geometry, one draw call.
 * Front remains behind the native display so it cannot fight its depth aperture. */
export function createMonitorReturns(_screens: THREE.Mesh[], planes: DisplayPlane[]) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x242421, roughness: .55, metalness: .25 });
  const housing = new THREE.InstancedMesh(geometry, material, planes.length * 2);
  planes.forEach((plane, i) => {
    const right = plane.corners[1].clone().sub(plane.corners[0]);
    const up = plane.corners[0].clone().sub(plane.corners[3]);
    const panel = new THREE.Matrix4().makeBasis(
      right.clone().setLength(right.length() + .016),
      up.clone().setLength(up.length() + .016),
      plane.normal.clone().multiplyScalar(.022),
    ).setPosition(plane.center.clone().addScaledVector(plane.normal, -.013));
    housing.setMatrixAt(i, panel);
    // Meet the retained hinge/electronics enclosure without a floating panel.
    const mount = new THREE.Matrix4().makeBasis(
      right.clone().setLength(.22), up.clone().setLength(.16),
      plane.normal.clone().multiplyScalar(.12),
    ).setPosition(plane.center.clone().addScaledVector(plane.normal, -.080).addScaledVector(up.clone().normalize(), -.025));
    housing.setMatrixAt(planes.length + i, mount);
  });
  housing.computeBoundingSphere();
  housing.name = 'md. desktop | slim closed monitor housings';
  housing.userData.castShadow = false;
  return housing;
}
