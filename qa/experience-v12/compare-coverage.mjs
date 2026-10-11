import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollisionWorld } from '../../src/runtime/interaction/CollisionWorld.ts';
const manifest = JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
const records = JSON.parse(fs.readFileSync('public/assets/experience-v12/coverage.json')).objects;
async function fixture(includeNew) {
  const root = new T.Group();
  for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) {
    if (!includeNew && url.includes('/experience-v12/')) continue;
    const b = fs.readFileSync('public'+url);
    root.add((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'')).scene);
  }
  return createCollisionWorld(root,undefined,root);
}
const before = await fixture(false), after = await fixture(true);
const results = records.map(({sourceName,min,max}) => {
  const feet = new T.Vector3((min[0]+max[0])/2,min[1]+.02,(min[2]+max[2])/2);
  return {sourceName,feet:feet.toArray(),beforeBlocked:!before.canStandAt(feet),afterBlocked:!after.canStandAt(feet)};
});
before.dispose();after.dispose();
fs.writeFileSync('qa/experience-v12/coverage-comparison.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.filter(r=>!r.beforeBlocked&&r.afterBlocked).map(r=>r.sourceName),null,2));
