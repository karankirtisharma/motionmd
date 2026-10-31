import { Vector2 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

type DrawingBufferRenderer = Pick<WebGPURenderer, 'getSize' | 'getPixelRatio' | 'setDrawingBufferSize'>;

/** The viewport's CSS owns canvas sizing. r186 setSize writes the canvas even
 * for unchanged dimensions; setPixelRatio plus setSize also resizes twice.
 * Keep the requested logical dimensions and DPR exact, but apply them once. */
export function createDrawingBufferResizer() {
  const currentSize = new Vector2();
  return (renderer: DrawingBufferRenderer, width: number, height: number, pixelRatio: number): boolean => {
    renderer.getSize(currentSize);
    if (currentSize.x === width && currentSize.y === height && renderer.getPixelRatio() === pixelRatio) return false;
    renderer.setDrawingBufferSize(width, height, pixelRatio);
    return true;
  };
}