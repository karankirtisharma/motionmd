type DeliveryRevision = { br?: string; identity?: string };

/** Version the decoded payload, not the encoding: Vary keeps br/gzip distinct.
 * Only generated 64-digit content hashes qualify for immutable browser caches. */
export function assetRevision(entry?: DeliveryRevision): string | undefined {
  return entry?.br?.match(/^\/asset-delivery\/([a-f0-9]{64})(?:\.q9)?\.glb\.br$/)?.[1];
}

export function versionedAssetPath(path: string, entries: Record<string, DeliveryRevision>): string {
  if (!path.startsWith('/assets/')) return path;
  const url = new URL(path, 'https://assets.invalid');
  const revision = assetRevision(entries[url.pathname]);
  if (!revision) return path;
  url.searchParams.set('v', revision);
  return url.pathname + url.search + url.hash;
}

export function assetCacheControl(revision: string | null, entry?: DeliveryRevision): string {
  const current = assetRevision(entry);
  return current && revision === current ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
}
