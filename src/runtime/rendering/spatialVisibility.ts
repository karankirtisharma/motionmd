import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Object3D, Sphere, Vector3 } from 'three';

/** Index-only spatial partition. Positions, normals, UVs and material objects are shared unchanged. */
export function partitionStaticMesh(mesh:Mesh,cellSize=8):Mesh[] {
  const source=mesh.geometry,index=source.index,p=source.getAttribute('position');
  if(!index||!p||Array.isArray(mesh.material)||'isSkinnedMesh' in mesh||source.morphAttributes.position?.length||source.groups.length>1)return [];
  if(!source.boundingBox)source.computeBoundingBox();
  const bounds=source.boundingBox!,size=bounds.getSize(new Vector3());
  if(index.count<180000||Math.max(size.x,size.z)<cellSize*1.5)return [];
  const nx=Math.max(1,Math.ceil(size.x/cellSize)),ny=Math.max(1,Math.ceil(size.y/4)),nz=Math.max(1,Math.ceil(size.z/cellSize));
  const counts=new Uint32Array(nx*ny*nz),keys=new Uint16Array(index.count/3);
  if(counts.length>65535)return [];
  for(let t=0;t<keys.length;t++){
    const a=index.getX(t*3),b=index.getX(t*3+1),c=index.getX(t*3+2);
    const x=Math.min(nx-1,Math.max(0,Math.floor(((p.getX(a)+p.getX(b)+p.getX(c))/3-bounds.min.x)/cellSize)));
    const y=Math.min(ny-1,Math.max(0,Math.floor(((p.getY(a)+p.getY(b)+p.getY(c))/3-bounds.min.y)/4)));
    const z=Math.min(nz-1,Math.max(0,Math.floor(((p.getZ(a)+p.getZ(b)+p.getZ(c))/3-bounds.min.z)/cellSize)));
    const key=x+nx*(y+ny*z);keys[t]=key;counts[key]+=3;
  }
  if(counts.filter(n=>n>0).length<2)return [];
  const starts=new Uint32Array(counts.length),cursor=new Uint32Array(counts.length);let offset=0;
  for(let i=0;i<counts.length;i++){starts[i]=cursor[i]=offset;offset+=counts[i];}
  const ordered=index.array instanceof Uint16Array?new Uint16Array(index.count):new Uint32Array(index.count);
  const boxes=Array.from(counts,()=>new Box3()),point=new Vector3();
  for(let t=0;t<keys.length;t++){
    const key=keys[t];for(let v=0;v<3;v++){
      const original=index.getX(t*3+v);ordered[cursor[key]++]=original;
      boxes[key].expandByPoint(point.fromBufferAttribute(p,original));
    }
  }
  const cells:Mesh[]=[];
  for(let i=0;i<counts.length;i++){
    if(!counts[i])continue;
    const geometry=new BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
    geometry.setIndex(new BufferAttribute(ordered.subarray(starts[i],starts[i]+counts[i]),1));
    geometry.boundingBox=boxes[i];geometry.boundingSphere=boxes[i].getBoundingSphere(new Sphere());
    geometry.userData={...source.userData,spatialCell:true};
    const cell=new Mesh(geometry,mesh.material);cell.name=`${mesh.name} | cell ${i}`;
    cell.userData={...mesh.userData,spatialCell:true};cell.castShadow=mesh.castShadow;cell.receiveShadow=mesh.receiveShadow;cell.renderOrder=mesh.renderOrder;cell.layers.mask=mesh.layers.mask;
    cells.push(cell);
  }
  return cells;
}

export function partitionSourceGeometry(root:Object3D){
  const candidates:Mesh[]=[];root.traverse(o=>{if(o instanceof Mesh)candidates.push(o);});
  let sourceMeshes=0,cells=0,triangles=0;
  for(const mesh of candidates){
    if(!mesh.parent||mesh.children.length||mesh.userData.contextOnly||mesh.geometry.userData.contextOnly)continue;
    const parts=partitionStaticMesh(mesh);if(!parts.length)continue;
    const group=new Group();group.name=mesh.name;group.userData={...mesh.userData};
    group.position.copy(mesh.position);group.quaternion.copy(mesh.quaternion);group.scale.copy(mesh.scale);group.visible=mesh.visible;
    group.matrix.copy(mesh.matrix);group.matrixAutoUpdate=mesh.matrixAutoUpdate;group.layers.mask=mesh.layers.mask;
    group.add(...parts);mesh.parent.add(group);mesh.removeFromParent();
    sourceMeshes++;cells+=parts.length;triangles+=mesh.geometry.index!.count/3;
  }
  root.updateMatrixWorld(true);
  const report={sourceMeshes,cells,triangles,removedTriangles:0,attributesChanged:false};
  console.info('[MD spatial visibility]',report);return report;
}
