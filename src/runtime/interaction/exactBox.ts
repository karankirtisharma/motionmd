import * as THREE from 'three';
/** Recognize a complete axis-aligned box, never fill an opening or a concavity. */
export function exactBox(vertices: Float32Array, indices: Uint32Array): THREE.Box3 | undefined {
  const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(vertices, 3));
  const size = bounds.getSize(new THREE.Vector3());
  if (Math.min(size.x,size.y,size.z) < 1e-5) return;
  const min=bounds.min.toArray(), max=bounds.max.toArray(), areas=new Float64Array(6);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3();
  // Every source vertex must be one of the eight corners. Bevels stay meshes.
  for(let i=0;i<vertices.length;i++) if(Math.min(Math.abs(vertices[i]-min[i%3]),Math.abs(vertices[i]-max[i%3]))>1e-6) return;
  for(let i=0;i<indices.length;i+=3){
    a.fromArray(vertices,indices[i]*3);b.fromArray(vertices,indices[i+1]*3);c.fromArray(vertices,indices[i+2]*3);
    let face=-1;
    for(let axis=0;axis<3;axis++) for(let side=0;side<2;side++) {
      const plane=side?max[axis]:min[axis];
      if([a,b,c].every(p=>Math.abs(p.getComponent(axis)-plane)<1e-6))face=axis*2+side;
    }
    if(face<0)return;
    areas[face]+=cross.subVectors(b,a).cross(c.clone().sub(a)).length()*.5;
  }
  const expected=[size.y*size.z,size.y*size.z,size.x*size.z,size.x*size.z,size.x*size.y,size.x*size.y];
  if(expected.some((area,i)=>Math.abs(area-areas[i])>Math.max(1e-7,area*1e-5)))return;
  return bounds;
}
