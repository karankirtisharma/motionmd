import { PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { mrt, output, pass, velocity, vec4 } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/** Reproject live 3D samples, including the animated visitor's velocity.
 * HDR history is resolved before the existing source OCIO display transform.
 */
export function createTemporalRenderer(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const scenePass = pass(scene, camera, { samples: 0 });
  const sceneMRT=mrt({ output, velocity });
  scenePass.setMRT(sceneMRT);
  const temporal = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
  // Prefer stable subpixel lines over the optional sharper square-pattern correction.
  temporal.useSubpixelCorrection = false;
  const pipeline = new RenderPipeline(renderer);
  // TRAA's internal opaque resolve forces alpha to one. Preserve the current
  // scene's depth-tested DOM opening while keeping the existing temporal RGB.
  pipeline.outputNode = vec4(temporal.rgb, scenePass.getTextureNode('output').a);
  return {
    async warmup(onProgress?: Parameters<WebGPURenderer['compileAsync']>[3], signal?: AbortSignal) {
      // Compile the actual velocity/HDR pass once. A separate screen-output
      // compilation doubles shader work and produces shaders we never render.
      const previousTarget=renderer.getRenderTarget(),previousMRT=renderer.getMRT();
      try {
        renderer.setRenderTarget(scenePass.renderTarget);renderer.setMRT(sceneMRT);
        await renderer.compileAsync(scene,camera,null,onProgress);
      } finally {renderer.setRenderTarget(previousTarget);renderer.setMRT(previousMRT);}
      signal?.throwIfAborted();
      // The caller submits the first temporal sample once the live reflection
      // exists. Drawing here would seed history with an uninitialized mirror.
    },
    render() { pipeline.render(); },
    // Debug parity uses the identical glass viewport-copy format and render context.
    getAuditTarget() { return { target: scenePass.renderTarget, mrt: sceneMRT }; },
    async finishFirstFrame() {
      // One asynchronous pixel read is a public, backend-neutral completion fence.
      // Submitting a frame alone does not mean its driver compilation is finished.
      // Keep the loading screen until prior GPU work completes; never read per frame.
      await renderer.readRenderTargetPixelsAsync(scenePass.renderTarget, 0, 0, 1, 1);
    },
    reset() {
      // TRAANode.setSize is a public implementation method in pinned r186.
      // A size mismatch reseeds history from the current frame on the next resolve.
      (temporal as typeof temporal & { setSize(width: number, height: number): void }).setSize(1, 1);
    },
    dispose() { pipeline.dispose(); temporal.dispose(); scenePass.dispose(); },
  };
}
