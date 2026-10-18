import { BufferGeometry, Float32BufferAttribute, Mesh, type BufferAttribute, type InterleavedBufferAttribute, type Object3D } from 'three';

/** Form a short stone transition at the studio entrance, retaining the room's
 * finished level and all existing UV interpolation. Only the 120 mm edge strip
 * slopes from 15 mm to 2.5 mm; furniture and the rest of the floor stay put. */
export function repairStudioThreshold(root: Object3D) {
  root.updateMatrixWorld(true);
  let repaired = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.geometry.userData.mdStudioThreshold) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    if (!list.some(m => m.name === 'studio__EH54 | polished warm-grey cloud marble') && object.userData.sourceName !== 'MF reference polished floor') return;
    const originalGeometry = object.geometry;
    const g = originalGeometry.clone().applyMatrix4(object.matrixWorld);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // Exact exported MF reference polished floor, not other stone furniture.
    if (Math.abs(box.min.y - .003) > .0001 || Math.abs(box.max.y - .015) > .0001 || Math.abs(box.max.z + 23.4) > .0001) { g.dispose(); return; }
    const cut = -23.52, edge = -23.4;
    const attrs = Object.entries(g.attributes) as [string, BufferAttribute | InterleavedBufferAttribute][];
    const output = Object.fromEntries(attrs.map(([name]) => [name, [] as number[]]));
    type Vertex = Record<string, number[]>;
    const vertex = (i: number): Vertex => Object.fromEntries(attrs.map(([name, a]) => [name, Array.from({length:a.itemSize}, (_, j) => a.getComponent(i,j))]));
    const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => Object.fromEntries(attrs.map(([name]) => [name, a[name].map((v,j) => v + (b[name][j]-v)*t)]));
    function clip(poly: Vertex[], positive: boolean) {
      const result: Vertex[] = [];
      for (let i=0;i<poly.length;i++) {
        const a=poly[i], b=poly[(i+1)%poly.length];
        const da=a.position[2]-cut, db=b.position[2]-cut;
        const inside=positive ? da>=0 : da<=0, next=positive ? db>=0 : db<=0;
        if (inside) result.push(a);
        if (inside!==next) result.push(interpolate(a,b,da/(da-db)));
      }
      return result;
    }
    const count=g.index?.count ?? g.attributes.position.count;
    for(let i=0;i<count;i+=3) {
      const tri=[0,1,2].map(j=>vertex(g.index ? g.index.getX(i+j) : i+j));
      const zs=tri.map(v=>v.position[2]);
      const polys=Math.min(...zs)<cut && Math.max(...zs)>cut ? [clip(tri,false),clip(tri,true)] : [tri];
      for(const poly of polys) for(let j=1;j+1<poly.length;j++) {
        for(const original of [poly[0],poly[j],poly[j+1]]) {
          const v=Object.fromEntries(Object.entries(original).map(([k,a])=>[k,[...a]]));
          if(v.position[2]>cut) {
            const t=Math.min(1,(v.position[2]-cut)/(edge-cut));
            v.position[1]-=.0125*t;
            if(Math.abs(v.normal?.[1] ?? 0)>.99) {
              const sign=Math.sign(v.normal[1]), length=Math.hypot(1,.0125/.12);
              v.normal=[0,sign/length,sign*(.0125/.12)/length];
            }
          }
          for(const [name] of attrs) output[name].push(...v[name]);
        }
      }
    }
    const result=new BufferGeometry();
    for(const [name,a] of attrs) result.setAttribute(name,new Float32BufferAttribute(output[name],a.itemSize));
    result.userData={...g.userData,mdStudioThreshold:true};
    result.applyMatrix4(object.matrixWorld.clone().invert());
    result.computeBoundingBox();result.computeBoundingSphere();
    object.geometry=result;g.dispose();originalGeometry.dispose();repaired++;
  });
  return repaired;
}
