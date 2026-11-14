import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { CubeRenderTarget } from 'three/webgpu';
import { prepareSkyBackground } from '../src/runtime/rendering/prepareSkyBackground.ts';

for (const fail of [false, true]) test('sky conversion preserves source resolution and restores borrowed state: failure=' + fail, t => {
  const source = new Texture({ width: 2048, height: 1024 }); source.generateMipmaps = false;
  const originalFilter = source.minFilter, originalTarget = {}, originalMRT = {};
  let active = originalTarget, mrt = originalMRT, face = 2, level = 1, disposed = 0, conversion;
  const renderer = { getRenderTarget:()=>active, getActiveCubeFace:()=>face, getActiveMipmapLevel:()=>level, getMRT:()=>mrt,
    setRenderTarget:(t,f,l)=>{active=t;face=f;level=l;},setMRT:v=>{mrt=v;} };
  t.mock.method(CubeRenderTarget.prototype,'fromEquirectangularTexture',function(r,s){
    assert.equal(r,renderer);assert.equal(s,source);assert.equal(this.width,1024);assert.equal(this.height,1024);
    conversion=this;this.addEventListener('dispose',()=>disposed++); r.setRenderTarget(this,5,0);r.setMRT(null);
    s.minFilter=123;s.generateMipmaps=true;if(fail)throw Error('conversion failed');return this;
  });
  if(fail)assert.throws(()=>prepareSkyBackground(renderer,source),/conversion failed/);
  else {const result=prepareSkyBackground(renderer,source);assert.equal(result,conversion);assert.equal(disposed,0);result.dispose();}
  assert.equal(disposed,1);assert.equal(active,originalTarget);assert.equal(mrt,originalMRT);assert.equal(face,2);assert.equal(level,1);
  assert.equal(source.minFilter,originalFilter);assert.equal(source.generateMipmaps,false);
});
