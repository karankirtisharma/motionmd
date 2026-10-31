/** Offline matrix-work benchmark using the production GLBs and actual chair extraction.
 * Texture loading and renderer are intentionally absent; timings describe transform CPU
 * work only, not FPS. Run: node qa/benchmark-static-transforms.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Group, MeshStandardMaterial, Scene } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { partitionSourceGeometry } from '../src/runtime/rendering/spatialVisibility.ts';
import { freezeArchitectureTransforms } from '../src/runtime/rendering/staticTransforms.ts';
import { createGalleryMirror } from '../src/runtime/rendering/galleryMirror.ts';
import { createWorkstation } from '../src/runtime/interaction/Workstation.ts';
import { repairExteriorWinding, repairExteriorOverlap, repairExteriorGroove } from '../src/runtime/rendering/exteriorSurfaces.ts';
import { repairFounderExteriorWinding } from '../src/runtime/rendering/exteriorLighting.ts';
import { repairArchitecturalJoins } from '../src/runtime/rendering/architecturalJoins.ts';
import { repairStudioThreshold } from '../src/runtime/rendering/floorThreshold.ts';
import { repairEntranceApron } from '../src/runtime/rendering/entranceApron.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const scene = new Scene(), content = new Group(); scene.add(content);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => ({ name: 'MATRIX_BENCHMARK_NO_TEXTURES', loadMaterial(index) {
  const material = new MeshStandardMaterial(); material.name = parser.json.materials[index].name; return Promise.resolve(material);
}}));
for (const chunk of manifest.chunks) {
  const bytes = fs.readFileSync(new URL('../public' + chunk.url, import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.equal(gltf.animations.length, 0, 'update benchmark exclusions if authored source animation is added');
  content.add(gltf.scene);
}
repairExteriorWinding(content); repairExteriorOverlap(content); repairExteriorGroove(content);
repairFounderExteriorWinding(content); repairArchitecturalJoins(content); repairStudioThreshold(content); repairEntranceApron(content);
const mirror = createGalleryMirror(content);
const partition = partitionSourceGeometry(content);
const chair = createWorkstation(scene);
assert.ok(chair); assert.equal(chair.group.parent, scene);
for (const mesh of chair.meshes) {
  for (let parent = mesh.parent; parent; parent = parent.parent) assert.notEqual(parent, content, 'chair must leave immutable content');
}
scene.updateMatrixWorld(true);
const roles = new Map(); content.traverse(object => { if (object.userData.liftRole) roles.set(object.userData.liftRole, object); });
const poses = [];
function pose(frame) {
  chair.setSwivel(frame / 30);
  roles.get('cabin').position.y = frame / 10;
  roles.get('cabinDoorLeft').position.x = frame / 100;
  roles.get('hydraulicRod').scale.y = .27 + frame / 20;
  scene.updateMatrixWorld(true);
  const matrices = []; scene.traverse(object => matrices.push(object.matrixWorld.toArray())); return matrices;
}
for (let frame = 0; frame < 20; frame++) poses.push(pose(frame));
let local = 0, world = 0, nodes = 0;
content.traverse(object => {
  nodes++;
  const compose = object.matrix.compose.bind(object.matrix), multiply = object.matrixWorld.multiplyMatrices.bind(object.matrixWorld);
  object.matrix.compose = (...args) => { local++; return compose(...args); };
  object.matrixWorld.multiplyMatrices = (...args) => { world++; return multiply(...args); };
});
function sample() {
  local = 0; world = 0;
  const started = performance.now();
  for (let frame = 0; frame < 1000; frame++) scene.updateMatrixWorld(true);
  return { frames: 1000, localCompositions: local, worldMultiplications: world, milliseconds: performance.now() - started };
}
sample(); const before = sample();
const frozen = freezeArchitectureTransforms(content);
for (let frame = 0; frame < 20; frame++) assert.deepEqual(pose(frame), poses[frame], `production chair/lift pose ${frame}`);
sample(); const after = sample();
assert.ok(after.localCompositions < before.localCompositions / 5);
assert.ok(after.worldMultiplications < before.worldMultiplications / 5);
assert.equal(chair.swivel.matrixAutoUpdate, true);
const result = { benchmark: 'production GLB architecture transform CPU work only; not FPS', partition, nodes, cachedNodes: frozen.count, liveNodes: nodes - frozen.count, before, after, exactProductionDynamicPosesVerified: poses.length };
console.log(JSON.stringify(result, null, 2));
frozen.restore(); mirror?.dispose();
