import type { Texture } from 'three';
import { CubeRenderTarget, type WebGPURenderer } from 'three/webgpu';

/** Complete the stock equirectangular conversion before shader discovery can
 * skip its six draws. Otherwise r186's CubeMapNode caches empty cube faces. */
export function prepareSkyBackground(renderer: WebGPURenderer, source: Texture) {
  const image = source.image as { height?: number } | null;
  const height = image?.height;
  if (!height || !Number.isInteger(height) || height < 1) throw new Error('Sky image is not ready for conversion.');
  const target = new CubeRenderTarget(height);
  const previous = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
    level: renderer.getActiveMipmapLevel(), mrt: renderer.getMRT(),
    filter: source.minFilter, mipmaps: source.generateMipmaps };
  try {
    target.fromEquirectangularTexture(renderer, source);
    return target;
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    source.minFilter = previous.filter; source.generateMipmaps = previous.mipmaps;
    renderer.setRenderTarget(previous.target, previous.face, previous.level);
    renderer.setMRT(previous.mrt);
  }
}
