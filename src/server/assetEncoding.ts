/** HTTP quality negotiation. An explicit exclusion wins over the wildcard. */
export function selectAssetEncoding(header: string | null): 'br' | 'gzip' | 'identity' | null {
  if (!header?.trim()) return 'identity';
  const values = new Map<string, number>();
  for (const item of header.toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    const q = parameters.find(value => value.trim().startsWith('q='));
    const weight = q ? Number(q.trim().slice(2)) : 1;
    values.set(name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }
  const quality = (name: string) => values.get(name) ?? values.get('*') ?? 0;
  const br = quality('br'), gzip = quality('gzip');
  const identity = values.get('identity') ?? (values.get('*') === 0 ? 0 : undefined);
  // Identity is the fallback unless explicitly preferred over accepted encodings.
  const best = br >= gzip ? 'br' : 'gzip', weight = Math.max(br, gzip);
  if (weight > 0 && (identity === undefined || weight >= identity)) return best;
  return identity === 0 ? null : 'identity';
}
