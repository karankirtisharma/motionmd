import { prepareRenderSlices } from './prepareRenderSlices.ts';
import { type DirectionalLightShadow, type Object3D, PerspectiveCamera, RenderTarget, Scene, Vector2 } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { mrt, output, pass, velocity, vec4, uniform, uv } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { nativeScreenSampleOffset } from './nativeScreenSampleOffset.ts';

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
  // The browser projects native displays with the stable camera. TRAA jitters
  // the beauty/depth draw by a subpixel each frame, so using its raw alpha makes
  // screen openings and foreground silhouettes shimmer against that document.
  // Sample the current alpha back in unjittered screen space; never accumulate
  // browser cutouts in temporal history. No second scene draw or readback.
  const sampleOffset = new Vector2();
  const offset = uniform(sampleOffset).onRenderUpdate(() => nativeScreenSampleOffset(camera, sampleOffset));
  const coverage = scenePass.getTextureNode('output').sample(uv().add(offset)).a;
  pipeline.outputNode = vec4(temporal.rgb, coverage);
  const resetHistory = () => (temporal as typeof temporal & { setSize(width: number, height: number): void }).setSize(1, 1);
  return {
    // The first real nested draw prepares the actual HDR/velocity/shadow keys.
    // Standalone compileAsync uses a different render context in pinned r186.
    render() { pipeline.render(); },
    async renderOpeningFrame(visitor: Object3D, shadow: DirectionalLightShadow, signal?: AbortSignal, prepareInSlices = false) {
      signal?.throwIfAborted();
      const output = new RenderTarget(1, 1, { depthBuffer: false });
      const originalTarget = renderer.getRenderTarget(), originalMRT = renderer.getMRT();
      const originalVisible = visitor.visible, activeXR = renderer.xr.enabled;
      const tone = renderer.toneMapping, colorSpace = renderer.outputColorSpace;
      const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
      const view = camera.view && { ...camera.view }, aspect = camera.aspect;
      try {
        try {
          // Main, velocity and shadow program keys include nested pass depth.
          // Prime the real temporal pipeline, directing only its final output
          // to a 1x1 offscreen target. Scene resolution and rig stay intact.
          visitor.visible = true; shadow.needsUpdate = true;
          renderer.setRenderTarget(output); renderer.setMRT(null);
          if (prepareInSlices) {
            const passUpdates = scenePass.updateBeforeType, historyUpdates = temporal.updateBeforeType;
            try {
              scenePass.updateBeforeType = 'render'; temporal.updateBeforeType = 'render';
              await prepareRenderSlices(renderer, scene, async () => {
                pipeline.render();
                await renderer.readRenderTargetPixelsAsync(output, 0, 0, 1, 1);
              }, signal);
            } finally {
              scenePass.updateBeforeType = passUpdates; temporal.updateBeforeType = historyUpdates;
            }
          } else pipeline.render();
        } finally {
          visitor.visible = originalVisible; shadow.needsUpdate = true;
          renderer.setRenderTarget(originalTarget); renderer.setMRT(originalMRT);
          renderer.toneMapping = tone; renderer.outputColorSpace = colorSpace; renderer.xr.enabled = activeXR;
          camera.view = view; camera.aspect = aspect;
          camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
          resetHistory();
        }
        // A returning visitor's driver may complete this almost immediately.
        // A hidden tab may not have received another animation callback yet.
        await renderer.readRenderTargetPixelsAsync(output, 0, 0, 1, 1);
        signal?.throwIfAborted();
      } finally { output.dispose(); }
      const passUpdates = scenePass.updateBeforeType, historyUpdates = temporal.updateBeforeType;
      try {
        // The last preparation batch may share this animation frame. Force a
        // complete redraw after visibility/shadows restore, even in a warm tab.
        scenePass.updateBeforeType = 'render'; temporal.updateBeforeType = 'render';
        pipeline.render();
      } finally {
        scenePass.updateBeforeType = passUpdates; temporal.updateBeforeType = historyUpdates;
      }
    },
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
      resetHistory();
    },
    dispose() { pipeline.dispose(); temporal.dispose(); scenePass.dispose(); },
  };
}
