import fs from 'node:fs';
import * as T from 'three';
import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const avatar=await avatarFixture(), p=new T.Vector3();
const meshes=[];avatar.root.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
const report={poses:[]};
for (const speed of [0,1.38,3.35]) {
 const box=new T.Box3(), perMaterial={};
 for(let i=0;i<180;i++) {
  avatar.update(1/60,speed,0);avatar.root.updateMatrixWorld(true);
  for(const mesh of meshes) {
   const name=mesh.material.name;perMaterial[name]??=new T.Box3();
   for(let v=0;v<mesh.geometry.attributes.position.count;v++) {
    mesh.getVertexPosition(v,p).applyMatrix4(mesh.matrixWorld);box.expandByPoint(p);perMaterial[name].expandByPoint(p);
   }
  }
 }
 report.poses.push({speed,min:box.min.toArray(),max:box.max.toArray(),parts:Object.fromEntries(Object.entries(perMaterial).map(([name,b])=>[name,{min:b.min.toArray(),max:b.max.toArray()}]))});
}
avatar.dispose();
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const root=new T.Group();for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])root.add((await geometryFixture(url)).root);
const start=performance.now(),physics=await createCollisionWorld(root,undefined,root);
report.physics={meshes:physics.meshCount,triangles:physics.triangleCount,initMs:performance.now()-start};
report.colliders=[];root.traverse(o=>{if(o.isMesh){const b=new T.Box3().setFromObject(o);report.colliders.push({name:o.userData.sourceName??o.name,min:b.min.toArray(),max:b.max.toArray(),shape:o.userData.collisionShape??'trimesh'});}});
physics.dispose();
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
console.log(JSON.stringify({poses:report.poses,physics:report.physics},null,2));
