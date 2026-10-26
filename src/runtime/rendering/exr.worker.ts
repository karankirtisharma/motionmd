import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
// Decode the unchanged half-float data with the same pinned Three.js parser.
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = new EXRLoader().parse(event.data);
    const pixels = result.data as Uint16Array;
    self.postMessage({ result: { ...result, header: undefined } }, { transfer: [pixels.buffer as ArrayBuffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
