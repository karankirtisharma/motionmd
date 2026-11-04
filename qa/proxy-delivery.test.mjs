import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(new URL('../proxy.ts',import.meta.url));
const { NextRequest } = require('next/server');
// Compile the actual proxy to execute its NextResponse behavior in Node, without
// building the whole site. The alias shim only resolves local .ts module paths.
const source = fs.readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText;
const module = { exports:{} };
new Function('require','module','exports',compiled)(id => require(id.startsWith('./src/server/') ? id+'.ts' : id),module,module.exports);
const { proxy } = module.exports;
const index = JSON.parse(fs.readFileSync(new URL('../src/generated/asset-delivery.json',import.meta.url)));
const [path,entry] = Object.entries(index)[0];
const digest = entry.br.match(/[a-f0-9]{64}/)[0];
const request = url => new NextRequest(new URL(url,'http://127.0.0.1:3001'),{headers:{'Accept-Encoding':'br'}});
for (const [suffix,expected] of [['','must-revalidate'],['?v=stale','must-revalidate'],['?v='+digest,'immutable']]) test(`production proxy preserves ${expected} through an external rewrite (${suffix||'unversioned'})`,()=>{
 const first = proxy(request(path+suffix));
 assert.ok(first.headers.get('cache-control').includes(expected));
 const destination = first.headers.get('x-middleware-rewrite'); assert.ok(destination);
 const second = proxy(request(destination));
 assert.ok(second.headers.get('cache-control').includes(expected));
 assert.equal(new URL(destination).pathname,entry.br);
});
test('direct generated hashes are immutable, and mutable requests cannot mark unknown files immutable',()=>{
 assert.match(proxy(request(entry.br)).headers.get('cache-control'),/immutable/);
 assert.equal(proxy(request('/asset-delivery/unknown.glb')).headers.get('cache-control'),null);
});
const images = JSON.parse(fs.readFileSync(new URL('../src/generated/texture-delivery.json',import.meta.url)));
test('texture requests negotiate WebP through a rewrite and PNG through the original URL', {skip:!Object.keys(images).length}, () => {
  const [url, entry] = Object.entries(images)[0];
  const withAccept = accept => new NextRequest(new URL(url,'http://127.0.0.1:3001'),{headers:{Accept:accept}});
  const modern = proxy(withAccept('*/*')), original = proxy(withAccept('image/png'));
  assert.equal(original.headers.get('x-middleware-rewrite'),null); assert.equal(original.headers.get('content-type'),'image/png');
  const dest = new URL(modern.headers.get('x-middleware-rewrite')); assert.equal(dest.pathname,entry.webp);
  for(const representation of [modern,original,proxy(request(dest))]) {
    assert.match(representation.headers.get('vary'),/(^|,\s*)Accept(,|$)/);
    assert.match(representation.headers.get('cache-control'),/must-revalidate/);
  }
  assert.match(proxy(request(entry.webp)).headers.get('cache-control'),/immutable/);
});
