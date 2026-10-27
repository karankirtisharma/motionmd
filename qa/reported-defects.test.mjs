import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {geometryFixture} from './helpers/geometry-fixture.mjs';import {avatarFixture} from './helpers/avatar-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';import {createStairSurfaces} from '../src/runtime/interaction/StairSurfaces.ts';
import {repairExteriorWinding,repairExteriorOverlap} from '../src/runtime/rendering/exteriorSurfaces.ts';import {exteriorCollision} from '../src/runtime/interaction/exteriorCollision.ts';
const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
async function collision(){const root=new T.Group();for(const u of[manifest.collisions.url,...manifest.collisions.additionalUrls])root.add((await geometryFixture(u)).root);return root;}
test('all five omitted exterior slabs support actual feet instead of folding the legs',async t=>{
 const scene=(await geometryFixture('/assets/architecture-v19/shell.glb')).root;repairExteriorWinding(scene);repairExteriorOverlap(scene);
 const p=await createCollisionWorld(scene,undefined,await collision(),[],manifest.explorationBounds),sample=createStairSurfaces(scene),avatar=await avatarFixture();const report=[];
 try{for(const slab of exteriorCollision.filter(s=>!s.existingCollider)){
  const feet=new T.Vector3((slab.min[0]+slab.max[0])/2,slab.max[1],(slab.min[2]+slab.max[2])/2);if(slab.name==='west studio terrace')feet.x=-2.8; if(slab.name==='west lounge terrace')feet.x=.4; if(slab.name==='north return')feet.x=23.5; feet.y=p.groundAt(feet,1);p.place(feet);
  for(let frame=0;frame<180;frame++){p.move(new T.Vector3(0,-.5/60,0),1/60,feet);avatar.root.position.copy(feet);avatar.update(1/60,0,0,undefined,undefined,{sample});}
  assert.ok(Math.abs(feet.y-(slab.name==='south return'?-.01:slab.max[1]))<.003,`${slab.name}: body ${feet.y} vs floor ${slab.max[1]}`);
  assert.ok(Math.max(...avatar.locomotion.stairClearance)<.03,`${slab.name}: folded legs ${avatar.locomotion.stairClearance}`);
  report.push({name:slab.name,feetY:feet.y,clearance:avatar.locomotion.stairClearance});
 }t.diagnostic(JSON.stringify(report));}finally{avatar.dispose();p.dispose()}
});
test('impassable exterior ledge is not an IK foot target',()=>{
 const mat=new T.MeshBasicMaterial();mat.name='shell__EH54 | scanned cream limestone panels';const deck=new T.Mesh(new T.BoxGeometry(3,.34,3),mat);deck.position.y=-.18;
 const sample=createStairSurfaces(new T.Group().add(deck));assert.ok((sample(new T.Vector3(0,-.355,0),-.355)??-.355)<-.3);assert.ok(Math.abs(sample(new T.Vector3(0,-.01,0),-.01)+.01)<1e-6);
});
test('exterior winding repair preserves positions and UVs and is idempotent',async()=>{
 const {root}=await geometryFixture('/assets/architecture-v19/shell.glb');const originals=[];root.traverse(m=>{if(m.isMesh)originals.push({m,p:m.geometry.attributes.position.array.slice(),uv:m.geometry.attributes.uv?.array.slice()})});
 assert.equal(repairExteriorWinding(root),864);assert.equal(repairExteriorWinding(root),0);
 for(const {m,p,uv}of originals){assert.deepEqual(m.geometry.attributes.position.array,p);if(uv)assert.deepEqual(m.geometry.attributes.uv.array,uv)}
 root.traverse(m=>{if(!m.isMesh||m.material.name!=='shell__EH54 | scanned cream limestone panels')return;const p=m.geometry.attributes.position,ix=m.geometry.index;for(const s of exteriorCollision){let top=0;for(let i=0;i<ix.count;i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j)).applyMatrix4(m.matrixWorld));if(v.every(a=>Math.abs(a.y-s.max[1])<1e-5&&a.x>=s.min[0]-1e-5&&a.x<=s.max[0]+1e-5&&a.z>=s.min[2]-1e-5&&a.z<=s.max[2]+1e-5)){assert.ok(v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).y>0);top++;}}assert.ok(top>0,s.name)}});
});
test('lounge-chair side approaches leave clearance for hanging hands through all body headings',async t=>{
 const p=await createCollisionWorld(new T.Group(),undefined,await collision()),avatar=await avatarFixture(),point=new T.Vector3(),meshes=[];avatar.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});let checked=0;
 try{for(const c of manifest.chairs)for(let angle=0;angle<8;angle++){
  const dir=new T.Vector3(Math.sin(angle*Math.PI/4),0,Math.cos(angle*Math.PI/4)),feet=new T.Vector3(...c.position).addScaledVector(dir,1.4);feet.y=.032;if(!p.canStandAt(feet))continue;p.place(feet);
  for(let i=0;i<180;i++)p.move(dir.clone().multiplyScalar(-1.38/60).setY(-.5/60),1/60,feet);
  for(let yaw=0;yaw<4;yaw++) {avatar.root.position.copy(feet);avatar.root.rotation.y=yaw*Math.PI/2;for(let f=0;f<30;f++)avatar.update(1/60,0,0);avatar.root.updateMatrixWorld(true);
   for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,point).applyMatrix4(m.matrixWorld);if(point.y<.6||point.y>1.3)continue;let hit; p.world.intersectionsWithPoint(point,collider=>{const name=p.colliderNames.get(collider.handle)??'';if(/^PL78.*(?:shell|upholstered|backrest|arm pad|seat cushion)/.test(name)){hit=name;return false}return true});assert.equal(hit,undefined,`skin enters ${hit} at ${point.toArray()}, root ${feet.toArray()}`);}
  }checked++;
 }assert.ok(checked>=12);t.diagnostic(`${checked} clear source-chair approaches, four idle body headings each`);}finally{avatar.dispose();p.dispose()}
});

