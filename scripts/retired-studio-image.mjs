import assert from 'node:assert/strict';
import { readGLB } from './glb-storage.mjs';
import { writeGLB } from './glb-images.mjs';

// Only this audited original used this globe exclusively on the runtime TV.
// Reauthored GLBs, changed screen bindings and source-mode delivery retain it.
export function hasRetiredStudioImage(url, sourceSHA256, screenName) {
  return url === '/assets/architecture-v16/lounge.glb' &&
    sourceSHA256 === '7591440300646f6910d1f3a0da8e0dd4d989f772ce3861f6dc7a872da03a036a' &&
    screenName === 'PL78 | curved LED pixel surface';
}

/** Run on the verified master before the ordinary mesh/image compaction.
 * No vertex/UV data, materials shared with the room or source files change. */
export function omitRetiredStudioImage(source) {
  const {json,binary} = readGLB(source);
  const imageIndex=json.images.length-1, image=json.images[imageIndex];
  const materialIndex=json.materials.findIndex(m => m.name==='PL78 | golden globe presentation display');
  const material=json.materials[materialIndex], slot=material.pbrMetallicRoughness;
  const textureIds=[material.emissiveTexture.index,slot.baseColorTexture.index];
  assert.equal(image.name,'golden_globe_display');
  assert.deepEqual(textureIds,[json.textures.length-2,json.textures.length-1]);
  assert.ok(textureIds.every(i => json.textures[i].source===imageIndex));
  const owners=json.meshes.flatMap((mesh,i) => mesh.primitives.filter(primitive => primitive.material===materialIndex).map(()=>i));
  assert.equal(owners.length,1);
  assert.deepEqual(json.nodes.filter(node => node.mesh===owners[0]).map(node => node.extras?.sourceName),['PL78 | curved LED pixel surface']);
  assert.equal(json.images.filter(other=>other.bufferView===image.bufferView).length,1);
  assert.ok(!json.accessors.some(a=>a.bufferView===image.bufferView || a.sparse?.indices.bufferView===image.bufferView || a.sparse?.values.bufferView===image.bufferView));
  delete material.emissiveTexture;
  delete slot.baseColorTexture;
  json.textures.splice(textureIds[0],2);
  json.images.pop();
  json.bufferViews.splice(image.bufferView,1);
  // Preserve later accessor, sparse and extension references after removing
  // the image-only view. compactGLB() then drops its unreferenced BIN bytes.
  const renumberViews=value=>{
    if (!value || typeof value!=='object') return;
    for (const [key,child] of Object.entries(value)) {
      if (key==='bufferView' && typeof child==='number') {
        assert.notEqual(child,image.bufferView,'retired view has another consumer');
        if (child>image.bufferView) value[key]=child-1;
      } else renumberViews(child);
    }
  };
  renumberViews(json);
  return {buffer:writeGLB(json,binary), retiredImage:{materialIndex,view:image.bufferView,imageIndex,textureIds}};
}
