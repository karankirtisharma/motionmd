import fs from 'node:fs';
import ts from 'typescript';
import {geometryFixture} from './geometry-fixture.mjs';
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
export async function avatarFixture() {
  const movement=moduleURL(compile('../../src/runtime/interaction/movement.ts'));
  const three=JSON.stringify(import.meta.resolve('three')),flights=moduleURL(compile('../../src/runtime/interaction/stairFlights.ts'));
  const locomotion=moduleURL(compile('../../src/runtime/interaction/locomotionClips.ts').replace("from 'three'",`from ${three}`).replace("from './stairFlights'",`from ${JSON.stringify(flights)}`));
  const code=compile('../../src/runtime/interaction/RocketboxAvatar.ts')
    .replace("from 'three'",`from ${three}`).replace("from './movement'",`from ${JSON.stringify(movement)}`).replace("from './locomotionClips'",`from ${JSON.stringify(locomotion)}`);
  const {createRocketboxAvatar}=await import(moduleURL(code));
  return createRocketboxAvatar((await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf);
}
