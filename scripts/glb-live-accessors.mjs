import assert from 'node:assert/strict';
import { readGLB } from './glb-storage.mjs';
import { writeGLB } from './glb-images.mjs';

// Only static core mesh references are rewritten. Materials and texture-format
// extensions below never refer to accessors or buffer views by index.
const supported = new Set([
  'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu', 'EXT_texture_webp',
  'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_emissive_strength',
  'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_anisotropy', 'KHR_materials_ior',
  'KHR_materials_volume',
]);

function indexMap(items, keep) {
  let next = 0;
  return items.map((_, i) => keep.has(i) ? next++ : -1);
}
function mapped(map, index) {
  const result = map[index];
  assert.ok(Number.isInteger(result) && result >= 0, 'Invalid or unresolved glTF reference: ' + index);
  return result;
}

/** Previous exports appended corrected geometry to merged room meshes but kept
 * superseded, anonymous streams in the GLB. Keep every primitive and every
 * image. Rewrite only core references to the surviving accessors and views. */
export function pruneUnusedGeometry(source) {
  const { json, binary } = readGLB(source);
  const unchanged = { buffer: source, removedAccessors: 0, removedViews: 0 };
  if (!json.accessors?.length || !json.bufferViews?.length || json.skins?.length || json.animations?.length ||
      [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])].some(ext => !supported.has(ext))) return unchanged;

  const liveAccessors = new Set(), liveViews = new Set();
  const primitives = (json.meshes ?? []).flatMap(mesh => mesh.primitives);
  for (const p of primitives) {
    if (p.indices !== undefined) liveAccessors.add(p.indices);
    for (const attrs of [p.attributes, ...(p.targets ?? [])]) for (const i of Object.values(attrs)) liveAccessors.add(i);
  }
  // Preserve any intentionally named or annotated library data, even if no mesh
  // uses it. Anonymous, in-bounds but unused storage may be omitted from delivery.
  json.accessors.forEach((a,i) => { if (a.name || a.extras || a.extensions) liveAccessors.add(i); });
  for (const i of liveAccessors) {
    const a = json.accessors[i];
    assert.ok(a, 'Invalid mesh accessor ' + i);
    for (const ref of [a, a.sparse?.indices, a.sparse?.values]) if (ref?.bufferView !== undefined) liveViews.add(ref.bufferView);
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) liveViews.add(image.bufferView);
  json.bufferViews.forEach((view, i) => { if (view.name || view.extras) liveViews.add(i); });
  if (liveAccessors.size === json.accessors.length && liveViews.size === json.bufferViews.length) return unchanged;
  const accessors = indexMap(json.accessors, liveAccessors), views = indexMap(json.bufferViews, liveViews);
  for (const p of primitives) {
    if (p.indices !== undefined) p.indices = mapped(accessors, p.indices);
    for (const attrs of [p.attributes, ...(p.targets ?? [])]) for (const key of Object.keys(attrs)) attrs[key] = mapped(accessors, attrs[key]);
  }
  for (const i of liveAccessors) {
    const a = json.accessors[i];
    for (const ref of [a, a.sparse?.indices, a.sparse?.values]) if (ref?.bufferView !== undefined) ref.bufferView = mapped(views, ref.bufferView);
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = mapped(views, image.bufferView);
  const removedAccessors = json.accessors.length - liveAccessors.size, removedViews = json.bufferViews.length - liveViews.size;
  json.accessors = json.accessors.filter((_,i) => liveAccessors.has(i));
  json.bufferViews = json.bufferViews.filter((_,i) => liveViews.has(i));
  // The existing compactGLB pass copies and verifies only the referenced BIN
  // ranges after image and meshopt re-encoding. No live stream is reconstructed.
  return { buffer: writeGLB(json, binary), removedAccessors, removedViews };
}
