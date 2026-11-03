import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, DirectionalLight, PerspectiveCamera } from 'three';
import { createStaticShadowPruner } from '../src/runtime/rendering/staticShadowPruner.ts';

test('only maximal fully immutable branches hide; mixed lift/avatar ancestry and scene services survive', () => {
  const scene = new Scene(), architecture = new Group(), staticRoom = new Group(), mixed = new Group();
  const wall = new Mesh(), floor = new Mesh(), trim = new Mesh(), lift = new Mesh(), avatar = new Mesh();
  const light = new DirectionalLight(), camera = new PerspectiveCamera();
  scene.add(architecture, avatar); architecture.add(staticRoom, mixed, light, camera); staticRoom.add(wall, floor); mixed.add(trim, lift);
  const immutable = new Set([architecture, staticRoom, mixed, wall, floor, trim, light, camera]);
  const pruner = createStaticShadowPruner(scene, object => immutable.has(object));
  assert.equal(pruner.branchCount, 2); assert.equal(pruner.renderableCount, 3);
  pruner.hide();
  assert.equal(staticRoom.visible, false); assert.equal(trim.visible, false);
  for (const object of [scene, architecture, mixed, lift, avatar, light, camera, wall, floor]) assert.equal(object.visible, true);
  const visited = []; scene.traverseVisible(object => visited.push(object));
  assert.ok(!visited.includes(wall)); assert.ok(!visited.includes(floor)); assert.ok(!visited.includes(trim));
  assert.ok(visited.includes(lift)); assert.ok(visited.includes(avatar));
  assert.throws(() => pruner.hide(), /overlap/);
  pruner.restore(); pruner.restore(); assert.equal(staticRoom.visible, true); assert.equal(trim.visible, true);
});

test('pre-existing visibility remains exact, and invalidation rebuilds mixed subtrees after new moving content', () => {
  const scene = new Scene(), room = new Group(), wall = new Mesh(); scene.add(room); room.add(wall);
  const immutable = new Set([room, wall]); room.visible = false;
  let pruner = createStaticShadowPruner(scene, object => immutable.has(object));
  pruner.hide(); pruner.restore(); assert.equal(room.visible, false);
  room.visible = true;
  const moving = new Mesh(); room.add(moving);
  pruner = createStaticShadowPruner(scene, object => immutable.has(object));
  pruner.hide(); assert.equal(room.visible, true); assert.equal(wall.visible, false); assert.equal(moving.visible, true);
  pruner.restore(); assert.equal(wall.visible, true);
});
