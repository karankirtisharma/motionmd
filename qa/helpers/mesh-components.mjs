import * as T from 'three';
export function meshComponents(mesh){
 const pos=mesh.geometry.attributes.position,ix=mesh.geometry.index,p=new T.Vector3(),ids=new Int32Array(pos.count),parents=[],keys=new Map();
 for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);const k=p.toArray().map(v=>Math.round(v*1e5)).join(',');let id=keys.get(k);if(id===undefined){id=parents.length;parents.push(id);keys.set(k,id)}ids[i]=id;}
 const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i};
 const count=ix?.count??pos.count,at=i=>ix?ix.getX(i):i;
 for(let i=0;i<count;i+=3){let a=find(ids[at(i)]);for(let j=1;j<3;j++){let b=find(ids[at(i+j)]);if(a!==b)parents[b]=a}}
 const groups=new Map();
 for(let i=0;i<count;i+=3){const id=find(ids[at(i)]);let c=groups.get(id);if(!c){c={box:new T.Box3(),points:[],triangles:[],offsets:[]};groups.set(id,c)}c.offsets.push(i);for(let j=0;j<3;j++){p.fromBufferAttribute(pos,at(i+j)).applyMatrix4(mesh.matrixWorld);c.box.expandByPoint(p);c.points.push(p.clone());c.triangles.push(at(i+j));}}
 return [...groups.values()];
}
