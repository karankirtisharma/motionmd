import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
if(process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim()) {
  const origin=new URL(process.env.NEXT_PUBLIC_ASSET_BASE_URL);
  if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw new Error('Asset base must be a public HTTP(S) URL without credentials.');
  console.log('External asset origin configured; upload the complete assets/ release before deploying.');
} else {
  const assets=path.join(root,'public/assets');
  const manifest=JSON.parse(fs.readFileSync(path.join(assets,'scene-manifest.json'),'utf8'));
  const required=new Set();
  function collect(value){
    if(typeof value==='string'&&value.startsWith('/assets/'))required.add(value);
    else if(Array.isArray(value))value.forEach(collect);
    else if(value&&typeof value==='object')Object.values(value).forEach(collect);
  }
  collect(manifest);
  for(const url of required){
    const file=path.resolve(root,'public','.'+url);
    if(!file.startsWith(assets+path.sep)||!fs.existsSync(file))throw new Error(`Missing scene asset: ${url}. Run git lfs pull before building.`);
  }
  const pointers=[];let files=0,bytes=0;
  function inspect(dir){
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name);
      if(item.isDirectory()){inspect(file);continue;}
      if(!item.isFile())continue;
      const head=Buffer.alloc(128),fd=fs.openSync(file,'r');
      try {fs.readSync(fd,head,0,128,0);} finally {fs.closeSync(fd);}
      if(head.toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1'))pointers.push(path.relative(root,file));
      files++;bytes+=fs.statSync(file).size;
    }
  }
  inspect(assets);
  if(pointers.length)throw new Error(`${pointers.length} scene files are Git LFS pointers instead of assets. In Vercel: Settings > Git > Git LFS, enable it, then redeploy. Locally: git lfs install && git lfs pull. First file: ${pointers[0]}`);
  console.log(`Scene assets ready: ${files} files, ${(bytes/1e6).toFixed(1)} MB; ${manifest.chunks.length} source geometry chunks.`);
}
