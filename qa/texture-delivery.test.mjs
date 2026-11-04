import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prefersWebP } from '../src/server/imageEncoding.ts';
import verified from '../scripts/verified-texture-images.json' with { type: 'json' };
import variants from '../src/generated/texture-delivery.json' with { type: 'json' };

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('texture negotiation respects media ranges, explicit exclusions and PNG preference', () => {
  for (const [header, expected] of [[null,false],['image/png',false],['image/webp',true],['*/*',true],['image/*',true],['image/avif,image/webp,image/apng,*/*;q=0.8',true],['image/webp;q=0,*/*;q=1',false],['image/png,*/*',false],['image/webp;q=0.4,image/png;q=0.7',false]]) {
    assert.equal(prefersWebP(header),expected,String(header));
  }
});
test('generated external textures retain the browser-verified original RGBA bytes, dimensions and alpha', async () => {
  for (const [url, proof] of Object.entries(verified)) {
    const source = await fs.readFile(new URL('../public'+url,import.meta.url));
    if (digest(source) !== proof.source || process.env.NEXT_PUBLIC_ASSET_BASE_URL || process.env.MD_GEOMETRY_STORAGE === '0') { assert.equal(variants[url],undefined); continue; }
    const entry = variants[url]; assert.ok(entry,url);
    const output = await fs.readFile(new URL('../public'+entry.webp,import.meta.url));
    assert.equal(digest(output),proof.webp); assert.ok(output.length < source.length);
    const a = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const b = await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.deepEqual(a.info,b.info,url); assert.ok(a.data.equals(b.data),url);
  }
});
