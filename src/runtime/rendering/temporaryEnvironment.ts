import type { Texture } from 'three';
/** PMREM submits its source reads before returning. Keep the filtered render target,
 * release the one-use HDR upload on both success and failure. Background sources
 * are deliberately excluded because the scene still samples those directly. */
export function filterTemporaryEnvironment<T>(source: Texture, filter: (source: Texture) => T): T {
  try { return filter(source); }
  finally { source.dispose(); }
}
