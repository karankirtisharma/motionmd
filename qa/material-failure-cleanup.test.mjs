import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Group, Mesh, BoxGeometry } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

// Exercise the production material graph with network/decode isolated, as the
// source-albedo parity fixture does. No rendering/material implementation is mocked.
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modules = new Map();
const assetsURL = moduleURL(`import {Texture} from ${JSON.stringify(import.meta.resolve('three'))};
export const state={fail:'',delay:false,loaded:[],disposed:[]};
export async function loadTexture(url,usage,signal){
 if(url===state.fail)throw Error('Injected map failure: '+url);
 if(state.delay)await new Promise(resolve=>setTimeout(resolve,20));
 const texture=new Texture();texture.name=url;state.loaded.push(url);
 texture.addEventListener('dispose',()=>state.disposed.push(url));return texture;
}`);
function compile(relative) {
  const file = new URL(relative, import.meta.url);
  if (modules.has(file.href)) return modules.get(file.href);
  let source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  source = source.replace(/from (['"])([^'"]+)\1/g, (full, quote, specifier) => {
    let target;
    if (specifier === './assets' || specifier === './assets.ts') target = assetsURL;
    else if (specifier.startsWith('.')) { const dependency = new URL(specifier, file); if (!path.extname(dependency.pathname)) dependency.pathname += '.ts'; target = compile(dependency.href); }
    else target = import.meta.resolve(specifier);
    return 'from ' + JSON.stringify(target);
  });
  const result = moduleURL(source); modules.set(file.href, result); return result;
}
const { state } = await import(assetsURL);
const { applyMaterialManifest } = await import(compile('../src/runtime/rendering/materials.ts'));
const { restoreSourceBronze } = await import(compile('../src/runtime/rendering/sourceBronze.ts'));
function reset() { state.fail = ''; state.delay = false; state.loaded.length = 0; state.disposed.length = 0; }

test('a prefetched map failure waits for remaining jobs and disposes every successfully loaded map', async () => {
  reset(); state.fail = '/second.png'; state.delay = true;
  const root = new Group();
  const manifest = { materials: [{ name: 'test', map: '/first.png', normalMap: '/second.png', roughnessMap: '/third.png' }] };
  await assert.rejects(applyMaterialManifest(root, manifest), /Injected map failure/);
  assert.ok(state.loaded.length >= 1);
  assert.deepEqual([...state.disposed].sort(), [...state.loaded].sort());
  const count = state.loaded.length; await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.loaded.length, count, 'all queued work must settle before failure is returned');
});

test('bronze setup failure disposes its map even before ownership reaches the caller', async () => {
  reset();
  const material = new MeshPhysicalNodeMaterial(); material.name = 'fixture__Satin bronze';
  material.color.setRGB = () => { throw Error('Injected graph setup failure'); };
  const geometry = new BoxGeometry(); const root = new Group().add(new Mesh(geometry, material));
  await assert.rejects(restoreSourceBronze(root), /Injected graph setup failure/);
  assert.deepEqual(state.loaded, ['/assets/surface-v5/bronze-source-grain.png']);
  assert.deepEqual(state.disposed, state.loaded);
  material.dispose(); geometry.dispose();
});
