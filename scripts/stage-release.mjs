import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageReleasePublic } from './release-public.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const dryRun=args.length===1 && args[0]==='--dry-run';
if (!dryRun && (args.length!==1 || args[0].startsWith('-'))) throw Error('Pass --dry-run or one new, separate destination directory.');
if (process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim()) throw Error('This stages local delivery. External CDN builds keep their separate release contract.');
const entries=JSON.parse(await fs.readFile(path.join(root,'src/generated/asset-delivery.json'),'utf8'));
const result=await stageReleasePublic(path.join(root,'public'),dryRun ? path.join(root,'.md-stage-summary') : args[0],entries,{dryRun});
console.log('Release public staging:',JSON.stringify(result));
