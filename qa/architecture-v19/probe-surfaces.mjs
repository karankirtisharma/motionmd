import fs from 'node:fs';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const manifest=JSON.parse(fs.readFileSync(process.env.SCENE_MANIFEST || 'public/assets/scene-manifest.json'));const root=new T.Group();
for(const chunk of manifest.chunks){if(!['entrance','gallery','shell','v13','v18','v19'].includes(chunk.id))continue;let b=fs.readFileSync('public'+chunk.url),len=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+len));delete j.images;delete j.textures;delete j.samplers;j.materials=j.materials.map(m=>({name:m.name,doubleSided:true}));let s=Buffer.from(JSON.stringify(j)),p=Buffer.alloc(Math.ceil(s.length/4)*4,32);s.copy(p);let h=Buffer.from(b.subarray(0,20));h.writeUInt32LE(20+p.length+b.length-20-len,8);h.writeUInt32LE(p.length,12);b=Buffer.concat([h,p,b.subarray(20+len)]);const scene=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene;scene.updateMatrixWorld(true);
scene.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position,idx=o.geometry.index,vs=[],a=new T.Vector3(),bb=new T.Vector3(),c=new T.Vector3();for(let i=0;i<(idx?.count??p.count);i+=3){a.fromBufferAttribute(p,idx?idx.getX(i):i).applyMatrix4(o.matrixWorld);bb.fromBufferAttribute(p,idx?idx.getX(i+1):i+1).applyMatrix4(o.matrixWorld);c.fromBufferAttribute(p,idx?idx.getX(i+2):i+2).applyMatrix4(o.matrixWorld);if(Math.min(a.x,bb.x,c.x)>11||Math.max(a.x,bb.x,c.x)<-2.3||Math.min(a.z,bb.z,c.z)>-10.7||Math.max(a.z,bb.z,c.z)<-25||Math.min(a.y,bb.y,c.y)>4.25||Math.max(a.y,bb.y,c.y)<3.35)continue;vs.push(...a,...bb,...c);}if(vs.length){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vs,3));const mesh=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.name=chunk.id+':'+o.material.name;root.add(mesh)}})}
root.updateMatrixWorld(true);const ray=new T.Raycaster(),rows=[],duplicates=[];
for(let x=5.85;x<10.95;x+=.15)for(let y=21.9;y<24.9;y+=.15){ray.set(new T.Vector3(x,4.3,-y),new T.Vector3(0,-1,0));ray.far=1;const hits=ray.intersectObject(root).filter(h=>Math.abs(h.face.normal.y)>.8);if(!hits.length)continue;const top=hits[0];if(hits[1]&&Math.abs(top.point.y-hits[1].point.y)<.006&&top.object.name!==hits[1].object.name)duplicates.push({x,y,hits:hits.slice(0,3).map(h=>({height:h.point.y,material:h.object.name}))});if(Math.abs(x-6.15)<.01||Math.abs(x-7.95)<.01)rows.push({x,y,height:top.point.y,material:top.object.name});}
// Distinguish a shared edge with a deliberate 5 mm level change from area overlap.
// The x=6 interface is hit by the regular grid; probe diagonally off the edge
// rather than labelling the two adjacent end faces as z-fighting.
const boundaryContacts=[];
// Probe the actual v19 founder join, including both sides of y=11.01.
// Offset the grid from mesh edges so duplicate-area checks are unambiguous.
const connection=[];
for(let x=.513;x<4.8;x+=.21)for(const y of [10.83,10.993,11.027,11.31,11.73,12.11]){
 ray.set(new T.Vector3(x,4.31,-y),new T.Vector3(0,-1,0));ray.far=.25;
 const hits=ray.intersectObject(root).filter(h=>Math.abs(h.face.normal.y)>.8);
 const top=hits[0];connection.push({x,y,height:top?.point.y??null,material:top?.object.name??null});
 if(!top||Math.abs(top.point.y-4.233)>.012)throw Error(`Missing/uneven founder join at ${x},${y}`);
 if(hits[1]&&Math.abs(top.point.y-hits[1].point.y)<.006&&top.object.name!==hits[1].object.name)duplicates.push({x,y,hits:hits.slice(0,3).map(h=>({height:h.point.y,material:h.object.name}))});
}
ray.far=1;
for(let i=duplicates.length-1;i>=0;i--){const q=duplicates[i];let area=false;
 for(const [dx,dy] of [[.00013,.00007],[-.00013,.00007],[.00013,-.00007],[-.00013,-.00007]]){
  ray.set(new T.Vector3(q.x+dx,4.3,-q.y-dy),new T.Vector3(0,-1,0));const hits=ray.intersectObject(root).filter(h=>Math.abs(h.face.normal.y)>.8);
  if(hits[1]&&Math.abs(hits[0].point.y-hits[1].point.y)<.006&&hits[0].object.name!==hits[1].object.name)area=true;
 }
 if(!area){boundaryContacts.push(q);duplicates.splice(i,1)}
}
fs.writeFileSync('qa/architecture-v19/web-surface-diagnosis.json',JSON.stringify({duplicates,boundaryContacts,rows,connection},null,2));
console.log(JSON.stringify({duplicateAreaSamples:duplicates.length,sharedBoundarySamples:boundaryContacts.length,examples:duplicates.slice(0,6),meshes:root.children.length}));if(duplicates.length)process.exitCode=1;
