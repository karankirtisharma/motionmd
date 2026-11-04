type Projection = { width: number; height: number; matches: (query: string) => boolean; fonts: string[] };

/** Preserve declarations (including CSS nesting) while resolving CSS against
 * the one source iframe's viewport, not each small visual fragment. */
export function serializeStudioCSS(rules: CSSRuleList, base: string, projection: Projection): string {
  const freeze = (text: string) => text.replace(/(-?[\d.]+)(dvh|svh|lvh|vh|vw)\b/g,
    (_, number, unit) => `${Number(number) * (unit === 'vw' ? projection.width : projection.height) / 100}px`);
  // Data URLs can contain quoted SVG attributes and nested url(#filter) text.
  // Consume the complete CSS string before resolving any relative asset path.
  const urls = (text: string) => text.replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi,
    (original, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const url = double ?? single ?? bare?.trim() ?? '';
      return !url || url.startsWith('#') || url.startsWith('data:') ? original : 'url("' + new URL(url, base).href + '")';
    });
  const states = (text: string) => text.replace(/:(hover|focus-visible|focus-within|focus|active)\b/g, '[data-tv-$1]');
  return Array.from(rules).map(rule => {
    if (rule.type === 3) {
      const imported = (rule as CSSImportRule).styleSheet;
      try { return imported ? serializeStudioCSS(imported.cssRules, imported.href || base, projection) : ''; } catch { return ''; }
    }
    if (rule.type === 4) {
      const media = rule as CSSMediaRule;
      return projection.matches(media.conditionText) ? serializeStudioCSS(media.cssRules, base, projection) : '';
    }
    if (rule.type === 5) projection.fonts.push(urls(rule.cssText));
    if (rule.type === 1) {
      const style = rule as CSSStyleRule;
      // CSSStyleRule.cssRules exists even for a flat rule in modern browsers.
      // Serializing only that empty list silently deletes every declaration.
      return `${states(style.selectorText)}{${freeze(urls(style.style.cssText))}${style.cssRules ? serializeStudioCSS(style.cssRules, base, projection) : ''}}`;
    }
    if ('cssRules' in rule && rule.type !== 5) {
      const group = rule as CSSGroupingRule;
      return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${serializeStudioCSS(group.cssRules, base, projection)}}`;
    }
    return freeze(urls(rule.cssText));
  }).join('\n');
}
