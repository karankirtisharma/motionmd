import * as THREE from 'three';

/** Interpolate the authored front surface in UV space. Nearest-vertex sampling
 * cannot find interior points on this model: all its vertices are on top/bottom. */
export function sampleScreenSurface(meshes:THREE.Mesh[],u:number,v:number,front:THREE.Vector3):THREE.Vector3 {
  const result=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),candidate=new THREE.Vector3();let depth=-Infinity;
  for(const mesh of meshes) {
    mesh.updateWorldMatrix(true,false);
    const position=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv'),index=mesh.geometry.index;
    if(!position||!uv)continue;
    const count=index?.count??position.count;
    for(let i=0;i<count;i+=3) {
      const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
      const ax=uv.getX(ia),ay=uv.getY(ia),bx=uv.getX(ib),by=uv.getY(ib),cx=uv.getX(ic),cy=uv.getY(ic);
      const determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(determinant)<1e-12)continue;
      const wa=((by-cy)*(u-cx)+(cx-bx)*(v-cy))/determinant;
      const wb=((cy-ay)*(u-cx)+(ax-cx)*(v-cy))/determinant,wc=1-wa-wb;
      if(Math.min(wa,wb,wc)<-1e-5)continue;
      a.fromBufferAttribute(position,ia);b.fromBufferAttribute(position,ib);c.fromBufferAttribute(position,ic);
      candidate.copy(a).multiplyScalar(wa).addScaledVector(b,wb).addScaledVector(c,wc).applyMatrix4(mesh.matrixWorld);
      const d=candidate.dot(front);if(d>depth){depth=d;result.copy(candidate);}
    }
  }
  if(!Number.isFinite(depth))throw new Error(`Presentation surface has no UV triangle at ${u},${v}.`);
  return result;
}

export function curvedScreenPatches(meshes:THREE.Mesh[],front:THREE.Vector3,count=32) {
  const tops=Array.from({length:count+1},(_,i)=>sampleScreenSurface(meshes,i/count,0,front));
  const bottoms=Array.from({length:count+1},(_,i)=>sampleScreenSurface(meshes,i/count,1,front));
  return Array.from({length:count},(_,i)=>{
    const corners=[tops[i],tops[i+1],bottoms[i+1],bottoms[i]];
    const normal=new THREE.Vector3().subVectors(corners[1],corners[0]).cross(new THREE.Vector3().subVectors(corners[3],corners[0])).negate().normalize();
    const center=corners.reduce((sum,p)=>sum.addScaledVector(p,.25),new THREE.Vector3());
    return{corners,normal,center,u:i/count,width:1/count};
  });
}
