import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { geometryFixture } from './helpers/geometry-fixture.mjs';
import { exteriorCollision } from '../src/runtime/interaction/exteriorCollision.ts';
import { repairExteriorWinding, repairExteriorOverlap, repairExteriorGroove, exteriorCollisionGeometry, exteriorCollisionVertices } from '../src/runtime/rendering/exteriorSurfaces.ts';

test('all four terrace return joins have one aligned finish and one visible fascia', async () => {
  const {root} = await geometryFixture('/assets/architecture-v19/shell.glb');
  repairExteriorWinding(root);
  const before = new T.Raycaster(new T.Vector3(.5,.1,-2),new T.Vector3(0,-1,0),0,.2).intersectObject(root,true);
  assert.equal(before.length,2,'fixture must reproduce exact west/north depth conflict');
  assert.ok(repairExteriorOverlap(root)>4);
  for (const [x,z] of [[.137,-2.037],[.637,-2.073],[-2.137,-36.437],[-1.237,-36.331],[22.137,-36.437],[23.637,-36.331],[22.137,-2.037],[23.637,-2.073]]) {
    const hits = new T.Raycaster(new T.Vector3(x,.1,z),new T.Vector3(0,-1,0),0,.2).intersectObject(root,true);
    assert.equal(hits.length,1,`one top at ${x},${z}`);
    assert.ok(Math.abs(hits[0].point.y+.01)<1e-6,`flush finish at ${x},${z}`);
  }
  for (const z of [-36.437,-2.037]) {
    const hits = new T.Raycaster(new T.Vector3(24.8,-.15,z),new T.Vector3(-1,0,0),0,.3).intersectObject(root,true);
    assert.equal(hits.length,1,`one outer fascia at ${z}`);
  }
});

test('exterior join repair is idempotent and retains source attributes on untouched vertices', async () => {
  const {root} = await geometryFixture('/assets/architecture-v19/shell.glb');
  repairExteriorWinding(root);
  const mesh = root.getObjectByName(exteriorCollision[0].sourceMeshName);
  const before = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,a])=>[name,a.array.slice()]));
  const south = new Set(exteriorCollision.find(p=>p.name==='south return').sourceVertexIndices);
  const bounds = new T.Box3().setFromObject(root);
  repairExteriorOverlap(root);
  for (const [name,values] of Object.entries(before)) {
    const actual=mesh.geometry.attributes[name].array;
    for(let i=0;i<values.length;i++) {
      if(name==='position' && south.has(Math.floor(i/3)))continue;
      assert.equal(actual[i],values[i],`${name} source component ${i}`);
    }
  }
  assert.deepEqual(new T.Box3().setFromObject(root),bounds,'overall exterior outline is unchanged');
  const index=mesh.geometry.index.array.slice();
  assert.equal(repairExteriorOverlap(root),0);
  assert.deepEqual(mesh.geometry.index.array,index);
});

test('exterior collision source gets the same south-return height correction', () => {
  for (const p of exteriorCollision) {
    const actual=exteriorCollisionVertices(p), original=p.vertices;
    for(let i=0;i<actual.length;i++) {
      const west=exteriorCollision.find(p=>p.name==='west studio terrace');
      const expected=original[i]+(p.name==='south return'&&i%3===1 ? -.01-p.max[1] : p.name==='south return'&&i%3===0&&original[i]<=p.min[0]+.01201 ? west.min[0]-p.min[0] : 0);
      assert.ok(Math.abs(actual[i]-expected)<2e-6);
    }
    if(p.name==='south return')assert.ok(Math.abs(Math.max(...actual.filter((_,i)=>i%3===1))+.01)<1e-6);
  }
});


