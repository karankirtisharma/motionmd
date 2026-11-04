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
    if(id==='@/studio/components/LoungeEntry')return {default:Gate};
    if(id==='@/components/LoungeHome'){attempts++;if(attempts===1)throw Error('simulated chunk failure');return {default:Experience};}
    return require(id);
  }};
  vm.runInNewContext(compiled,context);
  const chooser=api.default();
  assert.equal(chooser.type,Gate);assert.equal(attempts,0);
  const render=()=>{index=0;return chooser.props.children.type();};
  const runEffect=()=>{dispose?.();dispose=effects.shift()();};
  const nodes=tree=>tree&&typeof tree==='object'?[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]:[];
  assert.ok(nodes(render()).some(x=>x.props?.role==='status'));runEffect();await flush();
  const fallback=nodes(render());
  assert.ok(fallback.some(x=>x.props?.href==='/studio?entry=direct'));
  const retry=fallback.find(x=>x.type==='button');retry.props.onClick();
  render();runEffect();await flush();
  assert.equal(attempts,2);assert.equal(render().type,Experience);
  dispose();
});
