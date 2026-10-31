import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, DepthTexture, DirectionalLight, FloatType, Group, Mesh, MeshBasicMaterial, PCFShadowMap, RenderTarget, Scene, SkinnedMesh, VSMShadowMap } from 'three';
import { ShadowNode } from 'three/webgpu';
import { StaticSunShadowCache } from '../src/runtime/rendering/staticSunShadowCache.ts';
import { freezeArchitectureTransforms } from '../src/runtime/rendering/staticTransforms.ts';

// A deterministic tiny depth rasterizer tests composition and draw dispatch. It
// is deliberately NOT a GPU/image parity claim: real-device QA must also pass.
function fixture(reversed = false) {
  const scene = new Scene(), architecture = new Group(), lift = new Group();
  scene.add(architecture); lift.userData.liftRole = 'cabin'; architecture.add(lift);
  const object = (name, parent, pixels) => {
    const mesh = new Mesh(undefined, new MeshBasicMaterial()); mesh.name = name; mesh.castShadow = true;
    mesh.userData.pixels = pixels; parent.add(mesh); return mesh;
  };
  const stone = object('stone', architecture, [[0,.6,1],[1,.6,1],[3,.4,1]]);
  const cutout = object('cutout', architecture, [[1,.2,0],[2,.5,1]]); cutout.material.alphaTest = .5;
  const cabin = object('cabin', lift, [[0,.4,1]]);
  const avatar = object('avatar', scene, [[0,.2,1],[1,.8,1],[2,.3,1]]);
  const chair = object('chair', scene, [[3,.7,1]]);
  const noncaster = object('noncaster', scene, [[1,.1,1]]); noncaster.castShadow = false;
  const sun = new DirectionalLight(); scene.add(sun, sun.target); sun.position.set(1,3,2);
  sun.shadow.mapSize.set(4,1); scene.updateMatrixWorld(true);
  const frozen = freezeArchitectureTransforms(architecture);
  const node = new StaticSunShadowCache(sun, {isStatic:frozen.has});
  const original = new ShadowNode(sun,sun.shadow);
  const target = () => new RenderTarget(4,1,{depthTexture:new DepthTexture(4,1)});
  node.shadowMap = target(); original.shadowMap = target();
  const output = new Map(); let bound=node.shadowMap, callback=null;
  const calls=[];
  function pixels(map) {
    if (!output.has(map) || output.get(map).depth.length !== map.width*map.height) output.set(map,{depth:Array(map.width*map.height).fill(reversed?0:1),color:Array(map.width*map.height).fill(null)});
    return output.get(map);
  }
  const renderer = {
    backend:{isWebGPUBackend:true}, shadowMap:{type:PCFShadowMap,transmitted:false}, reversedDepthBuffer:reversed,
    autoClear:true, getMRT:()=>null, initRenderTarget:map=>{pixels(map);},
    getRenderTarget:()=>bound, setRenderTarget:map=>{bound=map;},
    getRenderObjectFunction:()=>callback, setRenderObjectFunction:fn=>{callback=fn;},
    copyTextureToTexture(source,destination){
      if(this.throwCopy)throw new Error('simulated unsupported copy');
      assert.notEqual(source,destination); assert.equal(source.type,destination.type); assert.equal(source.format,destination.format);
      assert.equal(source.image.width,destination.image.width);assert.equal(source.image.height,destination.image.height);
      const slot=source.isDepthTexture?'depth':'color';pixels(destination.renderTarget)[slot]=[...pixels(source.renderTarget)[slot]];
      calls.push(['copy',slot]);
    },
    render(scene,camera){
      const record=pixels(bound);
      if(this.autoClear){record.depth.fill(reversed?0:1);record.color.fill(null);}
      calls.push(['pass',scene.name,this.autoClear]);
      scene.traverseVisible(object=>{if(object.isMesh&&object.layers.test(camera.layers))callback(object,scene,camera,object.geometry,object.material,null,null,null);});
    },
    renderObject(object,scene,camera,geometry,material){
      calls.push(['draw',object.name]); const record=pixels(bound);
      for(const [index,z,alpha] of object.userData.pixels){
        if(alpha<material.alphaTest)continue;
        const depth=reversed?1-z:z;
        if(reversed?depth>=record.depth[index]:depth<=record.depth[index]){record.depth[index]=depth;record.color[index]=alpha;}
      }
    },
  };
  callback=node.getShadowRenderObjectFunction(renderer,sun.shadow);
  const frame={renderer,scene};
  function cached(){renderer.setRenderTarget(node.shadowMap);node.renderShadow(frame);return structuredClone(pixels(node.shadowMap));}
  function baseline(){renderer.setRenderTarget(original.shadowMap);original.renderShadow(frame);return structuredClone(pixels(original.shadowMap));}
  return {scene,architecture,lift,stone,cutout,cabin,avatar,chair,sun,frozen,node,original,renderer,calls,cached,baseline};
}

