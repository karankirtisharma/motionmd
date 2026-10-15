import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaneGeometry,Mesh,MeshStandardMaterial,Vector3,Matrix3} from 'three';
import {installBrushTangents} from '../src/runtime/rendering/brushTangents.ts';
test('world brushed metal gets finite orthogonal tangents even with collapsed UVs',()=>{
 const geometry=new PlaneGeometry(2,3);geometry.attributes.uv.array.fill(0);
 const mesh=new Mesh(geometry,new MeshStandardMaterial());mesh.rotation.set(.3,.7,.2);mesh.scale.set(2,1,.7);
 installBrushTangents(mesh);
 const t=geometry.attributes.tangent,n=geometry.attributes.normal;
 const nm=new Matrix3().getNormalMatrix(mesh.matrixWorld),linear=new Matrix3().setFromMatrix4(mesh.matrixWorld);
 for(let i=0;i<t.count;i++){
  const tangent=new Vector3().fromBufferAttribute(t,i).applyMatrix3(linear).normalize();
  const normal=new Vector3().fromBufferAttribute(n,i).applyMatrix3(nm).normalize();
  assert.ok(Number.isFinite(tangent.length()) && Math.abs(tangent.length()-1)<1e-6);
  assert.ok(Math.abs(tangent.dot(normal))<1e-6);assert.equal(t.getW(i),1);
 }
 geometry.dispose();mesh.material.dispose();
});
