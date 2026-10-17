import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadGeometry } from './inspect-chair.mjs';
import { createWorkstation, WORKSTATION } from '../src/runtime/interaction/Workstation.ts';

test('swivel preserves chair triangles and UVs, turns on its spindle, and clears the desk', async context => {
  const scene=(await loadGeometry('public/assets/architecture-v21/founder.glb')).scene;
  let originalTriangles=0;const uvByMaterial=new Map();
  scene.traverse(o=>{if(o.isMesh&&/^founder__FC9[12] \|/.test(o.material.name)) {
    originalTriangles+=o.geometry.index.count/3;
    uvByMaterial.set(o.material, {uv:o.geometry.attributes.uv.array,uv1:o.geometry.attributes.uv1.array});
  }});
  const chair=createWorkstation(scene);
  assert.equal(chair.meshes.reduce((sum,m)=>sum+m.geometry.index.count/3,0),originalTriangles,'partition neither duplicates nor deletes triangles');
  for(const mesh of chair.meshes) {
    const uv=uvByMaterial.get(mesh.material);assert.deepEqual(mesh.geometry.attributes.uv.array,uv.uv);assert.deepEqual(mesh.geometry.attributes.uv1.array,uv.uv1);
  }
  const spindle=new THREE.Vector3(...WORKSTATION.sourceSpindle).applyMatrix4(chair.transform);
  assert.ok(chair.pivot.distanceTo(spindle)<1e-7,'uses the mechanical spindle, not the offset cushion centre');
  const pedestal=chair.pedestalMeshes.map(m=>m.matrixWorld.toArray());
  const p=new THREE.Vector3();let maxX=-Infinity,intersections=0;
  for(const angle of [-Math.PI/4,-Math.PI/8,0,Math.PI/8,Math.PI/4]) {
    chair.setSwivel(angle);
    chair.pedestalMeshes.forEach((m,i)=>assert.deepEqual(m.matrixWorld.toArray(),pedestal[i]));
    assert.ok(chair.swivel.getWorldPosition(p).distanceTo(spindle)<1e-7);
    for(const mesh of chair.meshes) for(const index of new Set(mesh.geometry.index.array)) {
      p.fromBufferAttribute(mesh.geometry.attributes.position,index).applyMatrix4(mesh.matrixWorld);
      maxX=Math.max(maxX,p.x);
      if(p.x>16.125&&p.x<17.275&&p.z>-6.85&&p.z<-3.75&&p.y>5.02&&p.y<5.058)intersections++;
    }
  }
  assert.equal(intersections,0,'swept chair does not enter the tabletop');
  context.diagnostic(JSON.stringify({originalTriangles,spindle:spindle.toArray(),maximumChairX:maxX,tabletopIntersections:intersections}));
  chair.meshes.forEach(m=>m.geometry.dispose());
});
