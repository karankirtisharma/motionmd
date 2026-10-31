import type { GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

export const GALLERY_ALBEDO_CHUNK = '/assets/architecture-v16/gallery.glb';
export const REPLACED_GALLERY_ALBEDO = '/assets/v2/textures/gallery-architecture-base.ktx2';
const REPLACED_MATERIALS = new Set([
  'gallery__EH54 | scanned cream limestone panels',
  'gallery__EH54 | polished warm-grey cloud marble',
]);
type Definition = Record<string, unknown>;
const record = (value: unknown): value is Definition => !!value && typeof value === 'object' && !Array.isArray(value);

/** Drop only the two albedo bindings replaced unconditionally by the source
 * wall/floor graphs in applyMaterialManifest, before the loader requests images.
 * Any unfamiliar consumer or asset layout keeps the original payload intact.
 * Original GLB/image files and every other material property remain untouched.
 */
export function omitReplacedGalleryAlbedo(json: unknown, chunkURL: string): number {
  if (chunkURL !== GALLERY_ALBEDO_CHUNK || !record(json)) return 0;
  const { images, textures, materials } = json;
  if (!Array.isArray(images) || !Array.isArray(textures) || !Array.isArray(materials)) return 0;
  const matchingImages = images.flatMap((image, index) => record(image) && image.uri === REPLACED_GALLERY_ALBEDO && image.mimeType === 'image/ktx2' ? [index] : []);
  if (matchingImages.length !== 1) return 0;
  const imageIndex = matchingImages[0];
  const textureIndices = new Set<number>();
  for (let index = 0; index < textures.length; index++) {
    const definition: unknown = textures[index];
    if (!record(definition)) return 0;
    const extensions = record(definition.extensions) ? definition.extensions : {};
    const basis = extensions.KHR_texture_basisu;
    if (record(basis) && basis.source === imageIndex) {
      // No alternative/fallback source or unfamiliar texture extension may be
      // silently discarded if the export changes in a later release.
      if (definition.source !== undefined || Object.keys(extensions).some(name => name !== 'KHR_texture_basisu')) return 0;
      textureIndices.add(index);
    } else if (definition.source === imageIndex || Object.values(extensions).some(value => record(value) && value.source === imageIndex)) return 0;
  }
  if (textureIndices.size !== 2) return 0;
  const replacements: Definition[] = [];
  const allowedBindings = new Set<unknown>();
  for (const name of REPLACED_MATERIALS) {
    const targets = materials.filter(material => record(material) && material.name === name);
    if (targets.length !== 1) return 0;
    const material = targets[0] as Definition;
    const pbr = material.pbrMetallicRoughness;
    if (!record(pbr) || !record(pbr.baseColorTexture) || !textureIndices.has(pbr.baseColorTexture.index as number)) return 0;
    replacements.push(pbr); allowedBindings.add(pbr.baseColorTexture);
  }
  // Search all material extensions too: if another slot/material uses either
  // texture, keep both bindings. This is conservative across future exports.
  let unfamiliarConsumer = false, consumers = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!record(value)) return;
    if (textureIndices.has(value.index as number)) {
      consumers++;
      if (!allowedBindings.has(value)) unfamiliarConsumer = true;
    }
    Object.values(value).forEach(visit);
  };
  materials.forEach(visit);
  if (unfamiliarConsumer || consumers !== 2) return 0;
  replacements.forEach(pbr => { delete pbr.baseColorTexture; });
  return replacements.length;
}

/** Register for one parse and unregister in finally; no cross-chunk state. */
export function createReplacedGalleryAlbedoPlugin(chunkURL: string) {
  return (parser: GLTFParser): GLTFLoaderPlugin => ({
    name: 'MD_replaced_gallery_albedo',
    beforeRoot: () => {
      const removed = omitReplacedGalleryAlbedo(parser.json, chunkURL);
      if (removed) console.info('[MD textures] omitted superseded gallery albedo', { bindings: removed, url: REPLACED_GALLERY_ALBEDO });
      return null;
    },
  });
}
