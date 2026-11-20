import { FramebufferTexture, Source } from 'three';

let installed = false;

/** r186 ViewportTextureNode keeps one FramebufferTexture clone per render target
 * for the glass viewport copy, but Texture.clone() shares the Source. Every
 * clone therefore reports the size written by whichever target drew last. A
 * target that changes to exactly that size is never reallocated, and its
 * framebuffer copy overruns the old allocation: a WebGPU validation error that
 * stops the scene. Latent while the mirror target stays smaller than the main
 * buffer; reachable as soon as any two such targets share a size. Give each
 * clone its own size. No per-frame cost.
 */
export function isolateFramebufferTextureSizes() {
  if (installed) return;
  installed = true;
  const clone = FramebufferTexture.prototype.clone;
  const isolated = function (this: FramebufferTexture) {
    const result = clone.call(this) as FramebufferTexture;
    result.source = new Source({ width: this.image.width, height: this.image.height });
    return result;
  };
  FramebufferTexture.prototype.clone = isolated as typeof clone;
}
