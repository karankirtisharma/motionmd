import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture} from 'three';
import {filterTemporaryEnvironment} from '../src/runtime/rendering/temporaryEnvironment.ts';
import {smoothSupportHeight} from '../src/runtime/interaction/movement.ts';
test('temporary HDR is released after filtering and also when filtering fails',()=>{
 for(const fails of [false,true]){
  const source=new Texture();let disposed=0;source.addEventListener('dispose',()=>disposed++);
  const target={texture:new Texture()};
  const filter=texture=>{assert.equal(texture,source);assert.equal(disposed,0);if(fails)throw Error('GPU interrupted');return target;};
  if(fails)assert.throws(()=>filterTemporaryEnvironment(source,filter),/GPU interrupted/);
  else assert.equal(filterTemporaryEnvironment(source,filter),target);
  assert.equal(disposed,1);
 }
});
test('visual stair support never sinks below physical support at any display frequency',()=>{
 for(const hz of [30,60,90,120,144,165]){
  let y=0;for(let frame=0;frame<hz*4;frame++){
   const physical=Math.floor(frame/hz*4)*.15;
   y=smoothSupportHeight(y,physical,1/hz);assert.ok(y>=physical-1e-12);
  }
  for(let frame=0;frame<hz;frame++){y=smoothSupportHeight(y,0,1/hz);assert.ok(y>=0);}
  assert.equal(smoothSupportHeight(0,4,1/hz),4);
 }
});
