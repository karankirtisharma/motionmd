// Offline third-person camera audit. For every place a visitor can stand, orbit the follow camera and
// measure, against the RENDERED opaque geometry, how much of the body the collision-corrected camera sees.
//   node qa/camera-view-audit.mjs            (prints a summary; CAMERA_AUDIT_JSON=path writes every bad sample)
import fs from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {geometryFixture} from './helpers/geometry-fixture.mjs';
import {createCollisionWorld} from '../src/runtime/interaction/CollisionWorld.ts';
const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json',import.meta.url)));
const scene=new THREE.Scene(),colliders=new THREE.Group();
for(const chunk of manifest.chunks)scene.add((await geometryFixture(chunk.url)).root);
for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls])colliders.add((await geometryFixture(url)).root);
const physics=await createCollisionWorld(scene,undefined,colliders,[],manifest.explorationBounds);
// The rendered building as a second, ray-only world: Rapier's trimesh BVH stands in for a renderer.
const visual=new RAPIER.World({x:0,y:0,z:0}),names=new Map(),point=new THREE.Vector3();
let triangles=0;
scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.name??'');
  if(materials.some(name=>/glass|glaz|water|acrylic|transluc|sheer|curtain|light beam|glow|haze/i.test(name)))return;
  const position=mesh.geometry.attributes.position,vertices=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);vertices.set([point.x,point.y,point.z],i*3);}
  const index=mesh.geometry.index,indices=new Uint32Array(index?.count??position.count);
  for(let i=0;i<indices.length;i++)indices[i]=index?index.getX(i):i;
  if(indices.length<3)return;
  const collider=visual.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices));
  names.set(collider.handle,`${mesh.userData.sourceName??mesh.name} / ${materials[0]}`);triangles+=indices.length/3;
});
visual.step();
const PROTO=process.env.CAMERA_OCCLUDER_AREA?Number(process.env.CAMERA_OCCLUDER_AREA):0,MESH_RULE=process.env.CAMERA_OCCLUDER_MODE==='mesh';
const proto=new RAPIER.World({x:0,y:0,z:0});let protoTriangles=0,protoScanned=0;
if(PROTO){const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  for(let p=mesh;p;p=p.parent)if(/founder-lift/.test(p.name)||p.userData.liftRole)return;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.name??'');
  if(materials.some(name=>/glass|glaz|water|acrylic|transluc|sheer|curtain|light beam|glow|haze/i.test(name)))return;
  const position=mesh.geometry.attributes.position,index=mesh.geometry.index,n=(index?.count??position.count)/3,keep=[];
  if(process.env.CAMERA_OCCLUDER_CAP&&n>Number(process.env.CAMERA_OCCLUDER_CAP))return;protoScanned+=n;let total=0;const areas=new Float32Array(n);
  const world=new Float32Array(position.count*3);for(let i=0;i<position.count;i++){a.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);world.set([a.x,a.y,a.z],i*3);}
  for(let i=0;i<n;i++){const ia=index?index.getX(i*3):i*3,ib=index?index.getX(i*3+1):i*3+1,ic=index?index.getX(i*3+2):i*3+2;a.fromArray(world,ia*3);b.fromArray(world,ib*3);c.fromArray(world,ic*3);areas[i]=b.sub(a).cross(c.sub(a)).length()/2;total+=areas[i];if(areas[i]>=PROTO)keep.push(ia,ib,ic);}
  const indices=MESH_RULE?(total/n>=PROTO?Uint32Array.from({length:n*3},(_,i)=>index?index.getX(i):i):new Uint32Array(0)):new Uint32Array(keep);
  if(indices.length<3)return;proto.createCollider(RAPIER.ColliderDesc.trimesh(world,indices));protoTriangles+=indices.length/3;});proto.step();}