test('overlapping exterior slab tops render one surface without changing the exterior outline',async()=>{
 const {root}=await geometryFixture('/assets/architecture-v19/shell.glb');repairExteriorWinding(root);const box=new T.Box3().setFromObject(root);
 assert.ok(repairExteriorOverlap(root)>4);assert.equal(repairExteriorOverlap(root),0);assert.deepEqual(new T.Box3().setFromObject(root),box);
 const hits=new T.Raycaster(new T.Vector3(23,.1,-2),new T.Vector3(0,-1,0),0,.2).intersectObject(root,true);
 assert.equal(hits.filter(h=>Math.abs(h.point.y+.01)<.0001).length,1,'coplanar slab tops must not overlap');
});

test('every missing source glass pane blocks body and camera from both sides',async t=>{
 const {facadeCollision}=await import('../src/runtime/interaction/facadeCollision.ts');const p=await createCollisionWorld(new T.Group(),undefined,await collision());let approaches=0;
 try{for(const pane of facadeCollision){
  const min=new T.Vector3(...pane.min),max=new T.Vector3(...pane.max),center=min.clone().add(max).multiplyScalar(.5),size=max.clone().sub(min),axis=size.x<size.z?'x':'z';
  for(const sign of[-1,1]){
   const eye=center.clone();eye[axis]-=sign*.8;const behind=center.clone();behind[axis]+=sign*.8;
   assert.ok(p.cameraDistance(eye,behind)<.7,`${pane.name} camera crossing`);
   const feet=eye.clone();feet.y=min.y+.02;if(!p.canStandAt(feet))continue;p.place(feet);
   const d=new T.Vector3();d[axis]=sign*3.35/60;
   for(let i=0;i<80;i++)p.move(d,1/60,feet);
   assert.ok(sign*(feet[axis]-center[axis])<-.2,`${pane.name} body crossed`);approaches++;
  }
 }assert.ok(approaches>25);t.diagnostic(`${facadeCollision.length*2} camera sweeps, ${approaches} unobstructed sprint approaches`);
 }finally{p.dispose()}
});


test('curved founder club-chair shells protect the actual hanging hand skin',async t=>{
 const {clubCollision}=await import('../src/runtime/interaction/clubCollision.ts');
 const {default:R}=await import('@dimforge/rapier3d-compat');
 const p=await createCollisionWorld(new T.Group(),undefined,await collision()),avatar=await avatarFixture(),probe=new R.World({x:0,y:0,z:0});
 const point=new T.Vector3(),meshes=[];avatar.root.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)});
 for(const c of clubCollision)probe.createCollider(R.ColliderDesc.convexMesh(new Float32Array(c.vertices),new Uint32Array(c.indices)));probe.step();let checked=0;
 try{for(const c of clubCollision)for(let a=0;a<16;a++){
  const center=new T.Vector3().fromArray(c.min).add(new T.Vector3(...c.max)).multiplyScalar(.5),dir=new T.Vector3(Math.sin(a*Math.PI/8),0,Math.cos(a*Math.PI/8));
  const feet=center.clone().addScaledVector(dir,1.5);feet.y=4.265;if(!p.canStandAt(feet))continue;p.place(feet);
  for(let f=0;f<120;f++)p.move(dir.clone().multiplyScalar(-1.38/60).setY(-.5/60),1/60,feet);
  for(let yaw=0;yaw<4;yaw++){
   avatar.root.position.copy(feet);avatar.root.rotation.y=yaw*Math.PI/2;for(let f=0;f<30;f++)avatar.update(1/60,0,0);avatar.root.updateMatrixWorld(true);
   for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){
    m.getVertexPosition(i,point).applyMatrix4(m.matrixWorld);if(point.y<feet.y+.6||point.y>feet.y+1.3)continue;
    let inside=false;probe.intersectionsWithPoint(point,()=>{inside=true;return false});assert.equal(inside,false,`club shell skin penetration at ${point.toArray()}, feet ${feet.toArray()}`);
   }
  }checked++;
 }assert.ok(checked>=16);t.diagnostic(`${checked} club-chair approaches, four idle headings each`);
 }finally{probe.free();avatar.dispose();p.dispose()}
});
