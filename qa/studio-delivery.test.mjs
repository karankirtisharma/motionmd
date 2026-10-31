import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyStudio } from '../scripts/verify-studio.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-studio-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, content) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  await write('app/studio/page.tsx', 'import "@/studio/data/catalog"; export default function Page(){return null;}');
  await write('app/studio/layout.tsx', 'import "@/studio/styles/test.css"; export default function Layout(){return null;}');
  await write('src/studio/data/catalog.ts', 'const formats=["film","brand"] as const; const industries=["tech","beauty"]; export const poster=(f:number,i:number)=>`/studio/media/films/${formats[f]}-${industries[i]}.jpg`;');
  await write('src/studio/styles/test.css', '.sample { background: url("/studio/media/frame.webp"); }');
  for (const a of ['film','brand']) for (const b of ['tech','beauty']) await write(`public/studio/media/films/${a}-${b}.jpg`, Buffer.from([255,216,255,217]));
  await write('public/studio/media/frame.webp', 'RIFF-fixture-WEBP');
  return { root, write };
}

test('studio verifier checks every generated poster and CSS resource, with no app execution', async t => {
  const {root,write}=await fixture(t);
  const report=verifyStudio(root);
  assert.equal(report.referencedMedia,5);
  assert.equal(report.mediaFiles,5);
  await fs.rm(path.join(root,'public/studio/media/films/brand-beauty.jpg'));
  assert.throws(()=>verifyStudio(root),/Missing copied media: \/studio\/media\/films\/brand-beauty.jpg/);
  await write('public/studio/media/films/brand-beauty.jpg','image');
  await fs.rm(path.join(root,'public/studio/media/frame.webp'));
  assert.throws(()=>verifyStudio(root),/Missing copied media: \/studio\/media\/frame.webp/);
});

test('studio verifier rejects hydrated-copy regressions and old or 3D asset references', async t => {
  const {root,write}=await fixture(t);
  await write('public/studio/media/frame.webp','version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 200\n');
  assert.throws(()=>verifyStudio(root),/Git LFS pointer instead of media/);
  await write('public/studio/media/frame.webp','image');
  await write('src/studio/data/fixture.json',JSON.stringify({poster:'/media/missed.jpg',model:'/assets/scene.glb'}));
  assert.throws(()=>verifyStudio(root),/Original \/media URL remains/);
  await write('src/studio/data/fixture.json',JSON.stringify({model:'/assets/scene.glb'}));
  assert.throws(()=>verifyStudio(root),/3D asset URL/);
});

test('studio verifier catches transitive runtime imports and validates local Next font files', async t => {
  const {root,write}=await fixture(t);
  await write('src/studio/components/Shared.ts','export {value} from "../../shared/value";');
  await write('src/shared/value.ts','import "three"; export const value=1;');
  assert.throws(()=>verifyStudio(root),/3D\/runtime import.*three/);
  await write('src/shared/value.ts','export const value=1;');
  await write('app/studio/layout.tsx','import localFont from "next/font/local"; const font=localFont({src:[{path:"../../src/studio/fonts/ui.woff2",weight:"400"}]}); export default function Layout(){return null;}');
  assert.throws(()=>verifyStudio(root),/Missing local font/);
  await write('src/studio/fonts/ui.woff2','wOF2-fixture');
  assert.equal(verifyStudio(root).localFonts,1);
});

test('studio verifier fails closed for unresolved dynamic media paths', async t => {
  const {root,write}=await fixture(t);
  await write('src/studio/data/unknown.ts','export const poster=(name:string)=>`/studio/media/${name}.jpg`;');
  assert.throws(()=>verifyStudio(root),/Cannot statically verify dynamic media/);
});

test('lounge-only shells stay isolated, but importing one from studio fails the boundary', async t => {
  const {root,write}=await fixture(t);
  await write('src/studio/components/LoungeEntry.tsx','import "three"; export default function Entry(){return null;}');
  assert.equal(verifyStudio(root).mediaFiles,5);
  await write('app/studio/page.tsx','export { default } from "@/studio/components/LoungeEntry";');
  assert.throws(()=>verifyStudio(root),/3D\/runtime import.*three/);
});
