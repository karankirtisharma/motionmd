import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

// The remaining runtime dependencies are loaded from code, not the manifest.
const runtimeAssets = [
  'basis/basis_transcoder.js', 'basis/basis_transcoder.wasm', 'environment/qwantani-sunset-2k.hdr',
  'source-walls/greige-marble-original.png', 'source-walls/stone-height-original.jpg',
  'source-walls/stone-roughness-original.jpg', 'surface-v5/bronze-source-grain.png',
];
const provenance = [
  'character/LICENSE.txt', 'character/PROVENANCE.md', 'character/Rocketbox-MIT-LICENSE.txt',
  'character/Rocketbox-PROVENANCE.json', 'character/Mixamo-PROVENANCE.md', 'environment/PROVENANCE.md',
  'source-walls/provenance.json', 'source-walls/floor-provenance.json', 'surface-v5/bronze-provenance.json',
];
const hashName = /^[a-f0-9]{64}(?:\.glb|\.(?:q9\.)?glb\.(?:br|gz)|\.webp|\.exr)$/;

function publicFile(root,url) {
  if (!url.startsWith('/') || /[\\?#%]/.test(url) || url.split('/').some(p=>p==='.' || p==='..')) throw Error('Unsafe public asset path: '+url);
  return path.join(root,...url.slice(1).split('/'));
}
async function *files(root,prefix='') {
  for (const entry of await fs.readdir(root,{withFileTypes:true})) {
    const name=prefix+'/'+entry.name, file=path.join(root,entry.name);
    if (entry.isSymbolicLink()) throw Error('Release assets must not contain symlinks: '+file);
    if (entry.isDirectory()) yield* files(file,name);
    else if (entry.isFile()) yield name;
  }
}
async function modelJSON(file) {
  const fd=await fs.open(file,'r');
  try {
    const head=Buffer.alloc(20);
    await fd.read(head,0,20,0);
    if (head.toString('ascii',0,4)!=='glTF' || head.readUInt32LE(4)!==2 || head.readUInt32LE(16)!==0x4e4f534a) throw Error('Invalid GLB or unhydrated Git LFS pointer: '+file);
    const length=head.readUInt32LE(12);
    if (length>head.readUInt32LE(8)-20) throw Error('Invalid GLB metadata length: '+file);
    const data=Buffer.alloc(length);
    if ((await fd.read(data,0,length,20)).bytesRead!==length) throw Error('Incomplete GLB metadata: '+file);
    return JSON.parse(data.toString());
  } finally {await fd.close();}
}

/** Fail closed on missing manifest, decoder or external model dependencies. */
export async function releaseSourceAssets(publicDir) {
  const manifestURL='/assets/scene-manifest.json';
  const manifest=JSON.parse(await fs.readFile(publicFile(publicDir,manifestURL),'utf8'));
  const urls=new Set([manifestURL,...runtimeAssets.map(file=>'/assets/'+file)]);
  function collect(value) {
    if(typeof value==='string' && value.startsWith('/assets/')) urls.add(value);
    else if(value && typeof value==='object') Object.values(value).forEach(collect);
  }
  collect(manifest);
  const models=[...urls].filter(url=>url.endsWith('.glb'));
  for (const url of models) {
    const json=await modelJSON(publicFile(publicDir,url));
    for (const resource of [...(json.images??[]),...(json.buffers??[])]) {
      if (!resource.uri || /^(?:data:|https?:)/i.test(resource.uri)) continue;
      const resolved=new URL(resource.uri,'https://release.invalid'+url);
      if(resolved.origin!=='https://release.invalid' || !resolved.pathname.startsWith('/assets/')) throw Error('Unexpected external GLB dependency: '+resource.uri);
      urls.add(resolved.pathname);
    }
  }
  for(const url of urls) {
    const stat=await fs.lstat(publicFile(publicDir,url));
    if (!stat.isFile()) throw Error('Missing or non-file release asset: '+url);
  }
  // Provenance is optional across source revisions, but always retained when supplied.
  for(const name of provenance) {
    const url='/assets/'+name;
    try {if((await fs.lstat(publicFile(publicDir,url))).isFile()) urls.add(url);}
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  return urls;
}

async function digest(file,decoder) {
  const hash=createHash('sha256');
  const streams=[createReadStream(file)];
  if(decoder)streams.push(decoder);
  await pipeline(...streams,new Writable({write(bytes,enc,done){hash.update(bytes);done();}}));
  return hash.digest('hex');
}
async function verifyIdentity(publicDir,source,entry,reports) {
  const hash=entry.identity?.match(/^\/asset-delivery\/([a-f0-9]{64})\.glb$/)?.[1];
  if (!hash || entry.br!=='/asset-delivery/'+hash+'.q9.glb.br' || entry.gzip!=='/asset-delivery/'+hash+'.q9.glb.gz') throw Error('Invalid delivery variants for '+source);
  const proof=reports.find(row=>row.entry?.identity===entry.identity && row.sha256===hash);
  if (!proof || await digest(publicFile(publicDir,source))!==proof.sourceSHA256) throw Error('Source master changed; regenerate variants for '+source);
  for (const [url,length,decoder] of [[entry.identity,entry.decodedBytes],[entry.br,entry.brBytes,createBrotliDecompress],[entry.gzip,entry.gzipBytes,createGunzip]]) {
    const name=publicFile(publicDir,url);
    if ((await fs.stat(name)).size!==length || await digest(name,decoder?.())!==hash) throw Error('Invalid identity/encoding; refusing to omit source for '+source);
  }
}

/** Construct a new public tree. No source file is removed, moved or overwritten. */
export async function stageReleasePublic(publicDir,destination,entries,{dryRun=false}={}) {
  const root=path.resolve(publicDir),dest=path.resolve(destination);
  if (dest===root || dest.startsWith(root+path.sep) || root.startsWith(dest+path.sep)) throw Error('Release destination must be separate from its input');
  const keep=await releaseSourceAssets(root),omittedModels=new Set();
  const reports=Object.values(entries).some(entry=>entry.identity)
    ? JSON.parse(await fs.readFile(path.join(root,'asset-delivery/report.json'),'utf8')) : [];
  for (const [url,entry] of Object.entries(entries)) {
    if (!entry.identity) continue;
    if (!keep.has(url)) throw Error('Unexpected delivery index source: '+url);
    await verifyIdentity(root,url,entry,reports);omittedModels.add(url);
  }
  if (!dryRun) await fs.mkdir(dest); // Refuse to merge into any existing directory.
  const result={files:0,bytes:0,omittedModelBytes:0,unselectedAssetBytes:0,oldHashBytes:0};
  const current=new Set(Object.values(entries).flatMap(e=>[e.identity,e.gzip,e.br].filter(Boolean)));
  for await(const url of files(root)) {
    const name=publicFile(root,url),size=(await fs.stat(name)).size;
    if (omittedModels.has(url)) {result.omittedModelBytes+=size;continue;}
    if (url.startsWith('/assets/') && !keep.has(url)) {result.unselectedAssetBytes+=size;continue;}
    if (url.startsWith('/asset-delivery/')) {
      const leaf=url.slice('/asset-delivery/'.length);
      if (leaf!=='report.json' && !hashName.test(leaf))continue;
      // Preserve every previously published hash present in the input. A
      // clean checkout normally contains only this build's generated variants.
      if (leaf.endsWith('.glb') || /\.glb\.(br|gz)$/.test(leaf)) {
        if(!current.has(url)) result.oldHashBytes+=size;
      }
    }
    if (!dryRun) {
      const target=publicFile(dest,url);
      await fs.mkdir(path.dirname(target),{recursive:true});
      await fs.copyFile(name,target,fs.constants.COPYFILE_FICLONE);
    }
    result.files++;result.bytes+=size;
  }
  return result;
}
