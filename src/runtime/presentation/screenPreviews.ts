import { TextureLoader, SRGBColorSpace } from 'three';

/** Small, real app captures; loaded before entry so idle/failed boots never show
 * an empty display. These textures are also valid in reflection cameras. */
export async function loadScreenPreviews(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const loader = new TextureLoader();
  const results = await Promise.allSettled(['founder', 'presentation'].map(async name => {
    const texture = await loader.loadAsync(`/screen-previews/${name}-v1.webp`);
    texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4; texture.flipY = false;
    return texture;
  }));
  const dispose = () => results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
  const failure = results.find(result => result.status === 'rejected');
  if (signal?.aborted || failure) { dispose(); signal?.throwIfAborted(); throw (failure as PromiseRejectedResult).reason; }
  const textures = results.map(result => (result as PromiseFulfilledResult<import('three').Texture>).value);
  return { founder: textures[0], presentation: textures[1], dispose };
}
