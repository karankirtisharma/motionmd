import test from 'node:test';
import assert from 'node:assert/strict';
import { architectureProgress } from '../src/runtime/rendering/loadingProgress.ts';
test('loading distinguishes encoded delivery from decoded preparation in decimal MB',()=>{
  const result=architectureProgress(227023076,458500320,{encodedBytes:267533636,decodedBytes:454046152,encoding:'br'});
  assert.equal(result.detail,'Scene files: 267.5 MB compressed · 454.0 MB unpacked');
  assert.equal(result.progress,.5);
  assert.equal(architectureProgress(454046152,458500320,{encodedBytes:267533636,decodedBytes:454046152,encoding:'br'}).progress,1);
});
test('external origins without delivery metadata label only unpacked data',()=>{
  assert.equal(architectureProgress(1000000,458500320).detail,'Unpacking scene: 1.0 / 458.5 MB');
  assert.equal(architectureProgress(454046152,458500320,{encodedBytes:454046152,decodedBytes:454046152,encoding:'identity'}).detail,'Scene files: 454.0 MB · 454.0 MB unpacked');
});
