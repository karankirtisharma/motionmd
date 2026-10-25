import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../public',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/scene-manifest.json')));
const urls=new Set();
function visit(v){if(typeof v==='string'&&v.startsWith('/assets/'))urls.add(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);}
visit(manifest);
const gltfs=[];
for(const url of [...urls]){
 if(!/\.(gltf|glb)$/.test(url))continue;
 let gltf;
 if(url.endsWith('.glb')){
  const fd=fs.openSync(path.join(root,url),'r'),header=Buffer.alloc(20);fs.readSync(fd,header,0,20,0);
  const json=Buffer.alloc(header.readUInt32LE(12));fs.readSync(fd,json,0,json.length,20);fs.closeSync(fd);gltf=JSON.parse(json.toString());
 }else gltf=JSON.parse(fs.readFileSync(path.join(root,url)));
 gltfs.push({url,samplers:gltf.samplers});
 for(const image of gltf.images??[])if(image.uri&&!image.uri.startsWith('data:'))urls.add(image.uri.startsWith('/')?image.uri:path.posix.join(path.posix.dirname(url),image.uri));
}
const ktx=[];
for(const url of urls){
 if(!url.endsWith('.ktx2'))continue;
 const fd=fs.openSync(path.join(root,url),'r'),b=Buffer.alloc(80);fs.readSync(fd,b,0,b.length,0);fs.closeSync(fd);
 ktx.push({url,width:b.readUInt32LE(20),height:b.readUInt32LE(24),levels:b.readUInt32LE(40)});
}
const report={gltfs,ktx,missingMipChains:ktx.filter(t=>t.levels<1+Math.floor(Math.log2(Math.max(t.width,t.height))))};
fs.writeFileSync(new URL('material-v20/texture-files.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({gltfFiles:gltfs.length,ktxFiles:ktx.length,missingMipChains:report.missingMipChains.length}));
