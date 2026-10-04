import { ClampToEdgeWrapping, CustomToneMapping, Data3DTexture, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat } from 'three';
import { Fn, float, texture3D, vec3 } from 'three/tsl';
import type { WebGPURenderer } from 'three/webgpu';
import type Node from 'three/src/nodes/core/Node.js';
import type { SceneManifest } from '@/types';
import { fetchBuffer } from './assets';

/** Actual Blender OCIO view/look sampled by an offline preparation step.
 * The LUT outputs display-linear RGB; the renderer applies the sRGB transfer only once.
 */
export async function configureSourceColor(renderer: WebGPURenderer, pipeline: SceneManifest['colorPipeline'], signal: AbortSignal): Promise<Data3DTexture | undefined> {
  if (!pipeline?.validated) return undefined;
  const { size, minEV, maxEV } = pipeline;
  if (pipeline.format !== 'rgba16f-le' || pipeline.output !== 'display-linear-srgb' || !Number.isInteger(size) || size < 16 || size > 129 || !(maxEV > minEV)) {
    throw new Error('The source color transform metadata is invalid.');
  }
  let buffer = await fetchBuffer(pipeline.url, signal);
  if (pipeline.compression === 'gzip' && buffer.byteLength !== size ** 3 * 8) {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      buffer = await new Response(stream).arrayBuffer();
    } else {
      const fallback = pipeline.rawURL ?? pipeline.url.replace(/\.gz$/, '');
      if (fallback === pipeline.url) throw new Error('This browser cannot decompress the source color transform.');
      buffer = await fetchBuffer(fallback, signal);
    }
  }
  signal.throwIfAborted();
  if (buffer.byteLength !== size ** 3 * 8) throw new Error('The source color transform is incomplete.');
  const lookup = new Data3DTexture(new Uint16Array(buffer), size, size, size);
  lookup.name = 'MD | source Blender OCIO display transform';
  lookup.type = HalfFloatType; lookup.format = RGBAFormat; lookup.colorSpace = NoColorSpace;
  lookup.minFilter = LinearFilter; lookup.magFilter = LinearFilter;
  lookup.wrapS = lookup.wrapT = lookup.wrapR = ClampToEdgeWrapping;
  lookup.generateMipmaps = false; lookup.unpackAlignment = 1; lookup.needsUpdate = true;
  const minimum = Math.pow(2, minEV), maximum = Math.pow(2, maxEV);
  const transform = Fn(([color, exposure]: [Node<'vec3'>, Node<'float'>]) => {
    const shaped = color.mul(exposure).clamp(minimum, maximum).log2().sub(minEV).div(maxEV - minEV);
    const coordinate = shaped.mul((size - 1) / size).add(0.5 / size);
    return texture3D(lookup, coordinate).rgb;
  });
  renderer.library.addToneMapping((color, exposure) => transform(vec3(color as Node<'vec3'>), float(exposure as Node<'float'>)), CustomToneMapping);
  renderer.toneMapping = CustomToneMapping;
  renderer.initTexture(lookup);
  return lookup;
}
