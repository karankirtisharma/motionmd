import { PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { mrt, output, pass, velocity } from 'three/tsl';
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
  pipeline.outputNode = temporal;
  return {
    async warmup(onProgress?: Parameters<WebGPURenderer['compileAsync']>[3]) {
      // Compile the actual velocity/HDR pass once. A separate screen-output
      // compilation doubles shader work and produces shaders we never render.
      const previousTarget=renderer.getRenderTarget(),previousMRT=renderer.getMRT();
      try {
        renderer.setRenderTarget(scenePass.renderTarget);renderer.setMRT(sceneMRT);
        await renderer.compileAsync(scene,camera,null,onProgress);
      } finally {renderer.setRenderTarget(previousTarget);renderer.setMRT(previousMRT);}
      pipeline.render();
    },
    render() { pipeline.render(); },
    reset() {
      // TRAANode.setSize is a public implementation method in pinned r186.
      // A size mismatch reseeds history from the current frame on the next resolve.
      (temporal as typeof temporal & { setSize(width: number, height: number): void }).setSize(1, 1);
    },
    dispose() { pipeline.dispose(); temporal.dispose(); scenePass.dispose(); },
  };
}
