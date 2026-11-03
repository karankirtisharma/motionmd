type StyleRule = CSSRule & { selectorText?: string };
/** Motion's popLayout styles are inserted through CSSOM in document.head, not
 * through attributes on the live cards. They must not become permanent rules in
 * the initial fragment stylesheet or disappear from the visual replicas. */
export function isMotionPopRule(rule: CSSRule): boolean {
  return rule.type === 1 && /\[data-motion-pop-id\s*=/.test((rule as StyleRule).selectorText ?? '');
}

export function motionPopStyles(document: Document): string {
  const rules: CSSRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    // Motion owns anonymous inline sheets. Static external CSS cannot contain
    // its per-instance React IDs and need not be scanned during transitions.
    if (sheet.href) continue;
    try { rules.push(...Array.from(sheet.cssRules).filter(isMotionPopRule)); } catch { /* unreadable sheet is unrelated */ }
  }
  return rules.map(rule => rule.cssText).join('\n');
}
