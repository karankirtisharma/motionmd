export type SceneDeliverySize = { encodedBytes: number; decodedBytes: number; encoding: string };

/** The fetch stream is already decompressed. Never label its byte count as a download. */
export function architectureProgress(received: number, fallbackDecodedBytes: number, delivery?: SceneDeliverySize) {
  const decoded = delivery?.decodedBytes || fallbackDecodedBytes;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  const detail = delivery?.encodedBytes && delivery.decodedBytes
    ? `Scene files: ${mb(delivery.encodedBytes)} MB${delivery.encoding !== 'identity' ? ' compressed' : ''} · ${mb(decoded)} MB unpacked`
    : `Unpacking scene: ${mb(received)}${decoded ? ' / ' + mb(decoded) : ''} MB`;
  return { phase: 'Loading the architecture', progress: decoded > 0 ? Math.min(received / decoded, 1) : undefined, detail };
}
