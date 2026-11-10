import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const require=createRequire(import.meta.url), flush=()=>new Promise(resolve=>setImmediate(resolve));
test('the chooser imports no lounge code until selected and a failed UI chunk can be retried',async()=>{
  const state=[], effects=[];
  let index=0, attempts=0, previous, dispose;
  const Gate=()=>null, Experience=()=>null, api={};
  const context={exports:api,require(id){
    if(id==='react')return {
      useState(value){const slot=index++;if(!(slot in state))state[slot]=value;
        return [state[slot],v=>{state[slot]=typeof v==='function'?v(state[slot]):v;}];},
      useEffect(fn,deps){if(previous!==deps[0]){previous=deps[0];effects.push(fn);}},
    };
    if(id==='@/components/maquette/MaquetteIntro')return {default:()=>null,MaquettePreferences:()=>null};
    if(id==='@/studio/components/LoungeEntry')return {default:Gate};
    if(id==='@/components/LoungeHome'){attempts++;if(attempts===1)throw Error('simulated chunk failure');return {default:Experience};}
    return require(id);
  }};
  vm.runInNewContext(compiled,context);
  const chooser=api.default().props.children;
  assert.equal(chooser.type,Gate);assert.equal(attempts,0);
  const render=()=>{index=0;return chooser.props.children.type();};
  const runEffect=()=>{dispose?.();dispose=effects.shift()();};
  assert.equal(render().props.state,'boot');runEffect();await flush();
  const fallback=render();
  assert.equal(fallback.props.state,'error');
  fallback.props.onRetry();
  render();runEffect();await flush();
  assert.equal(attempts,2);assert.equal(render().type,Experience);
  dispose();
});