const protoBall=new RAPIER.Ball(.19),unit={x:0,y:0,z:0,w:1};
const protoDistance=(pivot,direction,length)=>{if(!PROTO)return length;const sweep=proto.castShape(pivot,unit,direction,protoBall,.01,length,false),ray=proto.castRay(new RAPIER.Ray(pivot,direction),length,false);return Math.max(0,Math.min(length,sweep?sweep.time_of_impact-.01:length,ray?ray.timeOfImpact-.19:length));};
const sees=(from,to)=>{const d=to.clone().sub(from),reach=d.length();if(reach<.25)return undefined;d.multiplyScalar(1/reach);return visual.castRay(new RAPIER.Ray(from,d),reach-.2,false);};
// Standing places: a grid over the exploration bounds on both storeys.
const {minX,maxX,minZ,maxZ}=manifest.explorationBounds,places=[],seen=new Set();
const STEP=Number(process.env.CAMERA_AUDIT_STEP??.7);
for(let x=minX+.35;x<maxX;x+=STEP)for(let z=minZ+.35;z<maxZ;z+=STEP)for(const seed of [.4,4.7]){
  const feet=new THREE.Vector3(x,seed,z);feet.y=physics.groundAt(feet,3.2);
  // groundAt returns its input height when nothing is underfoot.
  if(!Number.isFinite(feet.y)||Math.abs(feet.y-seed)<1e-6||!physics.canStandAt(feet))continue;
  const key=`${x.toFixed(2)},${z.toFixed(2)},${Math.round(feet.y*4)}`;if(seen.has(key))continue;seen.add(key);
  // Indoors only: something opaque overhead within 12 m.
  if(!visual.castRay(new RAPIER.Ray({x,y:feet.y+1.9,z},{x:0,y:1,z:0}),12,false))continue;
  places.push(feet);
}
const pivot=new THREE.Vector3(),desired=new THREE.Vector3(),camera=new THREE.Vector3(),body=[0,1,2,3,4].map(()=>new THREE.Vector3());
const YAWS=12,PITCHES=[.16,.55,.95],FOLLOW=2.45,bad=[],occluders=new Map();
let samples=0,hidden=0,collapsed=0,boomSum=0,renderOnly=0,throughRender=0,short=0,collapsedInsideWall=0;
const started=performance.now();
for(const feet of places){
  pivot.copy(feet).setY(feet.y+1.35);
  for(const pitch of PITCHES)for(let step=0;step<YAWS;step++){
    const yaw=step/YAWS*Math.PI*2;
    desired.set(Math.sin(yaw)*Math.cos(pitch)*FOLLOW,Math.sin(pitch)*FOLLOW+.1,Math.cos(yaw)*Math.cos(pitch)*FOLLOW).add(pivot);
    // The same body points the controller passes (shins, hips, head) plus chest and shoulders across the view.
    const side=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    body[0].copy(feet).setY(feet.y+.3);body[1].copy(feet).setY(feet.y+.95);body[2].copy(feet).setY(feet.y+1.62);
    body[3].copy(feet).setY(feet.y+1.38).addScaledVector(side,.2);body[4].copy(feet).setY(feet.y+1.38).addScaledVector(side,-.2);
    let boom=physics.cameraDistance(pivot,desired,undefined,!process.env.CAMERA_AUDIT_PLAIN);
    const aim=camera.copy(desired).sub(pivot).normalize().clone(),limited=protoDistance(pivot,aim,boom);
    camera.copy(aim).multiplyScalar(limited).add(pivot);
    let visible=0,first,known=0;
    for(const target of body){const hit=sees(camera,target);if(!hit)visible++;else{first??=names.get(hit.collider.handle);if(!physics.hasLineOfSight(camera,target,.2))known++;}}
    boom=limited;samples++;boomSum+=boom;if(boom<1.2)short++;
    const isHidden=visible<=2,isCollapsed=boom<.5;
    if(isHidden)hidden++;if(isCollapsed)collapsed++;
    if(isCollapsed&&PROTO&&proto.intersectionWithShape(pivot,unit,protoBall))collapsedInsideWall++;
    // Hidden by geometry the collision world does not contain, or with the camera itself behind such geometry.
    const noCollider=isHidden&&known<body.length-visible,through=isHidden&&!!sees(pivot,camera);
    if(noCollider)renderOnly++;if(through)throughRender++;
    if(isHidden&&first)occluders.set(first,(occluders.get(first)??0)+1);
    if(isHidden||isCollapsed)bad.push({feet:feet.toArray().map(v=>+v.toFixed(2)),yaw:+yaw.toFixed(2),pitch,boom:+boom.toFixed(2),visible,occluder:first,noCollider,through});
  }
}
const top=[...occluders].sort((a,b)=>b[1]-a[1]).slice(0,14);
console.log(JSON.stringify({places:places.length,samples,visualTriangles:triangles,hidden,hiddenPercent:+(hidden/samples*100).toFixed(2),hiddenByUncollidedGeometry:renderOnly,cameraBehindRenderGeometry:throughRender,occluderTriangles:protoTriangles,scanned:protoScanned,shortBoomPercent:+(short/samples*100).toFixed(2),collapsedWithChestInsideDrawnSurface:collapsedInsideWall,collapsed,collapsedPercent:+(collapsed/samples*100).toFixed(2),meanBoom:+(boomSum/samples).toFixed(3),seconds:+((performance.now()-started)/1000).toFixed(1)},null,1));
console.log('hidden by pitch',PITCHES.map(p=>`${p}: ${bad.filter(b=>b.pitch===p&&b.visible<=2).length}`).join('  '));
console.log('top occluders\n'+top.map(([name,count])=>`  ${String(count).padStart(5)}  ${name}`).join('\n'));
if(process.env.CAMERA_AUDIT_JSON)fs.writeFileSync(process.env.CAMERA_AUDIT_JSON,JSON.stringify(bad));
physics.dispose();visual.free();
