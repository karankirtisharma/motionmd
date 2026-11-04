import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const root=new URL('../',import.meta.url), req=createRequire(new URL('package.json',root));
const load=id=>id.startsWith('./src/server/')?req(id+'.ts'):req(id);
const raw=req('./src/generated/immutable-scene-assets.json');
const source=fs.readFileSync(new URL('proxy.ts',root),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const api={};vm.runInNewContext(compiled,{exports:api,require:load,URL});
for(const ext of ['.exr','.ktx2']) test('current '+ext+' is immutable, plain URLs revalidate, and stale GET/HEAD redirect without caching wrong bytes',()=>{
  const path=Object.keys(raw).find(k=>k.endsWith(ext));
  if(!path){assert.ok(process.env.NEXT_PUBLIC_ASSET_BASE_URL);return;}
  const hash=raw[path], url='https://lounge.example'+path;
  for(const method of ['GET','HEAD']){
    const current=api.proxy(new NextRequest(url+'?v='+hash,{method,headers:{Range:'bytes=0-31'}}));
    assert.equal(current.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
    assert.equal(current.headers.get('x-middleware-next'),'1');
    const plain=api.proxy(new NextRequest(url,{method}));
    assert.match(plain.headers.get('Cache-Control'),/must-revalidate/);
    const stale=api.proxy(new NextRequest(url+'?keep=yes&v='+('0'.repeat(64)),{method}));
    assert.equal(stale.status,307);assert.equal(stale.headers.get('Location'),url+'?keep=yes&v='+hash);assert.equal(stale.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(api.proxy(new NextRequest(url,{method:'POST'})).headers.get('cache-control'),null);
});
