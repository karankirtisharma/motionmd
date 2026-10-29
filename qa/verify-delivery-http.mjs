import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const origin = process.env.MD_VERIFY_ORIGIN || 'http://127.0.0.1:3001';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
const index = JSON.parse(fs.readFileSync(new URL('../src/generated/asset-delivery.json', import.meta.url)));
const records = [];
function request(url,headers,method='GET') {
  return new Promise((resolve,reject)=>{
    const address = new URL(url,origin);
    const req = (address.protocol==='https:'?https:http).request(address,{method,headers},async response=>{
      let wire=0,decoded=0;const hash=createHash('sha256');
      response.on('data',data=>wire+=data.length);
      try {
        const streams=[response],encoding=response.headers['content-encoding'];
        if(method!=='HEAD'&&response.statusCode!==304){if(encoding==='br')streams.push(createBrotliDecompress());else if(encoding==='gzip')streams.push(createGunzip());}
        streams.push(new Writable({write(data,_,done){decoded+=data.length;hash.update(data);done();}}));
        await pipeline(...streams);
        resolve({status:response.statusCode,headers:response.headers,wire,decoded,sha256:hash.digest('hex')});
      }catch(error){reject(error);}
    });
    req.on('error',reject);req.end();
  });
}
for(const chunk of [...manifest.chunks,{id:'character',url:manifest.character.url}]){
  const entry=index[chunk.url];
  assert.ok(entry,'Generate delivery variants first');
  const expected=fs.readFileSync(new URL('../public'+(entry.identity||chunk.url),import.meta.url));
  const sha256=createHash('sha256').update(expected).digest('hex');
  for(const encoding of ['br','gzip','identity']){
    const result=await request(chunk.url,{'Accept-Encoding':encoding});
    assert.equal(result.status,200);assert.equal(result.sha256,sha256);
    assert.equal(result.headers['content-encoding'],encoding==='identity'?undefined:encoding);
    assert.match(result.headers['content-type'],/^model\/gltf-binary/);
    assert.match(result.headers.vary,/Accept-Encoding/i);
    assert.match(result.headers['cache-control'],/must-revalidate/);
    assert.equal(result.decoded,entry.decodedBytes);
    assert.equal(Number(result.headers['x-scene-decoded-length']),manifest.chunks.map(chunk=>index[chunk.url]).reduce((sum,item)=>sum+item.decodedBytes,0));
    assert.equal(Number(result.headers['x-scene-encoded-length']),manifest.chunks.map(chunk=>index[chunk.url]).reduce((sum,item)=>sum+(encoding==='identity'?item.decodedBytes:item[encoding+'Bytes']),0));
    records.push({id:chunk.id,encoding,...result});
  }
  console.log('Verified br / gzip / identity:',chunk.id);
}
const small=manifest.chunks.at(-1).url;
for(const [header,encoding,status] of [['br;q=0,gzip','gzip',200],['gzip;q=1,br;q=0.2','gzip',200],['br;q=0,gzip;q=0',undefined,200],['*;q=0',undefined,406]]){
  const result=await request(small,{'Accept-Encoding':header});
  assert.equal(result.status,status);assert.equal(result.headers['content-encoding'],encoding);
}
const head=await request(small,{'Accept-Encoding':'br'},'HEAD');
assert.equal(head.status,200);assert.equal(head.wire,0);assert.equal(head.headers['content-encoding'],'br');
const cached=await request(small,{'Accept-Encoding':'br','If-None-Match':head.headers.etag});
assert.equal(cached.status,304);assert.equal(cached.wire,0);
const range=await request(small,{'Accept-Encoding':'identity',Range:'bytes=0-15'});
assert.equal(range.status,206);assert.equal(range.decoded,16);
if(process.env.MD_HTTP_REPORT)fs.writeFileSync(process.env.MD_HTTP_REPORT,JSON.stringify(records,null,2));
console.log('HTTP delivery, weights, HEAD, revalidation and identity ranges passed.');
