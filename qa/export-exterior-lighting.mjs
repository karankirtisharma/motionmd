import fs from 'node:fs';
import * as T from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {meshComponents} from './helpers/mesh-components.mjs';
import {repairEntranceApron} from '../src/runtime/rendering/entranceApron.ts';
import {repairExteriorWinding,repairExteriorOverlap,repairExteriorGroove} from '../src/runtime/rendering/exteriorSurfaces.ts';
import {repairFounderExteriorWinding,exteriorReceiverSignature} from '../src/runtime/rendering/exteriorLighting.ts';
const work=process.argv[2];if(!work)throw Error('Expected external evidence directory');fs.mkdirSync(work,{recursive:true});
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json')),root=new T.Group();
for(const ch of manifest.chunks.filter(c=>['entrance','shell','founder','studio','lounge'].includes(c.id)))root.add((await geometryFixture(ch.url)).root);
repairExteriorWinding(root);repairExteriorOverlap(root);repairExteriorGroove(root);repairEntranceApron(root);repairFounderExteriorWinding(root);root.updateMatrixWorld(true);
const receivers=[];
root.traverse(m=>{
 if(!m.isMesh||!/EH54 \| scanned cream limestone panels$/.test(m.material.name))return;
 const components=meshComponents(m).filter(c=>{const s=c.box.getSize(new T.Vector3());return c.box.max.y<.2&&c.box.min.y>-.6&&s.y<.8&&s.x*s.z>1});
 if(!components.length)return;
 const triangleOffsets=components.flatMap(c=>c.offsets).sort((a,b)=>a-b),p=m.geometry.attributes.position,n=m.geometry.attributes.normal,ix=m.geometry.index;
 const positions=[],normals=[],normalMatrix=new T.Matrix3().getNormalMatrix(m.matrixWorld);
 for(const offset of triangleOffsets)for(let j=0;j<3;j++){
  const id=ix.getX(offset+j),v=new T.Vector3().fromBufferAttribute(p,id).applyMatrix4(m.matrixWorld),nv=new T.Vector3().fromBufferAttribute(n,id).applyMatrix3(normalMatrix).normalize();
  positions.push(v.x,-v.z,v.y);normals.push(nv.x,-nv.z,nv.y);
 }
 receivers.push({name:'Exterior baked | '+m.name,sourceMesh:m.name,material:m.material.name,triangleOffsets,signature:exteriorReceiverSignature(m,triangleOffsets),components:components.map(c=>({min:c.box.min.toArray(),max:c.box.max.toArray()})),positions,normals});
});
const indoor=root.getObjectByName('Box_Hall_rear_full-height_limestone001_11'),occluders=[];
if(indoor){const positions=[],p=indoor.geometry.attributes.position,ix=indoor.geometry.index;for(let i=0;i<(ix?.count??p.count);i++){const v=new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(indoor.matrixWorld);positions.push(v.x,-v.z,v.y)}occluders.push({name:'Retained indoor vestibule marble',material:'EH54 | polished warm-grey cloud marble',positions});}
fs.writeFileSync(work+'/receivers.json',JSON.stringify({receivers,occluders}));
console.log(receivers.map(({sourceMesh,triangleOffsets,components})=>({sourceMesh,triangles:triangleOffsets.length,components:components.length})));
