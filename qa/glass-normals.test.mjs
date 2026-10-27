import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { repairGlassNormals } from '../src/runtime/rendering/glassNormals.ts';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));

test('source low-iron guard repair preserves all faces and UVs while matching adjoining flat panes', async context => {
  const {root}=await geometryFixture(manifest.chunks.find(c=>c.id==='v13').url);
  const mesh=root.getObjectByName('WEB_v13_architecture_14'), source=mesh.geometry, material=mesh.material;
  const expected=source.toNonIndexed(), sourceNormals=Array.from(source.attributes.normal.array);
  const count=repairGlassNormals(mesh),g=mesh.geometry;
  assert.ok(count>700,'the exported shared normal defect must be detected');
  assert.equal(mesh.material,material,'keep tint, IOR, reflection roughness and transmission');
  assert.equal(g.attributes.position.count,source.index.count);
  for(const [name,attribute]of Object.entries(expected.attributes))if(name!=='normal') {
    assert.deepEqual(Array.from(g.getAttribute(name).array),Array.from(attribute.array),name+' must be unchanged in triangle order');
  }
  assert.deepEqual(Array.from(source.attributes.normal.array),sourceNormals,'source buffers remain immutable');
  let checked=0,oldBad=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),face=new T.Vector3(),v=new T.Vector3();
  for(let i=0;i<g.attributes.position.count;i+=3){
    const ps=[a,b,c];ps.forEach((p,j)=>p.fromBufferAttribute(g.attributes.position,i+j));
    if(!ps.every(p=>p.x>=5.3899&&p.x<=12.812&&p.y>=4.197&&p.y<=5.351&&p.z>=-10.992&&p.z<=-10.978))continue;
    face.subVectors(b,a).cross(v.subVectors(c,a));if(face.length()<.02)continue;face.normalize();if(Math.abs(face.z)<.999)continue;
    for(let j=0;j<3;j++){
      assert.ok(v.fromBufferAttribute(g.attributes.normal,i+j).dot(face)>.99999,'flat guard reflection normals must face the real pane');
      if(v.fromBufferAttribute(expected.attributes.normal,i+j).dot(face)<.99)oldBad++;
    }checked++;
  }
  assert.ok(checked>=12);assert.ok(oldBad>=12,'regression must exercise malformed central pane');
  assert.equal(repairGlassNormals(mesh),0);assert.equal(mesh.geometry,g,'repeat preparation must not recreate buffers');
  context.diagnostic(JSON.stringify({malformedBroadFaces:count,flatTrianglesChecked:checked,previousWrongFlatVertices:oldBad,finalVertices:g.attributes.position.count}));
});

test('all other shipping low-iron glass retains authored normals and curved replacement rail remains unchanged',async context=>{
  let unchanged=0,changed=0;
  for(const chunk of manifest.chunks){
    const {root}=await geometryFixture(chunk.url);
    root.traverse(mesh=>{
      if(!mesh.isMesh||Array.isArray(mesh.material)||!/(?:^|__)Low iron glass \| 12 mm$/.test(mesh.material.name))return;
      const before=mesh.geometry,count=repairGlassNormals(mesh);
      if(count){changed++;assert.equal(chunk.id,'v13');}
      else {unchanged++;assert.equal(mesh.geometry,before);}
    });
  }
  assert.equal(changed,1);assert.ok(unchanged>=8);
  context.diagnostic(JSON.stringify({changedMeshes:changed,unchangedMeshes:unchanged}));
});

// CPU broad-phase and GPU influence must agree at room/chunk boundaries.
import { probesForBounds, PROBE_INFLUENCE_MARGIN } from '../src/runtime/rendering/probes.ts';
test('adjacent chunks share every probe that influences their common glass seam',async()=>{
 const probes=manifest.reflectionProbes.map(p=>({id:p.id,region:new T.Box3(new T.Vector3(...p.bounds.min),new T.Vector3(...p.bounds.max))}));
 const lounge=probes.find(p=>p.id==='lounge'),founder=(await geometryFixture(manifest.chunks.find(c=>c.id==='founder').url)).root;
 const glass=founder.getObjectByName('Box_Founder_polished_floor002_7'),bounds=new T.Box3().setFromObject(glass);
 assert.equal(lounge.region.intersectsBox(bounds),false,'regression must exercise excluded founder boundary');
 assert.ok(probesForBounds(probes,bounds).includes(lounge));
 const margin=PROBE_INFLUENCE_MARGIN;
 for(const probe of probes)for(let axis=0;axis<3;axis++)for(const sign of[-1,1]){
   const p=probe.region.getCenter(new T.Vector3());p.setComponent(axis,(sign<0?probe.region.min:probe.region.max).getComponent(axis)+sign*(margin-.001));
   const a=new T.Box3(p.clone().addScalar(-.0001),p.clone().addScalar(.0001));
   assert.ok(probesForBounds([probe],a).includes(probe),'every fragment with nonzero shader weight must have its probe');
   p.setComponent(axis,p.getComponent(axis)+sign*.01);
   assert.equal(probesForBounds([probe],new T.Box3(p.clone(),p.clone())).length,0,'unaffected distant meshes retain culling');
 }
});

test('studio straight guard stays closed and keeps planar reflections across every join on both sides',async()=>{
 const {root}=await geometryFixture(manifest.chunks.find(c=>c.id==='v13').url),mesh=root.getObjectByName('WEB_v13_architecture_14');
 repairGlassNormals(mesh);root.updateMatrixWorld(true);const ray=new T.Raycaster();
 for(const x of[6.1,7.5,8.59,8.61,9.9,10.1,12,15,18.2])for(const sign of[-1,1])for(const y of[4.4,4.6]){
  ray.set(new T.Vector3(x,y,sign>0?-25.6:-24),new T.Vector3(0,0,sign));ray.far=1.5;
  const hits=ray.intersectObject(mesh);assert.equal(hits.length,2,'closed pane has both front and rear, not missing glass');
  assert.ok(hits[0].normal.clone().normalize().dot(new T.Vector3(0,0,-sign))>.99999,'flat panes share one reflected direction');
  assert.ok(hits[1].distance-hits[0].distance>=.0119&&hits[1].distance-hits[0].distance<=.0141,'retain source thickness');
 }
});
