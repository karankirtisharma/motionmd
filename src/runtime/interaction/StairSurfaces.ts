import * as THREE from 'three';
/** Read-only contact surface from the exported visible treads, not the capsule ramp.
 * Index horizontal top triangles once; foot queries never raycast the whole room.
 */
export function createStairSurfaces(scene: THREE.Object3D) {
    type Triangle = {
        a: THREE.Vector3;
        b: THREE.Vector3;
        c: THREE.Vector3;
        y: number; stair: boolean; authoredStair: boolean; stairCandidate: boolean;
        minX: number; maxX: number; minZ: number; maxZ: number; visited: number;
    };
    const cells = new Map<string, Triangle[]>(), broad: Triangle[] = [], cellSize = .15;
    const key = (x: number, z: number) => `${x},${z}`;
    scene.updateWorldMatrix(true, true);
    scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh)
            return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const eligible = materials.map(m => /(?:shell|entrance)__EH54 \| scanned cream limestone panels|v13__V(?:16|17).*?(?:stair glass|optical low iron laminated glass|polished aqua glass edge)|(?:v18|v19|v13|entrance|shell|lounge|founder|studio|gallery)__EH54 \| polished warm-grey cloud marble|(?:shell|lounge)__PL86 \| ground wing polished existing marble|shell__Neutral architectural ground|founder__FR82 \| polished ivory large format stone|lounge__PL78 \| circular hand woven wool|founder__FR79 \| (?:antique bronze hand knotted rug|reference wool fiber|FR83 natural taupe wool)/.test(m.name));
        if (!eligible.some(Boolean))
            return;
        const geometry = mesh.geometry, positions = geometry.attributes.position, index = geometry.index;
        const groups = Array.isArray(mesh.material) && geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? positions.count, materialIndex: 0 }];
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
                if (Math.abs(normal.y) < .999) continue;
                if (Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y) > .002) continue;
                // The exported entry blocks have reversed top winding. Accept both
                // horizontal windings and select the highest support, never a side face.
                if (entryStone && Math.max(a.y,b.y,c.y) > .05) continue;
                const stair = /v13__V(?:16|17)|(?:v13|v19)__EH54/.test(materials[group.materialIndex ?? 0].name);
                const authoredStair = /v13__V(?:16|17)/.test(materials[group.materialIndex ?? 0].name);
                const stairCandidate = authoredStair || /(?:v13|v19|entrance|shell)__EH54 \| polished warm-grey cloud marble/.test(materials[group.materialIndex ?? 0].name) || (entryStone && a.y < .05 && a.y > -.36);
                const triangle = { a, b, c, stair, authoredStair, stairCandidate, y: (a.y + b.y + c.y) / 3, minX: Math.min(a.x,b.x,c.x), maxX: Math.max(a.x,b.x,c.x), minZ: Math.min(a.z,b.z,c.z), maxZ: Math.max(a.z,b.z,c.z), visited: 0 };
                // Large context-ground triangles must not allocate millions of grid cells.
                if ((triangle.maxX-triangle.minX)*(triangle.maxZ-triangle.minZ)/(cellSize*cellSize) > 4096) { broad.push(triangle); continue; }
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
    const sample = (point: THREE.Vector3, supportY: number, margin = 0): number | undefined => {
        let height = -Infinity;
        query++;
        for (let x = Math.floor((point.x - margin) / cellSize); x <= Math.floor((point.x + margin) / cellSize); x++)
            for (let z = Math.floor((point.z - margin) / cellSize); z <= Math.floor((point.z + margin) / cellSize); z++) {
                const local = cells.get(key(x, z)) ?? [];
                for (let i = 0; i < local.length + broad.length; i++) {
                    const triangle = i < local.length ? local[i] : broad[i-local.length];
                    if (triangle.visited === query) continue;
                    triangle.visited = query;
                    if (point.x < triangle.minX-margin || point.x > triangle.maxX+margin || point.z < triangle.minZ-margin || point.z > triangle.maxZ+margin) continue;
                    const {a,b,c,y,stair}=triangle;
                    // A surface beyond the controller's maximum step is an obstacle,
                    // not a target that both feet should fold upward to reach.
                    // Fade newly reachable authored treads over an 8 cm band.
                    // Exact contact and ordinary ledges retain the 27 cm limit.
                    const anticipation = margin > 0 && stair;
                    if (y > supportY + (anticipation ? .35 : .27) || y < supportY - .55 || y <= height)
                        continue;
                    const reach = anticipation ? THREE.MathUtils.smoothstep(supportY + .35 - y, 0, .08) : 1;
                    const targetY = point.y + (y - point.y) * reach;
                    const cross = (u: THREE.Vector3, v: THREE.Vector3) => (v.x - u.x) * (point.z - u.z) - (v.z - u.z) * (point.x - u.x);
                    const ab = cross(a, b), bc = cross(b, c), ca = cross(c, a);
                    if ((ab >= -1e-7 && bc >= -1e-7 && ca >= -1e-7) || (ab <= 1e-7 && bc <= 1e-7 && ca <= 1e-7))
                        height = Math.max(height,targetY);
                    else if (margin > 0 && y > point.y) {
                        const edgeDistance = (u: THREE.Vector3, v: THREE.Vector3) => {
                            const dx = v.x - u.x, dz = v.z - u.z;
                            const t = THREE.MathUtils.clamp(((point.x - u.x) * dx + (point.z - u.z) * dz) / (dx * dx + dz * dz), 0, 1);
                            return Math.hypot(point.x - u.x - t * dx, point.z - u.z - t * dz);
                        };
                        const distance = Math.min(edgeDistance(a, b), edgeDistance(b, c), edgeDistance(c, a));
                        if (distance < margin)
                            height = Math.max(height, point.y + (targetY - point.y) * (1 - distance / margin));
                    }
                }
            }
        return Number.isFinite(height) ? height : undefined;
    };
    /** Batch one shoe against a shared candidate set. This is the same surface
     * query as sample(), but visits grid/broad triangles once per foot rather
     * than once per skinned vertex. Buffers are reused across frames. */
    const candidates: Triangle[] = [];
    sample.clearance = (points: readonly THREE.Vector3[], supportY: number, margin = .08): number => {
        if (!points.length) return 0;
        let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=Infinity;
        for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);minY=Math.min(minY,p.y);}
        candidates.length=0;query++;
        const include=(triangle:Triangle)=>{
            if(triangle.visited===query)return;triangle.visited=query;
            if(triangle.maxX<minX-margin||triangle.minX>maxX+margin||triangle.maxZ<minZ-margin||triangle.minZ>maxZ+margin)return;
            if(triangle.y<=minY-.003||triangle.y<supportY-.55||triangle.y>supportY+(triangle.stair&&margin>0?.35:.27))return;
            candidates.push(triangle);
        };
        for(let x=Math.floor((minX-margin)/cellSize);x<=Math.floor((maxX+margin)/cellSize);x++)
            for(let z=Math.floor((minZ-margin)/cellSize);z<=Math.floor((maxZ+margin)/cellSize);z++)
                for(const triangle of cells.get(key(x,z))??[])include(triangle);
        for(const triangle of broad)include(triangle);
        let required=0;
        for(const triangle of candidates){
            const {a,b,c,y,stair}=triangle;
            const reach=margin>0&&stair?THREE.MathUtils.smoothstep(supportY+.35-y,0,.08):1;
            const abx=b.x-a.x,abz=b.z-a.z,bcx=c.x-b.x,bcz=c.z-b.z,cax=a.x-c.x,caz=a.z-c.z;
            const abl=abx*abx+abz*abz,bcl=bcx*bcx+bcz*bcz,cal=cax*cax+caz*caz;
            for(const p of points){
                const lift=(y-p.y)*reach+.003;
                if(lift<=required||p.x<triangle.minX-margin||p.x>triangle.maxX+margin||p.z<triangle.minZ-margin||p.z>triangle.maxZ+margin)continue;
                const ab=abx*(p.z-a.z)-abz*(p.x-a.x),bc=bcx*(p.z-b.z)-bcz*(p.x-b.x),ca=cax*(p.z-c.z)-caz*(p.x-c.x);
                if((ab>=-1e-7&&bc>=-1e-7&&ca>=-1e-7)||(ab<=1e-7&&bc<=1e-7&&ca<=1e-7)){required=lift;continue;}
                if(margin<=0||y<=p.y)continue;
                const ta=THREE.MathUtils.clamp(((p.x-a.x)*abx+(p.z-a.z)*abz)/abl,0,1);
                const tb=THREE.MathUtils.clamp(((p.x-b.x)*bcx+(p.z-b.z)*bcz)/bcl,0,1);
                const tc=THREE.MathUtils.clamp(((p.x-c.x)*cax+(p.z-c.z)*caz)/cal,0,1);
                const distance=Math.sqrt(Math.min((p.x-a.x-ta*abx)**2+(p.z-a.z-ta*abz)**2,(p.x-b.x-tb*bcx)**2+(p.z-b.z-tb*bcz)**2,(p.x-c.x-tc*cax)**2+(p.z-c.z-tc*caz)**2));
                if(distance<margin)required=Math.max(required,(lift-.003)*(1-distance/margin)+.003);
            }
        }
        return required;
    };
    /** Authoring-aware stair gate. Shared marble alone is not evidence of stairs:
     * require a second reachable horizontal level nearby. This keeps the broad
     * merged landing and exterior slabs on their ordinary locomotion clips. */
    sample.isStair = (point: THREE.Vector3, supportY: number): boolean => {
        query++;
        const nearby: Array<{ y: number; distance: number; direct: boolean }> = [];
        const radius = .45;
        for (let x = Math.floor((point.x-radius)/cellSize); x <= Math.floor((point.x+radius)/cellSize); x++)
            for (let z = Math.floor((point.z-radius)/cellSize); z <= Math.floor((point.z+radius)/cellSize); z++)
                for (const triangle of cells.get(key(x,z)) ?? []) {
                    if (triangle.visited === query) continue;
                    triangle.visited = query;
                    if (!triangle.stairCandidate || Math.abs(triangle.y-supportY) > .36) continue;
                    const {a,b,c}=triangle;
                    const cross=(u:THREE.Vector3,v:THREE.Vector3)=>(v.x-u.x)*(point.z-u.z)-(v.z-u.z)*(point.x-u.x);
                    const ab=cross(a,b),bc=cross(b,c),ca=cross(c,a);
                    const inside=(ab>=-1e-7&&bc>=-1e-7&&ca>=-1e-7)||(ab<=1e-7&&bc<=1e-7&&ca<=1e-7);
                    const edge=(u:THREE.Vector3,v:THREE.Vector3)=>{
                        const dx=v.x-u.x,dz=v.z-u.z;
                        const t=THREE.MathUtils.clamp(((point.x-u.x)*dx+(point.z-u.z)*dz)/(dx*dx+dz*dz),0,1);
                        return Math.hypot(point.x-u.x-t*dx,point.z-u.z-t*dz);
                    };
                    const distance=inside?0:Math.min(edge(a,b),edge(b,c),edge(c,a));
                    if(triangle.authoredStair && distance<.12)return true;
                    if(distance<=radius)nearby.push({y:triangle.y,distance,direct:triangle.authoredStair});
                }
        if(nearby.some(t=>t.direct&&t.distance<.12))return true;
        const under=nearby.filter(t=>t.distance<.08).sort((a,b)=>Math.abs(a.y-supportY)-Math.abs(b.y-supportY))[0];
        return !!under && nearby.some(t=>Math.abs(t.y-under.y)>.06&&Math.abs(t.y-under.y)<.26);
    };
    return sample;
}
