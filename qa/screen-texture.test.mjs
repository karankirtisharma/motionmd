import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Raycaster, Scene, Vector3,
  WebGLCoordinateSystem, WebGPUCoordinateSystem,
} from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { sampleScreenSurface } from '../src/runtime/presentation/curvedSurface.ts';
import { installFlatPanel } from '../src/runtime/presentation/flatPanel.ts';
import { createScreenAperture } from '../src/runtime/presentation/screenTexture.ts';
import { mapScreenPoint, projectScreenPlane } from '../src/runtime/presentation/projection.ts';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

const source = await geometryFixture('/assets/architecture-v16/lounge.glb');
const meshes = [];
source.root.traverse(mesh => {
  if (mesh.isMesh && (mesh.userData.sourceName ?? mesh.name) === 'PL78 | curved LED pixel surface') meshes.push(mesh);
});
assert.equal(meshes.length, 1);

test('the shipping aperture, native UVs, depth face and returns share the same measured geometry', () => {
  const original = meshes[0].geometry, positions = original.attributes.position.array.slice();
  const before = sampleScreenSurface(meshes, .5, .5, new Vector3(0,0,1));
  const panel = installFlatPanel(meshes);
  try {
    const center = panel.point(.5,.5), plane = new Plane().setFromNormalAndCoplanarPoint(panel.normal, center);
    assert.ok(center.z-before.z > .713 && center.z-before.z < .715, 'the front face spans the original 714mm bow');
    const pos = panel.face.geometry.attributes.position;
    assert.equal(pos.count, 4);
    assert.equal(panel.face.userData.nativeStudioFace, true);
    for(let i=0;i<4;i++) {
      const p = new Vector3().fromBufferAttribute(pos,i).applyMatrix4(panel.face.matrixWorld);
      assert.ok(Math.abs(plane.distanceToPoint(p)) < .000003);
      assert.ok(p.distanceTo(panel.corners[i]) < .000003);
    }
    assert.ok(panel.collision.indices.length>6);
    assert.ok(Math.min(...panel.collision.vertices.filter((_,i)=>i%3===2)) < center.z-.71);
    for(const u of [.01,.25,.5,.75,.99]) for(const v of [.02,.5,.98]) {
      const p=panel.point(u,v), ray=new Raycaster(p.clone().addScaledVector(panel.normal,.35),panel.normal.clone().negate());
      const hit=ray.intersectObject(panel.face,false)[0]; assert.ok(hit);
      assert.ok(Math.abs(hit.uv.x-u)<1e-6 && Math.abs(hit.uv.y-v)<1e-6);
    }
  } finally { panel.dispose(); panel.dispose(); }
  assert.equal(meshes[0].geometry,original);
  assert.deepEqual(original.attributes.position.array,positions);
  assert.equal(meshes[0].userData.nativeStudioFace,undefined);
});

