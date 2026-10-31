import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Group, Matrix4, Object3D, Scene, SkinnedMesh, Vector3, Vector4 } from 'three';
import { freezeArchitectureTransforms } from '../src/runtime/rendering/staticTransforms.ts';
import { ReflectionFrameCache } from '../src/runtime/rendering/reflectionFrameCache.ts';

function fixture() {
  const scene = new Scene(), architecture = new Group(); scene.add(architecture);
  architecture.position.set(2, 3, -4); architecture.rotation.set(.1, .3, -.2);
  for (let i = 0; i < 32; i++) {
    const group = new Group(); group.position.set(i / 3, 2, -i); group.rotation.set(.1, i / 20, .2); group.scale.set(1.2, .8, 2);
    architecture.add(group);
    for (let j = 0; j < 8; j++) { const object = new Object3D(); object.position.set(j, j / 3, -1); group.add(object); }
  }
  const cabin = new Group(); cabin.userData.liftRole = 'cabin'; architecture.add(cabin);
  const door = new Object3D(); cabin.add(door);
  const authored = new Group(); architecture.add(authored); authored.add(new Object3D());
  scene.updateMatrixWorld(true);
  return { scene, architecture, cabin, door, authored };
}

test('frozen architecture preserves exact transforms while lift and authored animation remain live', () => {
  const a = fixture(), b = fixture();
  const frozen = freezeArchitectureTransforms(a.architecture, [a.authored]);
  assert.equal(frozen.count, 289);
  assert.equal(a.cabin.matrixAutoUpdate, true); assert.equal(a.door.matrixWorldAutoUpdate, true);
  assert.equal(a.authored.matrixAutoUpdate, true);
  for (let frame = 0; frame < 30; frame++) {
    for (const f of [a, b]) {
      f.cabin.position.y = frame / 4; f.door.position.x = frame / 20;
      f.authored.rotation.z = frame / 10; f.scene.updateMatrixWorld(true);
    }
    const left = [], right = [];
    a.architecture.traverse(o => left.push(o.matrixWorld.toArray()));
    b.architecture.traverse(o => right.push(o.matrixWorld.toArray()));
    assert.deepEqual(left, right);
  }
  frozen.restore(); frozen.restore();
  a.architecture.position.x += 4; b.architecture.position.x += 4;
  a.scene.updateMatrixWorld(true); b.scene.updateMatrixWorld(true);
  assert.deepEqual(a.door.matrixWorld.toArray(), b.door.matrixWorld.toArray());
  assert.equal(a.architecture.matrixAutoUpdate, true);
});

test('skeletal and clip-bearing nodes are never frozen; pre-existing update flags restore exactly', () => {
  const root = new Group(), skin = new SkinnedMesh(), bone = new Bone(), clipRoot = new Group(), fixed = new Object3D();
  clipRoot.animations.push(new AnimationClip('authored', 1, []));
  fixed.matrixAutoUpdate = false; root.add(skin, bone, clipRoot, fixed);
  const frozen = freezeArchitectureTransforms(root);
  assert.equal(frozen.count, 2);
  for (const o of [skin, bone, clipRoot]) assert.equal(o.matrixWorldAutoUpdate, true);
  frozen.restore(); assert.equal(fixed.matrixAutoUpdate, false); assert.equal(fixed.matrixWorldAutoUpdate, true);
});

test('immutable transform cache eliminates repeated static matrix math without changing traversal', t => {
  const f = fixture(); let local = 0, world = 0;
  f.architecture.traverse(o => {
    const compose = o.matrix.compose.bind(o.matrix), multiply = o.matrixWorld.multiplyMatrices.bind(o.matrixWorld);
    o.matrix.compose = (...args) => { local++; return compose(...args); };
    o.matrixWorld.multiplyMatrices = (...args) => { world++; return multiply(...args); };
  });
  for (let i = 0; i < 100; i++) f.scene.updateMatrixWorld(true);
  const before = { local, world };
  const frozen = freezeArchitectureTransforms(f.architecture, [f.authored]); local = 0; world = 0;
  for (let i = 0; i < 100; i++) f.scene.updateMatrixWorld(true);
  assert.equal(before.local, 29300); assert.equal(before.world, 29300);
  assert.equal(local, 400); assert.equal(world, 400);
  t.diagnostic(JSON.stringify({ before, after: { local, world }, cachedStaticNodes: frozen.count, frames: 100 }));
});

test('mirror cache invalidates for every scene, camera, crop and target change', () => {
  const cache = new ReflectionFrameCache(), scene = new Scene(), world = new Matrix4(), projection = new Matrix4(), crop = new Vector4(0, 0, 1, 1);
  const args = [scene, 1, world, projection, crop, 1024, 768];
  assert.equal(cache.matches(...args), false); cache.record(...args); assert.equal(cache.matches(...args), true);
  assert.equal(cache.matches(scene, 1, world.clone(), projection.clone(), crop.clone(), 1024, 768), true);
  const variants = [
    [0, new Scene()], [1, 2], [1, undefined], [2, new Matrix4().makeTranslation(1, 0, 0)],
    [3, new Matrix4().makeScale(2, 1, 1)], [4, new Vector4(.1, 0, .9, 1)], [5, 512], [6, 384],
  ];
  for (const [index, value] of variants) { const changed = [...args]; changed[index] = value; assert.equal(cache.matches(...changed), false, `argument ${index}`); }
  world.makeTranslation(0, 1, 0); assert.equal(cache.matches(...args), false, 'cache stores copies, not mutable references');
  cache.record(...args); cache.invalidate(); assert.equal(cache.matches(...args), false);
  cache.record(scene, undefined, world, projection, crop, 1024, 768);
  assert.equal(cache.matches(scene, undefined, world, projection, crop, 1024, 768), false, 'callers without a revision must always render');
});

test('mirror reuses stationary settle frames, but never drops animated or camera-motion frames', t => {
  function simulate(mode) {
    const cache = new ReflectionFrameCache(), scene = new Scene(), world = new Matrix4(), projection = new Matrix4(), crop = new Vector4(0, 0, 1, 1);
    let renders = 0;
    for (let frame = 0; frame < 128; frame++) {
      const revision = mode === 'animation' ? frame : 0;
      if (mode === 'camera') world.makeTranslation(frame / 100, 0, 0);
      if (!cache.matches(scene, revision, world, projection, crop, 1024, 768)) {
        renders++; cache.record(scene, revision, world, projection, crop, 1024, 768);
      }
    }
    return renders;
  }
  assert.equal(simulate('settle'), 1); assert.equal(simulate('animation'), 128); assert.equal(simulate('camera'), 128);
  t.diagnostic('128 unchanged settle frames: 1 reflection render; 128 animated frames: 128 reflection renders.');
});
