import { Texture } from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

// These are the repeated embedded images measured in the shipping room GLBs.
// Names only narrow the hash work. Actual encoded bytes establish identity.
const candidates = new Set([
  'portfolio_04', 'founder_art',
  'potted_plant_01_leaves_nor_gl_2k', 'potted_plant_01_leaves_diff_2k', 'potted_plant_01_leaves_rough_2k',
  'potted_plant_01_pot_nor_gl_2k', 'potted_plant_01_pot_diff_2k', 'potted_plant_01_pot_rough_2k',
]);
const identities = new WeakMap<Texture['source'], string>();

export function embeddedSourceKey(texture: Texture) {
  return identities.get(texture.source) ?? texture.source.uuid;
}

export async function identifySharedImages(parser: GLTFParser) {
  if (!globalThis.crypto?.subtle) return;
  const byImage = new Map<number, Set<Texture['source']>>();
  for (const [asset, association] of parser.associations) {
    if (!(asset instanceof Texture) || association.textures === undefined) continue;
    const def = parser.json.textures[association.textures];
    const index = def.extensions?.EXT_texture_webp?.source ?? def.source;
    const image = parser.json.images?.[index];
    if (!image || !candidates.has(image.name) || image.bufferView === undefined ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) continue;
    let sources = byImage.get(index);
    if (!sources) { sources = new Set(); byImage.set(index, sources); }
    sources.add(asset.source);
  }
  await Promise.all(Array.from(byImage, async ([index, sources]) => {
    const image = parser.json.images[index];
    let hash: ArrayBuffer;
    try {
      const bytes = await parser.getDependency('bufferView', image.bufferView);
      if (!(bytes instanceof ArrayBuffer)) return;
      hash = await crypto.subtle.digest('SHA-256', bytes);
    } catch {
      // Sharing is optional. A successfully decoded material can use its original source.
      return;
    }
    const key = image.mimeType + ':' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    for (const source of sources) identities.set(source, key);
  }));
}
