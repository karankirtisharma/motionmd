import { serializeStudioCSS } from './studioCss.ts';
import { isMotionPopRule, motionPopStyles } from './motionStyles.ts';
const cssUrl = /url\(\s*"([^"]+)"\s*\)/g;
const asDataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
export function createStudioPaintDocument(doc: Document, width: number, height: number, signal: AbortSignal) {
  const win = doc.defaultView!;
  const root = doc.querySelector<HTMLElement>('#md-studio-root');
  if (!root)
    throw new Error('The live Studio is not ready to paint.');
  const source = root;
  const cache = new Map<string, Promise<string>>();
  const nodeMap = new Map<Element, Element>();
  let styles: Promise<string> | undefined;
  function resource(url: string) {
    if (url.startsWith('data:') || url.startsWith('#'))
      return Promise.resolve(url);
    const href = new URL(url, doc.baseURI);
    if (href.origin !== win.location.origin)
      throw new Error('Studio paint requires same-origin artwork.');
    let pending = cache.get(href.href);
    if (!pending) {
      pending = win.fetch(href.href, { signal, cache: 'force-cache' }).then(response => {
        if (!response.ok)
          throw new Error('Could not read Studio artwork: ' + href.pathname);
        return response.blob();
      }).then(asDataURL);
      cache.set(href.href, pending);
      if (cache.size > 96)
        cache.delete(cache.keys().next().value!);
    }
    return pending;
  }
  const scrollers = new WeakSet<Element>();
  function imageData(image: HTMLImageElement, rect: DOMRect) {
    const src = image.currentSrc || image.src;
    // Match the source image's cover crop at its painted resolution, with some
    // overscan for the Studio's hover tilt and card transitions.
    const ratio = Math.min(1, Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight) * 1.2);
    if (ratio >= .85 || ratio <= 0)
      return resource(src);
    const w = Math.max(1, Math.ceil(image.naturalWidth * ratio / 32) * 32);
    const h = Math.max(1, Math.round(w * image.naturalHeight / image.naturalWidth));
    const key = src + '|paint:' + w;
    const cached = cache.get(key);
    if (cached)
      return cached;
    const buffer = doc.createElement('canvas');
    buffer.width = w;
    buffer.height = h;
    const ctx = buffer.getContext('2d');
    if (!ctx)
      return resource(src);
    ctx.drawImage(image, 0, 0, w, h);
    const encoded = new Promise<Blob>((resolve, reject) => buffer.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode Studio artwork.')), 'image/webp', .97)).then(asDataURL);
    cache.set(key, encoded);
    if (cache.size > 96)
      cache.delete(cache.keys().next().value!);
    return encoded;
  }
  async function stylesheet() {
    await doc.fonts?.ready;
    signal.throwIfAborted();
    let css = '';
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRule[];
      try {
        rules = Array.from(sheet.cssRules);
      }
      catch {
        continue;
      }
      css += serializeStudioCSS(rules.filter(rule => !isMotionPopRule(rule)) as unknown as CSSRuleList, sheet.href || doc.baseURI, { width, height, fonts: [], matches: query => win.matchMedia(query).matches }) + '\n';
    }
    const urls = [...new Set([...css.matchAll(cssUrl)].map(match => match[1]).filter(url => !url.startsWith('#') && !url.startsWith('data:')))];
    const embedded = new Map(await Promise.all(urls.map(async (url) => [url, await resource(url)] as const)));
    const variables = new Map<string, string>();
    const rewritten = css.replace(cssUrl, (original, url: string) => {
      const data = embedded.get(url);
      if (!data)
        return original;
      if (/\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(url))
        return 'url("' + data + '")';
      let variable = variables.get(url);
      if (!variable) {
        variable = '--studio-paint-image-' + variables.size;
        variables.set(url, variable);
      }
      return 'var(' + variable + ')';
    });
    const declarations = [...variables].map(([url, name]) => name + ':url("' + embedded.get(url) + '")');
    return '#md-studio-root{' + declarations.join(';') + '}\n' + rewritten;
  }
  function cloneTree(element: Element) {
    // Clone shallowly so nested next/image elements do not start additional requests
    // for their srcset candidates in this detached document.
    const copy = element.tagName === 'IMG' ? doc.createElement('img') : element.cloneNode(false) as Element;
    if (element.tagName === 'IMG')
      for (const attr of Array.from(element.attributes))
        if (!['src', 'srcset', 'sizes', 'loading'].includes(attr.name))
          copy.setAttribute(attr.name, attr.value);
    nodeMap.set(element, copy);
    for (const child of element.childNodes) {
      if (child.nodeType === 3)
        copy.appendChild(child.cloneNode());
      else if (child.nodeType === 1 && !['LINK', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes((child as Element).tagName))
        copy.appendChild(cloneTree(child as Element));
    }
    return copy;
  }
  async function compose() {
    styles ??= stylesheet();
    const css = await styles;
    signal.throwIfAborted();
    nodeMap.clear();
    const copy = cloneTree(source) as HTMLElement;
    // Current Radix/vaul portals live under the Studio root. Preserve siblings
    // from a body-level portal as well, in their original paint order.
    const portals = doc.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="listbox"],[data-radix-portal],[data-sonner-toaster]');
    for (const portal of portals)
      if (!nodeMap.has(portal) && !source.contains(portal))
        copy.appendChild(cloneTree(portal));
    const jobs: Promise<void>[] = [];
    const bounds = new Map<Element, DOMRect>();
    const scrolled: [
      Element,
      number,
      number
    ][] = [];
    for (const [original, replica] of nodeMap) {
      if (original.tagName === 'IMG') {
        const image = original as HTMLImageElement, clone = replica as HTMLImageElement;
        clone.removeAttribute('srcset');
        clone.removeAttribute('sizes');
        clone.removeAttribute('loading');
        const rect = image.getBoundingClientRect();
        const list = image.closest('[cmdk-list],.sl__list,.map__body');
        let limit = list && bounds.get(list);
        if (list && !limit) {
          limit = list.getBoundingClientRect();
          bounds.set(list, limit);
        }
        // A long native search list can contain all 50 posters. Offscreen
        // thumbnails paint zero pixels, so never embed them into the print.
        if (!image.complete || !image.naturalWidth || !rect.width || !rect.height ||
          rect.right < 0 || rect.left > width || rect.bottom < 0 || rect.top > height ||
          (limit && (rect.bottom < limit.top || rect.top > limit.bottom)))
          clone.removeAttribute('src');
        else
          jobs.push(imageData(image, rect).then(src => { clone.src = src; }));
      }
      else if (original.tagName === 'INPUT') {
        const field = original as HTMLInputElement;
        replica.setAttribute('value', field.type === 'password' ? '•'.repeat(field.value.length) : field.value);
        replica.toggleAttribute('checked', field.checked);
      }
      else if (original.tagName === 'TEXTAREA')
        replica.textContent = (original as HTMLTextAreaElement).value;
      else if (original.tagName === 'OPTION')
        replica.toggleAttribute('selected', (original as HTMLOptionElement).selected);
      // Only scrollers can have non-zero scroll offsets; don't force a layout
      // measurement for every node in the scene.
      if ((scrollers.has(original) || original.hasAttribute('cmdk-list')) && (original.scrollLeft || original.scrollTop))
        scrolled.push([replica, original.scrollLeft, original.scrollTop]);
    }
    for (const [replica, left, top] of scrolled) {
      for (const child of Array.from(replica.children)) {
        const styled = child as HTMLElement;
        if (styled.style)
          styled.style.translate = (-left) + 'px ' + (-top) + 'px';
      }
    }
    for (const state of ['hover', 'focus', 'focus-within', 'focus-visible', 'active']) {
      for (const element of doc.querySelectorAll(':' + state))
        nodeMap.get(element)?.setAttribute('data-tv-' + state, '');
    }
    // A static SVG image has no ticking document timeline. Resolve only active
    // effects at capture time; regular inline styles and CSS handle everything else.
    const pseudoStyles: string[] = [];
    let moving = false, id = 0;
    for (const animation of doc.getAnimations()) {
      const effect = animation.effect as KeyframeEffect | null;
      const element = effect?.target, replica = element && nodeMap.get(element) as HTMLElement | undefined;
      if (!replica?.style || !effect || !element || typeof effect.getKeyframes !== 'function')
        continue;
      moving ||= (animation.pending || animation.playState === 'running') && Number.isFinite(effect.getComputedTiming().endTime);
      const computed = win.getComputedStyle(element, effect.pseudoElement || null);
      const props = new Set(effect.getKeyframes().flatMap(frame => Object.keys(frame)).filter(k => !['computedOffset', 'offset', 'easing', 'composite'].includes(k)));
      const declarations: string[] = [];
      for (const key of props) {
        const property = key.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
        const value = computed.getPropertyValue(property);
        if (!value)
          continue;
        if (effect.pseudoElement)
          declarations.push(property + ':' + value + '!important');
        else
          replica.style.setProperty(property, value, 'important');
      }
      if (declarations.length) {
        const key = String(++id);
        replica.setAttribute('data-tv-effect-' + key, '');
        pseudoStyles.push('[data-tv-effect-' + key + ']' + effect.pseudoElement + '{' + declarations.join(';') + '}');
      }
    }
    await Promise.all(jobs);
    signal.throwIfAborted();
    Object.assign(copy.style, { position: 'relative', inset: 'auto', top: '0', left: '0', width: width + 'px', height: height + 'px', margin: '0', visibility: 'visible', opacity: '1', transform: 'none', overflow: 'hidden' });
    const style = doc.createElement('style');
    style.textContent = css + '\n' + motionPopStyles(doc) + '\n#md-studio-root *,#md-studio-root *::before,#md-studio-root *::after{animation:none!important;transition:none!important}.stage{position:absolute!important;inset:0!important}\n' + pseudoStyles.join('\n');
    copy.prepend(style);
    nodeMap.clear();
    return { image: await rasterize(copy, width, height), moving, template: copy };
  }
  async function rasterize(element: HTMLElement, w: number, h: number) {
    const xml = new XMLSerializer().serializeToString(element);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + xml + '</foreignObject></svg>';
    // A blob: URL for the exact same foreignObject taints a Chromium canvas.
    const url = await asDataURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  }
  return { compose, rasterize, trackScroll(element: Element) { scrollers.add(element); }, invalidateStyles() { styles = undefined; }, dispose() { cache.clear(); nodeMap.clear(); styles = undefined; } };
}
