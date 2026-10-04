import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Vector3 } from 'three';
import { architecturalShadowBounds, fitSunShadow } from '../src/runtime/rendering/shadowBounds.ts';
import { partitionStaticMesh, partitionSourceGeometry } from '../src/runtime/rendering/spatialVisibility.ts';

test('spatial cells preserve every triangle, vertex attribute, material and world transform', () => {
  const geometry=new PlaneGeometry(32,32,256,256).rotateX(-Math.PI/2);
  const sourceIndices=Array.from(geometry.index.array);
  const mesh=new Mesh(geometry,new MeshStandardMaterial());
  mesh.position.set(7,2,-4);mesh.rotation.y=.6;mesh.scale.set(1.3,1,1.2);
  const parts=partitionStaticMesh(mesh);
  assert.ok(parts.length>=16);
  const expected=new Set();for(let i=0;i<sourceIndices.length;i+=3)expected.add(sourceIndices.slice(i,i+3).join(','));
  let count=0;const point=new Vector3();
  for(const part of parts){
    assert.equal(part.material,mesh.material);
    for(const [name,attribute] of Object.entries(geometry.attributes))assert.equal(part.geometry.getAttribute(name),attribute);
    const idx=part.geometry.index;
    for(let i=0;i<idx.count;i+=3){assert.ok(expected.delete([idx.getX(i),idx.getX(i+1),idx.getX(i+2)].join(',')));count++;}
    for(let i=0;i<idx.count;i++){point.fromBufferAttribute(geometry.attributes.position,idx.getX(i));assert.ok(part.geometry.boundingBox.containsPoint(point));}
  }
  assert.equal(expected.size,0);assert.equal(count,sourceIndices.length/3);assert.deepEqual(Array.from(geometry.index.array),sourceIndices);
  const scene=new Scene().add(mesh);scene.updateMatrixWorld(true);const world=mesh.matrixWorld.clone();
  partitionSourceGeometry(scene);
  scene.traverse(object=>{if(object.isMesh)assert.deepEqual(object.matrixWorld.toArray(),world.toArray());});
  geometry.dispose();mesh.material.dispose();for(const part of parts)part.geometry.dispose();
});

test('shadow fit excludes distant context while enclosing every architectural corner', () => {
  const scene = new Scene();
  const building = new Mesh(new BoxGeometry(42, 9, 48), new MeshStandardMaterial());
  building.position.set(10, 4.5, -18);scene.add(building);
  const groundMaterial = new MeshStandardMaterial();groundMaterial.name='shell__Neutral architectural ground';
  const ground = new Mesh(new BoxGeometry(88, .2, 88), groundMaterial);scene.add(ground);
  const bounds=architecturalShadowBounds(scene,new Box3().setFromObject(scene));
  assert.ok(Math.abs(bounds.getSize(new Vector3()).x-42)<1e-6);
  assert.equal(ground.castShadow,false);
  const sun=new DirectionalLight();sun.target.position.copy(bounds.getCenter(new Vector3()));
  sun.position.copy(sun.target.position).add(new Vector3(-64.273674,16.632935,-44.634514));
  scene.add(sun,sun.target);scene.updateMatrixWorld(true);
  const fit=fitSunShadow(sun,bounds);sun.shadow.updateMatrices(sun);
  for (const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) {
    const clip=new Vector3(x,y,z).project(sun.shadow.camera);
    assert.ok(Math.max(Math.abs(clip.x),Math.abs(clip.y),Math.abs(clip.z))<1,'architecture must remain in shadow coverage');
  }
  assert.ok(fit.width<80 && fit.height<30,'shadow texels should concentrate on the building');
  const before=sun.shadow.camera.projectionMatrix.toArray();
  fitSunShadow(sun,bounds);
  assert.deepEqual(sun.shadow.camera.projectionMatrix.toArray(),before,'fit must be deterministic and independent of the viewer');
  building.geometry.dispose();ground.geometry.dispose();building.material.dispose();groundMaterial.dispose();sun.shadow.dispose();
});
