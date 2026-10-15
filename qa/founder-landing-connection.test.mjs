import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';

test('removed vestibule wall and internal railing leave a grounded founder connection', async () => {
  const manifest=JSON.parse(fs.readFileSync(process.env.SCENE_MANIFEST || new URL('../public/assets/scene-manifest.json',import.meta.url)));
  const root=new THREE.Group();
  for(const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]) {
    const data=fs.readFileSync(new URL('../public'+url,import.meta.url));
    root.add((await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.length),'')).scene);
  }
  const physics=await createCollisionWorld(root,undefined,root);
  try {
    assert.ok(![...physics.colliderNames.values()].some(n=>n.includes('EH52 east vestibule rear jamb')), 'Retired wall must not leave an invisible blocker');
    assert.ok(![...physics.colliderNames.values()].some(n=>n==='Front wing curtain wall mullion.027'||n.endsWith('_Front wing curtain wall mullion.027')), 'Removed slender frame must not leave an invisible blocker');
    assert.ok(physics.canStandAt(new THREE.Vector3(3.6,4.233,-10.8)), 'The circled frame position is open');
    for(const x of [.5,2,3,4.5]) for(const z of [-10.8,-11.01,-11.3]) {
      const feet=new THREE.Vector3(x,4.233,z);
      assert.ok(Math.abs(physics.groundAt(feet)-4.233)<.012,`Continuous floor at ${x}, ${z}`);
      assert.ok(physics.canStandAt(feet),`Open passage at ${x}, ${z}`);
    }
    const routes=[[[2,4.233,-13],[2,4.228,-10]],[[4.5,4.233,-12],[4.5,4.23,-10.5],[7,4.23,-10.5]]];
    for(const speed of [1.38,3.35]) for(const route of routes) for(const reverse of [false,true]) {
      const points=reverse?[...route].reverse():route,feet=new THREE.Vector3(...points[0]);
      physics.place(feet);let grounded=true,vertical=0;
      for(const target of points.slice(1)) {
        for(let frame=0;frame<1200;frame++) {
          const delta=new THREE.Vector3(target[0]-feet.x,0,target[2]-feet.z);
          if(delta.length()<.04)break;
          delta.clampLength(0,speed/60);vertical=grounded?-.5:Math.max(-16,vertical-9.81/60);delta.y=vertical/60;
          grounded=physics.move(delta,1/60,feet);
          assert.ok(feet.y>4.19&&feet.y<4.27,'No fall, floating or step at the new join');
        }
        assert.ok(Math.hypot(feet.x-target[0],feet.z-target[2])<.08,`Blocked route at ${speed}: ${feet.toArray()}`);
      }
    }
    assert.equal(physics.canStandAt(new THREE.Vector3(5.18,4.233,-10.985)),false,'Retained soffit support remains solid');
  } finally { physics.dispose(); }
});
