import fs from 'node:fs';import assert from 'node:assert/strict';
const m=JSON.parse(fs.readFileSync('public/assets/scene-manifest.json'));
let lossless=0;
for(const id of ['v13','v19']){const c=m.chunks.find(c=>c.id===id),b=fs.readFileSync('public'+c.url),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
 const filters=j.bufferViews.map(v=>v.extensions?.EXT_meshopt_compression).filter(Boolean);assert.ok(filters.length>0);assert.ok(filters.every(e=>!e.filter||e.filter==='NONE'),'Lossy architectural attributes');lossless+=filters.length;
 if(id==='v13'){const glass=j.materials.find(m=>m.name.includes('optical low iron laminated glass'));assert.ok(glass?.extensions?.KHR_materials_transmission?.transmissionFactor>.9,'Detailed glass spiral retained')}
 if(id==='v19')assert.ok(j.materials.some(m=>m.name==='v19__Low iron glass | 12 mm'),'Keep the original clear guard material');
}
const d=JSON.parse(fs.readFileSync('qa/architecture-v19/web-surface-diagnosis.json'));assert.equal(d.duplicates.length,0,'Competing top surfaces at gallery junction');
const height=(x,y)=>{const u=x-(-7.28125+Math.sqrt(14.28125**2-(y-19.65)**2));return u<0?4.233:u<.3?4.2:u<.6?4.025:u<.9?3.85:3.675};
const samples=d.rows.filter(r=>r.material.startsWith('v19:'));
assert.ok(samples.length>=30);assert.ok(samples.every(r=>r.material.includes('marble')));
const error=Math.max(...samples.map(r=>Math.abs(r.height-height(r.x,r.y))));assert.ok(error<.000002,'Preserve source tread elevations');
const result={losslessBufferViews:lossless,marbleSamples:samples.length,maxHeightErrorMetres:error,competingSurfaceSamples:d.duplicates.length};
fs.writeFileSync('qa/architecture-v19/precision-audit.json',JSON.stringify(result,null,2));console.log(result);
