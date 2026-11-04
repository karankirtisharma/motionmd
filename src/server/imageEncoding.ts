/** A wildcard fetch (Three's ImageBitmapLoader) accepts both representations.
 * Prefer the smaller one on a tie, but respect explicit exclusions/preferences. */
export function prefersWebP(header: string | null): boolean {
  if (!header?.trim()) return false;
  const weights = new Map<string, number>();
  for (const range of header.toLowerCase().split(',')) {
    const [type, ...parameters] = range.trim().split(';');
    const parameter = parameters.map(value => value.trim()).find(value => value.startsWith('q='));
    const quality = parameter ? Number(parameter.slice(2)) : 1;
    if (Number.isFinite(quality) && quality >= 0 && quality <= 1) weights.set(type.trim(), quality);
  }
  const weight = (type: string) => weights.get(type) ?? weights.get('image/*') ?? weights.get('*/*') ?? 0;
  const webp = weight('image/webp'), png = weight('image/png');
  return webp > 0 && (webp > png || (webp === png && (weights.has('image/webp') || !weights.has('image/png'))));
}
