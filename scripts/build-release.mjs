import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageReleasePublic } from './release-public.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// Public is a fixed Next/Vercel convention. Switch it only inside a disposable
// hosted build checkout; local vercel build and ordinary npm run build never
// change which directory contains the developer's source assets.
const hosted=process.env.VERCEL==='1' && /^\/vercel\/path\d+(?:\/|$)/.test(await fs.realpath(root)) && !process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim();
const publicDir=path.join(root,'public'),work=path.join(root,'.md-release-work'),master=path.join(work,'original-public');
const env={...process.env,...(hosted ? {MD_VERIFY_RELEASE_INPUTS:'1'} : {})};
function run(file,args=[]) {
  const result=spawnSync(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw Error('Failed: '+file+' ('+(result.status??result.signal)+')');
}
async function exists(file) {
  try {await fs.access(file);return true;} catch(e) {if(e.code==='ENOENT')return false;throw e;}
}

if(hosted) {
  await fs.mkdir(work,{recursive:true});
  // A retry in the same hosted checkout starts with the untouched masters.
  if(await exists(master)) {
    if(await exists(publicDir)) {
      const previous=await fs.mkdtemp(path.join(work,'prior-'));
      await fs.rename(publicDir,path.join(previous,'public'));
    }
    await fs.rename(master,publicDir);
  }
}
for(const script of ['verify-assets','verify-studio','prepare-delivery']) run(path.join(root,'scripts',script+'.mjs'));
if(hosted) {
  const temp=await fs.mkdtemp(path.join(work,'stage-')),staged=path.join(temp,'public');
  const entries=JSON.parse(await fs.readFile(path.join(root,'src/generated/asset-delivery.json'),'utf8'));
  const result=await stageReleasePublic(publicDir,staged,entries);
  await fs.rename(publicDir,master);
  try {await fs.rename(staged,publicDir);}
  catch(error) {await fs.rename(master,publicDir);throw error;}
  console.log('Verified hosted public artifact:',JSON.stringify(result));
}
run(path.join(root,'node_modules/next/dist/bin/next'),['build']);