test('entrance apron changes only the outdoor marble projection and matches collision support', async () => {
  const {repairEntranceApron} = await import('../src/runtime/rendering/entranceApron.ts');
  const fs = await import('node:fs');
  const {root} = await geometryFixture('/assets/architecture-v19/entrance.glb');
  const sample = (r,x,z) => new T.Raycaster(new T.Vector3(x,.1,z),new T.Vector3(0,-1,0),0,.3).intersectObject(r,true)[0];
  const indoor=[[-1,-11],[2,-10]], original=indoor.map(([x,z])=>sample(root,x,z));
  assert.match(sample(root,-1,-10).object.material.name,/marble/);
  assert.equal(repairEntranceApron(root),1);root.updateMatrixWorld(true);
  const exterior=sample(root,-1,-10);
  assert.equal(exterior.object.name,'MD_EntranceExteriorApron');
  assert.match(exterior.object.material.name,/scanned cream limestone/);
  assert.ok(Math.abs(exterior.point.y+.01)<1e-6);
  for(let i=0;i<indoor.length;i++){
    const hit=sample(root,...indoor[i]);
    assert.equal(hit.object.material.name,original[i].object.material.name);
    assert.ok(hit.point.distanceTo(original[i].point)<1e-6);
    assert.ok(hit.uv.distanceTo(original[i].uv)<1e-6);
    assert.ok(hit.uv1.distanceTo(original[i].uv1)<1e-6);
  }
  assert.equal(repairEntranceApron(root),0);
  const manifest=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
  const collision=new T.Group();
  for(const url of[manifest.collisions.url,...manifest.collisions.additionalUrls])collision.add((await geometryFixture(url)).root);
  assert.equal(repairEntranceApron(collision),1);collision.updateMatrixWorld(true);
  assert.ok(Math.abs(sample(collision,-1,-10).point.y-exterior.point.y)<1e-6);
  const {createCollisionWorld}=await import('../src/runtime/interaction/CollisionWorld.ts');
  const physics=await createCollisionWorld(root,undefined,collision);
  try {
    const feet=new T.Vector3(-1,-.01,-10); physics.place(feet);
    for(let f=0;f<120;f++)physics.move(new T.Vector3(0,-.5/60,0),1/60,feet);
    assert.ok(Math.abs(feet.y+.01)<.003,`actual apron support ${feet.y}`);
  } finally {physics.dispose();}
});


test('internal lounge bevel groove is flush and southwest outer bevel has one surface', async()=>{
  const {root}=await geometryFixture('/assets/architecture-v19/shell.glb');
  repairExteriorWinding(root);repairExteriorOverlap(root);
  const mesh=root.getObjectByName(exteriorCollision[0].sourceMeshName),before=mesh.geometry.attributes.position.count;
  assert.equal(repairExteriorGroove(root),1);
  assert.ok(mesh.geometry.attributes.position.count-before<300,'repair retains indexed geometry rather than expanding the whole shell');
  const top=(r,x,z)=>new T.Raycaster(new T.Vector3(x,.08,z),new T.Vector3(0,-1,0),0,.15).intersectObject(r,true);
  const source=exteriorCollision.find(p=>p.name==='west lounge terrace'),fixed=exteriorCollisionGeometry(source);
  const physicsMesh=new T.Mesh(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(fixed.vertices,3)).setIndex(new T.BufferAttribute(fixed.indices,1)),new T.MeshBasicMaterial());
  for(const x of[-.4,0,1.1])for(const z of[-8.811,-8.805,-8.8005,-8.7995,-8.795,-8.789]){
    const hits=top(root,x,z);assert.equal(hits.length,1);assert.ok(Math.abs(hits[0].point.y+.01)<1e-6);
    const collision=top(physicsMesh,x,z);assert.equal(collision.length,1);assert.ok(Math.abs(collision[0].point.y-hits[0].point.y)<1e-6);
  }
  for(const z of[-36.54,-36.3,-36.2])assert.equal(top(root,-3.497,z).length,1,'aligned southwest outer edge must not expose overlapping bevels');
  for(const z of[-36.437,-36.3]){const hits=new T.Raycaster(new T.Vector3(-3.6,-.15,z),new T.Vector3(1,0,0),0,.2).intersectObject(root,true);assert.equal(hits.length,1,'corrected broadphase must remove duplicate southwest outer fascia');}
  for(const g of[mesh.geometry,physicsMesh.geometry]){
    const p=g.attributes.position,idx=g.index;
    for(let i=0;i<idx.count;i+=3){
      const [a,b,c]=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,idx.getX(i+j)));
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>1e-18,`encoded triangle ${i} must have nonzero area`);
    }
  }
  assert.equal(repairExteriorGroove(root),0);
});
