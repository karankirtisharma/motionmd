// Pixel data is stored bottom-up to preserve TextureLoader's default flipY
// without requiring a GPU flip of a typed array on either renderer.
self.onmessage = async ({ data }: MessageEvent<Blob>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(data);
    const { width, height } = bitmap;
    const stripHeight = Math.min(256, height);
    const canvas = new OffscreenCanvas(width, stripHeight);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No worker image context');
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y += stripHeight) {
      const rows = Math.min(stripHeight, height - y);
      context.drawImage(bitmap, 0, y, width, rows, 0, 0, width, rows);
      const rgba = context.getImageData(0, 0, width, rows).data;
      for (let row = 0; row < rows; row++) {
        const destination = (height - y - row - 1) * width;
        for (let x = 0, source = row * width * 4; x < width; x++, source += 4) {
          const value = rgba[source];
          if (value !== rgba[source + 1] || value !== rgba[source + 2] || rgba[source + 3] !== 255) {
            throw new Error('Image requires additional channels');
          }
          pixels[destination + x] = value;
        }
      }
    }
    self.postMessage({ pixels, width, height }, { transfer: [pixels.buffer] });
  } catch {
    // Unsupported bitmap/canvas implementations and future colored revisions
    // keep the original TextureLoader path, using the same encoded image.
    self.postMessage(null);
  } finally {
    bitmap?.close();
  }
};
