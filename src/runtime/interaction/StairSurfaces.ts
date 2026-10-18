import * as THREE from 'three';
/** Read-only contact surface from the exported visible treads, not the capsule ramp.
 * Index horizontal top triangles once; foot queries never raycast the whole room.
 */
export function createStairSurfaces(scene: THREE.Object3D) {
    type Triangle = {
        a: THREE.Vector3;
        b: THREE.Vector3;
        c: THREE.Vector3;
        y: number;
        minX: number; maxX: number; minZ: number; maxZ: number; visited: number;
    };
    const cells = new Map<string, Triangle[]>(), cellSize = .15;
    const key = (x: number, z: number) => `${x},${z}`;
    scene.updateWorldMatrix(true, true);
    scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh)
            return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const eligible = materials.map(m => /(?:shell|entrance)__EH54 \| scanned cream limestone panels|v13__V(?:16|17).*?(?:stair glass|optical low iron laminated glass|polished aqua glass edge)|(?:v18|v19|entrance)__EH54 \| polished warm-grey cloud marble/.test(m.name));
        if (!eligible.some(Boolean))
            return;
        const geometry = mesh.geometry, positions = geometry.attributes.position, index = geometry.index;
        const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? positions.count, materialIndex: 0 }];
        for (const group of groups) {
            if (!eligible[group.materialIndex ?? 0])
                continue;
            const entryStone = /scanned cream limestone/.test(materials[group.materialIndex ?? 0].name);
            for (let i = group.start; i < group.start + group.count; i += 3) {
                const points = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
                const [a, b, c] = points;
                const normal = b.clone().sub(a).cross(c.clone().sub(a));
                if (normal.lengthSq() < 1e-12) continue;
                normal.normalize();
                if (normal.y < .999 && !(entryStone && normal.y < -.999)) continue;
                if (Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y) > .002) continue;
                // The exported entry blocks have reversed top winding. Accept both
                // horizontal windings and select the highest support, never a side face.
                if (entryStone && Math.max(a.y,b.y,c.y) > .05) continue;
                const triangle = { a, b, c, y: (a.y + b.y + c.y) / 3, minX: Math.min(a.x,b.x,c.x), maxX: Math.max(a.x,b.x,c.x), minZ: Math.min(a.z,b.z,c.z), maxZ: Math.max(a.z,b.z,c.z), visited: 0 };
                for (let x = Math.floor(Math.min(a.x, b.x, c.x) / cellSize); x <= Math.floor(Math.max(a.x, b.x, c.x) / cellSize); x++) {
                    for (let z = Math.floor(Math.min(a.z, b.z, c.z) / cellSize); z <= Math.floor(Math.max(a.z, b.z, c.z) / cellSize); z++) {
                        const id = key(x, z), bucket = cells.get(id) ?? [];
                        bucket.push(triangle);
                        cells.set(id, bucket);
                    }
                }
            }
        }
    });
    let query = 0;
    return (point: THREE.Vector3, supportY: number, margin = 0): number | undefined => {
        let height = -Infinity;
        query++;
        for (let x = Math.floor((point.x - margin) / cellSize); x <= Math.floor((point.x + margin) / cellSize); x++)
            for (let z = Math.floor((point.z - margin) / cellSize); z <= Math.floor((point.z + margin) / cellSize); z++) {
                for (const triangle of cells.get(key(x, z)) ?? []) {
                    if (triangle.visited === query) continue;
                    triangle.visited = query;
                    if (point.x < triangle.minX-margin || point.x > triangle.maxX+margin || point.z < triangle.minZ-margin || point.z > triangle.maxZ+margin) continue;
                    const {a,b,c,y}=triangle;
                    if (y > supportY + .45 || y < supportY - .55 || y <= height)
                        continue;
                    const cross = (u: THREE.Vector3, v: THREE.Vector3) => (v.x - u.x) * (point.z - u.z) - (v.z - u.z) * (point.x - u.x);
                    const ab = cross(a, b), bc = cross(b, c), ca = cross(c, a);
                    if ((ab >= -1e-7 && bc >= -1e-7 && ca >= -1e-7) || (ab <= 1e-7 && bc <= 1e-7 && ca <= 1e-7))
                        height = y;
                    else if (margin > 0 && y > point.y) {
                        const edgeDistance = (u: THREE.Vector3, v: THREE.Vector3) => {
                            const dx = v.x - u.x, dz = v.z - u.z;
                            const t = THREE.MathUtils.clamp(((point.x - u.x) * dx + (point.z - u.z) * dz) / (dx * dx + dz * dz), 0, 1);
                            return Math.hypot(point.x - u.x - t * dx, point.z - u.z - t * dz);
                        };
                        const distance = Math.min(edgeDistance(a, b), edgeDistance(b, c), edgeDistance(c, a));
                        if (distance < margin)
                            height = Math.max(height, point.y + (y - point.y) * (1 - distance / margin));
                    }
                }
            }
        return Number.isFinite(height) ? height : undefined;
    };
}
