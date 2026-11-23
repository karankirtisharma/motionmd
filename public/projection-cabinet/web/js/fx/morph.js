// Updates a rendered tree in place from freshly built markup of the same shape.
// Nodes that did not change stay alive, so CSS transitions retarget instead of restarting,
// focus stays where it was, and the stage keeps tracking the same elements.

const runtimeClass = c => c.startsWith('fx-') || c === 'reflect';

function syncAttributes(from, to, hooks) {
  for (const a of [...from.attributes]) {
    // Inline styles and fx markers that exist only on the live node were added at runtime. Keep them.
    if (to.hasAttribute(a.name) || a.name === 'style' || a.name === 'class' || a.name.startsWith('data-fx-')) continue;
    from.removeAttribute(a.name);
  }
  for (const a of to.attributes) {
    if (a.name === 'class') continue;
    const old = from.getAttribute(a.name);
    if (old === a.value) continue;
    if (a.name === 'src' && from.tagName === 'IMG') hooks.src?.(from, old);
    from.setAttribute(a.name, a.value);
  }
  // getAttribute, not className: icons are SVG, where className is not a string.
  const next = [to.getAttribute('class') || '', ...[...from.classList].filter(runtimeClass)].join(' ').trim();
  if ((from.getAttribute('class') || '') !== next) next ? from.setAttribute('class', next) : from.removeAttribute('class');
  // An attribute change does not move a field the visitor has typed in. Set the property too.
  if (from.tagName === 'INPUT' && to.hasAttribute('value') && from.value !== to.getAttribute('value')) from.value = to.getAttribute('value');
  if (from.tagName === 'TEXTAREA' && from.value !== to.value) from.value = to.value;
}

export function morph(from, to, hooks = {}) {
  syncAttributes(from, to, hooks);
  const olds = [...from.childNodes].filter(n => !(n.nodeType === 1 && n.hasAttribute('data-fx-keep')));
  const news = [...to.childNodes];
  for (let i = 0, n = Math.max(olds.length, news.length); i < n; i++) {
    const o = olds[i], w = news[i];
    if (!w) { o.remove(); continue; }
    if (!o) { from.appendChild(w); hooks.add?.(w); continue; }
    if (o.nodeType !== w.nodeType || o.nodeName !== w.nodeName) { o.replaceWith(w); hooks.add?.(w); continue; }
    if (o.nodeType !== 1) {
      if (o.data !== w.data) { hooks.text?.(o.parentElement); o.data = w.data; }
      continue;
    }
    morph(o, w, hooks);
  }
}
