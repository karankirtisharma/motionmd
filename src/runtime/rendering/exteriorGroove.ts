import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Vector3, type BufferAttribute, type InterleavedBufferAttribute } from 'three';

const TOP = -.01;
const LEFT = -.4879993200302124;
const RIGHT = 1.1880003213882446;
type Vertex = { id?: number; p: Vector3; values: Record<string, number[]> };

/** Remove the buried facing bevels at the measured internal L-terrace joint.
 * The outside corner bevels remain; the cut ends are closed with vertical faces. */
export function repairLoungeInternalGroove(g: BufferGeometry, world = new Matrix4()): BufferGeometry {
  const attrs = Object.entries(g.attributes) as [string, BufferAttribute | InterleavedBufferAttribute][];
  const out = Object.fromEntries(attrs.map(([name,a]) => [name,Array.from({length:a.count*a.itemSize},(_,i)=>a.getComponent(Math.floor(i/a.itemSize),i%a.itemSize))]));
  const indices: number[]=[];
  const inverse = world.clone().invert(), normalLocal = new Matrix3().getNormalMatrix(inverse);
  const vertex = (i: number): Vertex => ({ id:i, p: new Vector3().fromBufferAttribute(g.attributes.position, i).applyMatrix4(world), values: Object.fromEntries(attrs.map(([name,a]) => [name,Array.from({length:a.itemSize},(_,j)=>a.getComponent(i,j))])) });
  const clip = (poly: Vertex[], x: number, right: boolean) => {
    const result: Vertex[]=[];
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],da=a.p.x-x,db=b.p.x-x;
      const ka=right?da>=0:da<=0,kb=right?db>=0:db<=0;
      if(ka)result.push(a);
      if(ka!==kb){const t=da/(da-db);result.push({p:a.p.clone().lerp(b.p,t),values:Object.fromEntries(attrs.map(([name])=>[name,a.values[name].map((v,j)=>v+(b.values[name][j]-v)*t)]))});}
    }
    return result;
  };
  const emit = (poly: Vertex[], faceNormal=false) => {
    for(let i=1;i+1<poly.length;i++){
      const tri=[poly[0],poly[i],poly[i+1]];
      // Cuts may be distinct in double precision but collapse in the Float32 buffer.
      // Validate the encoded positions, not the intermediate clipping coordinates.
      const encoded=tri.map(v=>new Vector3().fromArray(v.values.position.map(Math.fround)).applyMatrix4(world));
      const normal=encoded[1].clone().sub(encoded[0]).cross(encoded[2].clone().sub(encoded[0]));
      if(normal.lengthSq()<1e-18)continue;
      normal.normalize().applyMatrix3(normalLocal).normalize();
      for(const v of tri){
        if(!faceNormal&&v.id!==undefined){indices.push(v.id);continue;}
        indices.push(out.position.length/3);
        for(const[name]of attrs)out[name].push(...(faceNormal&&name==='normal'?normal.toArray():v.values[name]));
      }
    }
  };
  const raised=(v:Vertex):Vertex=>{const p=v.p.clone();p.y=TOP;return {p,values:{...v.values,position:p.clone().applyMatrix4(inverse).toArray()}};};
  const count=g.index?.count??g.attributes.position.count;
  for(let i=0;i<count;i+=3){
    const tri=[0,1,2].map(j=>vertex(g.index?g.index.getX(i+j):i+j));
    const normal=tri[1].p.clone().sub(tri[0].p).cross(tri[2].p.clone().sub(tri[0].p));
    if(normal.y<=1e-12 || !tri.every(v=>v.p.z>=-8.81201&&v.p.z<=-8.78799&&v.p.y>=-.02201&&v.p.y<=-.00999)) {emit(tri);continue;}
    emit(clip(tri,LEFT,false));emit(clip(tri,RIGHT,true));
    const middle=clip(clip(tri,LEFT,true),RIGHT,false);
    emit(middle.map(raised),true);
    for(let j=0;j<middle.length;j++){
      const a=middle[j],b=middle[(j+1)%middle.length];
      if((Math.abs(a.p.x-LEFT)<1e-7&&Math.abs(b.p.x-LEFT)<1e-7)||(Math.abs(a.p.x-RIGHT)<1e-7&&Math.abs(b.p.x-RIGHT)<1e-7))emit([a,b,raised(b),raised(a)],true);
    }
  }
  const result=new BufferGeometry();for(const[name,a]of attrs)result.setAttribute(name,new Float32BufferAttribute(out[name],a.itemSize,a.normalized));
  result.setIndex(indices);
  result.userData={...g.userData,mdLoungeGroove:true};result.computeBoundingBox();result.computeBoundingSphere();return result;
}
