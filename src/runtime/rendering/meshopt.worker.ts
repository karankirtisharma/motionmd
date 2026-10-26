import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
self.onmessage = async (event: MessageEvent<{ count: number; size: number; source: Uint8Array; mode: string; filter?: string }>) => {
  try {
    const { count, size, source, mode, filter } = event.data;
    const result = await MeshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter);
    self.postMessage({ result }, { transfer: [result.buffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