test('the continuous physical bezel clears the authored corners and leaves the full native screen open', () => {
  const panel=installFlatPanel(meshes);
  const housing=panel.face.children.find(child=>child.name.includes('mitered bezel'));
  assert.ok(housing?.isMesh && !Array.isArray(housing.material) && housing.geometry.groups.length===0);
  panel.face.updateWorldMatrix(true,true);
  const across=panel.corners[1].clone().sub(panel.corners[0]).normalize();
  const down=panel.corners[3].clone().sub(panel.corners[0]).normalize();
  const siblings=[];
  source.root.traverse(node=>{ if (node.isMesh && node.material.name.includes('satin architectural bronze')) siblings.push(node); });
  assert.ok(siblings.length>0);
  function ray(p) { return new Raycaster(p.clone().addScaledVector(panel.normal,.22),panel.normal.clone().negate()); }
  let releasedGeometry=0, releasedFinish=0;
  housing.geometry.addEventListener('dispose',()=>releasedGeometry++);
  housing.material.addEventListener('dispose',()=>releasedFinish++);
  try {
    for (const t of [0,.02,.5,.98,1]) {
      for (const [u,v,out] of [[t,0,down.clone().negate()],[t,1,down],[0,t,across.clone().negate()],[1,t,across]]) {
        const p=panel.point(u,v).addScaledVector(out,.023);
        const hit=ray(p).intersectObject(housing,false)[0]; assert.ok(hit,'crown continuous on every rail');
        assert.ok(Math.abs(hit.point.clone().sub(p).dot(panel.normal)-.060)<.0001);
      }
    }
    for (let i=0;i<4;i++) {
      const p=panel.corners[i].clone().addScaledVector(across,(i===0 || i===3 ? -1 : 1)*.032)
        .addScaledVector(down,(i<2 ? -1 : 1)*.032);
      const r=ray(p), cap=r.intersectObject(housing,false)[0], old=r.intersectObjects(siblings,false)[0];
      assert.ok(cap && old && old.distance-cap.distance>.004,'each outer miter sits above the old bronze');
    }
    for (const u of [.0001,.5,.9999]) for (const v of [.0001,.5,.9999]) {
      const r=ray(panel.point(u,v));
      assert.equal(r.intersectObject(housing,false).length,0,'no flange protrudes into the native aperture');
      assert.ok(r.intersectObject(panel.face,false)[0].uv.distanceTo({x:u,y:v})<1e-6);
    }
  } finally { panel.dispose(); panel.dispose(); }
  assert.equal(releasedGeometry,1); assert.equal(releasedFinish,1); assert.equal(housing.parent,null);
});

