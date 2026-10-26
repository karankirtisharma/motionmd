import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAssetEncoding } from '../src/server/assetEncoding.ts';

test('delivery negotiates weights, identity fallback and explicit exclusions', () => {
  for (const [header, expected] of [
    [null,'identity'], ['', 'identity'], ['gzip, deflate, br', 'br'],
    ['gzip;q=1, br;q=0.5','gzip'], ['br;q=0, gzip','gzip'],
    ['br;q=0, gzip;q=0','identity'], ['br;q=0,*;q=1','gzip'],
    ['identity;q=1,br;q=0.5','identity'], ['*;q=0',null],
    ['br;q=0,gzip;q=0,identity;q=0',null], ['br;q=nope','identity'],
    ['BR; q=1, GZIP; q=0.5','br'],
  ]) assert.equal(selectAssetEncoding(header), expected, String(header));
});
