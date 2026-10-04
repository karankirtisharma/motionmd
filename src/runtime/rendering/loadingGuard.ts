import { LoadingManager } from 'three';

/** GLTFLoader may resolve with null maps after an image load rejects. */
export function createAssetLoadGuard(resolveURL?: (url: string) => string) {
  const failures = new Set<string>();
  const manager = new LoadingManager();
  if (resolveURL) manager.setURLModifier(resolveURL);
  manager.onError = url => { failures.add(url); };
  return {
    manager,
    assertLoaded() {
      if (!failures.size) return;
      console.error('[MD asset load] required resources failed', [...failures]);
      throw new Error('A scene texture could not be loaded. Check your connection and try again.');
    },
  };
}