test('near and oblique iframe corners/interior stay registered to the actual flat face on both backends', () => {
  const panel=installFlatPanel(meshes);
  const poses=[
    [[11.6,1.7,-5],[11.6,1.95,-9.615]],
    [[11.6,2.5,-9.28],[13.0,1.5,-9.615]],
    [[14,1.7,-9.14],[10,2.8,-9.615]],
  ];
  try {
    let checks=0,partial=0,mixedW=0;
    for(const api of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for(const reversed of [false,true]) for(const [pos,target] of poses) {
      const camera=new PerspectiveCamera(63,16/9,.05,100);
      camera.coordinateSystem=api; camera._reversedDepth=reversed; camera.updateProjectionMatrix();
      camera.position.fromArray(pos);camera.lookAt(...target);camera.updateMatrixWorld();
      const p=projectScreenPlane(panel.corners,camera,1920,1080,1600,558);assert.ok(p.visible);
      const m=p.matrix, ws=panel.corners.map((_,i)=>m[15]+m[3]*([0,1600,1600,0][i])+m[7]*([0,0,558,558][i]));
      if(Math.min(...ws)<0 && Math.max(...ws)>0) mixedW++;
      for(const u of [0,.13,.5,.94,1]) for(const v of [0,.37,1]) {
        const q=panel.point(u,v).project(camera), r=mapScreenPoint(m,u*1600,v*558);
        assert.ok(Math.hypot((q.x+1)*960-r.x,(1-q.y)*540-r.y)<1e-5);checks++;
      }
      if(p.clipPolygon) {
        partial++;
        for(const match of p.clipPolygon.matchAll(/([-\d.]+)px ([-\d.]+)px/g)) {
          const x=Number(match[1]),y=Number(match[2]),q=mapScreenPoint(m,x,y);
          assert.ok(m[15]+m[3]*x+m[7]*y>.049);
          assert.ok(q.x>-.1 && q.x<1920.1 && q.y>-.1 && q.y<1080.1);
        }
      }
    }
    assert.equal(checks,180); assert.ok(mixedW>0 && partial>0);
  } finally {panel.dispose();}
});

test('the camera and standing/sprinting capsule cannot enter the fitted front display', async () => {
  const panel=installFlatPanel(meshes), root=new Group();
  const floor=new Mesh(new BoxGeometry(30,.2,30),new MeshBasicMaterial());floor.position.set(11.6,-.1,-9);root.add(floor);
  const physics=await createCollisionWorld(new Scene(),undefined,root);
  try {
    const center=panel.point(.5,.5), a=center.clone().addScaledVector(panel.normal,.8), behind=center.clone().addScaledVector(panel.normal,-.6);
    assert.equal(physics.hasLineOfSight(a,behind,.01),true,'test fixture starts without a hidden barrier');
    physics.configurePresentationPanel(panel.collision.vertices,panel.collision.indices);
    assert.equal(physics.hasLineOfSight(a,center,.08),true,'surface itself must remain interactive');
    assert.equal(physics.hasLineOfSight(a,behind,.01),false);
    const distance=physics.cameraDistance(a,behind,.19);assert.ok(distance>.55 && distance<.63, 'camera sphere stops in front of the physical glass');
    const feet=center.clone().setY(0).addScaledVector(panel.normal,1.1);
    physics.place(feet);
    for(let i=0;i<90;i++) physics.move(new Vector3(-panel.normal.x*.06,-.02,-panel.normal.z*.06),1/60,feet);
    // At capsule height the lower rail is the first real contact surface.
    const rail=panel.point(.5,1);rail.y-=.023;
    const probe=new Raycaster(rail.clone().addScaledVector(panel.normal,.2),panel.normal.clone().negate());
    panel.face.updateWorldMatrix(true,true);
    const contact=probe.intersectObject(panel.face,true)[0].point;
    const separation=feet.clone().sub(contact).dot(panel.normal);
    assert.ok(separation>.24 && separation<.42, 'actual body can touch the physical frame without crossing it: '+separation);
    const count=physics.meshCount;physics.configurePresentationPanel(panel.collision.vertices,panel.collision.indices);assert.equal(physics.meshCount,count);
  } finally {physics.dispose();panel.dispose();floor.geometry.dispose();floor.material.dispose();}
});

test('wood remains visible at startup and in reflections; only the ready native page opens the main-camera depth aperture', async () => {
  const original=new MeshBasicMaterial(), mesh=new Mesh(undefined,original), main=new PerspectiveCamera(), mirror=new PerspectiveCamera();
  const before=mesh.onBeforeRender, screen=createScreenAperture(mesh,main), mat=mesh.material, boot=mat.map;
  assert.notEqual(mat,original);
  assert.equal(mat.depthWrite,true);assert.equal(mat.depthTest,true);assert.equal(boot.flipY,false);
  mesh.onBeforeRender(undefined,undefined,main,mesh.geometry,mat,undefined);assert.equal(mat.opacity,1);
  assert.equal(screen.takeDirty(),true);assert.equal(screen.takeDirty(),false);
  screen.setLive(true);assert.equal(screen.takeDirty(),true);
  mesh.onBeforeRender(undefined,undefined,main,mesh.geometry,mat,undefined);assert.equal(mat.opacity,0);assert.equal(mat.color.getHex(),0);
  mesh.onBeforeRender(undefined,undefined,mirror,mesh.geometry,mat,undefined);assert.equal(mat.opacity,1);assert.equal(mat.color.getHex(),0xffffff);
  screen.setLive(false);mesh.onBeforeRender(undefined,undefined,main,mesh.geometry,mat,undefined);assert.equal(mat.opacity,1);
  const plate=sharp(fileURLToPath(new URL('../public/studio/media/plate/wall-ledge-marble.jpg',import.meta.url)));
  const {width,height}=await plate.metadata(),scale=Math.max(1600/width,558*1.38/height),w=Math.round(1600/scale),h=Math.round(558/scale);
  const ref=await plate.extract({left:Math.round((width-w)/2),top:0,width:w,height:h}).resize(boot.image.width,boot.image.height,{fit:'fill'}).removeAlpha().raw().toBuffer();
  let diff=0;for(let i=0;i<ref.length;i++)diff+=Math.abs(ref[i]-boot.image.data[Math.floor(i/3)*4+i%3]);
  assert.ok(diff/ref.length<4);
  let releases=0;boot.addEventListener('dispose',()=>releases++);screen.dispose();screen.dispose();
  assert.equal(releases,1);assert.equal(mesh.onBeforeRender,before);assert.equal(mesh.material,original);
  screen.setLive(true);assert.equal(screen.takeDirty(),false);
});