for(const reversed of [false,true])test(`static+dynamic depth equals complete stock pass; reverse-Z=${reversed}`,()=>{
  const f=fixture(reversed);
  for(let frame=0;frame<9;frame++){
    f.avatar.userData.pixels=frame%2?[[3,.1,1]]:[[0,.2,1],[1,.8,1],[2,.3,1]];
    f.cabin.userData.pixels=frame%3?[[1,.3,1]]:[[0,.4,1]];
    f.chair.visible=frame<5;
    assert.deepEqual(f.cached(),f.baseline(),`moving/overlapping/absent casters frame ${frame}`);
  }
  assert.equal(f.node.stats.staticPasses,1);assert.equal(f.node.stats.dynamicPasses,9);assert.equal(f.node.stats.cacheHits,8);
  f.calls.length=0;f.cached();
  assert.deepEqual(f.calls.filter(c=>c[0]==='draw').map(c=>c[1]),['cabin','avatar']);
  assert.deepEqual(f.calls.filter(c=>c[0]==='copy'),[['copy','color'],['copy','depth']]);
});

test('frozen membership includes only immutable architecture; lift, rig and detached chair remain live',()=>{
  const f=fixture();assert.equal(f.frozen.has(f.stone),true);assert.equal(f.frozen.has(f.cutout),true);
  for(const moving of [f.lift,f.cabin,f.avatar,f.chair,new Bone(),new SkinnedMesh()])assert.equal(f.frozen.has(moving),false);
  f.frozen.restore();assert.equal(f.frozen.has(f.stone),false);
});

test('static edits, light transforms, projection, layers, dimensions and attachment types invalidate',()=>{
  const f=fixture();f.cached();let passes=1;
  const edits=[
    ()=>{f.stone.visible=false;f.node.invalidate('visibility');},
    ()=>{f.cutout.material.alphaTest=0;f.node.invalidate('material');},
    ()=>{f.stone.userData.pixels=[[2,.1,1]];f.stone.visible=true;f.node.invalidate('geometry');},
    ()=>{f.sun.position.x+=1;f.scene.updateMatrixWorld(true);},
    ()=>{f.sun.shadow.camera.left-=1;f.sun.shadow.camera.updateProjectionMatrix();},
    ()=>{f.sun.shadow.camera.layers.enable(1);},
    ()=>{f.sun.shadow.mapSize.set(8,1);},
    ()=>{f.node.shadowMap.depthTexture.type=FloatType;},
  ];
  for(const edit of edits){edit();assert.deepEqual(f.cached(),f.baseline());assert.equal(f.node.stats.staticPasses,++passes);}
});

test('opt-out and unsupported backend, PCF, transmission or multi-sample paths use complete stock pass',()=>{
  const variations=[
    f=>f.node.setEnabled(false),f=>{f.renderer.backend.isWebGPUBackend=false;},
    f=>{f.renderer.shadowMap.type=VSMShadowMap;},f=>{f.renderer.shadowMap.transmitted=true;},
    f=>{f.node.shadowMap.samples=4;},f=>{f.node.shadowMap.depth=2;},
    f=>{f.node.shadowMap.stencilBuffer=true;},
  ];
  for(const edit of variations){const f=fixture();edit(f);assert.deepEqual(f.cached(),f.baseline());assert.equal(f.node.stats.stockPasses,1);assert.equal(f.node.stats.staticPasses,0);assert.equal(f.calls.some(c=>c[0]==='copy'),false);}
  const f=fixture();f.cached();f.node.setEnabled(false);f.cached();f.stone.visible=false;f.node.setEnabled(true);
  assert.equal(f.sun.shadow.needsUpdate,true);assert.deepEqual(f.cached(),f.baseline());assert.equal(f.node.stats.staticPasses,2);
});

test('copy failure restores renderer state and rebuilds full shadow immediately, without repeated failure work',()=>{
  const f=fixture();const before=f.renderer.getRenderObjectFunction();const name=f.scene.name;
  f.renderer.throwCopy=true;assert.deepEqual(f.cached(),f.baseline());
  assert.equal(f.renderer.getRenderObjectFunction(),before);assert.equal(f.renderer.autoClear,true);assert.equal(f.scene.name,name);
  assert.match(f.node.stats.failed,/simulated unsupported copy/);assert.equal(f.node.stats.stockPasses,1);
  assert.deepEqual(f.cached(),f.baseline());assert.equal(f.node.stats.staticPasses,1);assert.equal(f.node.stats.stockPasses,2);
});

test('shadow target ownership is separate and cached attachments are disposed with the node',()=>{
  const f=fixture();f.cached();const snapshot=f.node.snapshot;
  assert.notEqual(snapshot,f.node.shadowMap);assert.notEqual(snapshot.depthTexture,f.node.shadowMap.depthTexture);
  assert.notEqual(snapshot.texture.source,f.node.shadowMap.texture.source);
  let count=0;snapshot.addEventListener('dispose',()=>count++);f.node.dispose();assert.equal(count,1);assert.equal(f.node.stats.cachedWidth,0);
});
