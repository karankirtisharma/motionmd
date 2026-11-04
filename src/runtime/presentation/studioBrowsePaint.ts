type Rasterize = (root: HTMLElement, width: number, height: number) => Promise<HTMLImageElement>;
type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
};
type Slot = {
  x: number;
  y: number;
  w: number;
  h: number;
  margin: number;
  labelY: number;
};
const cards = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('.card-row[data-view="browse"] > .card[data-mode="card"]'));
const identity = (card: Element) => card.querySelector('img.card__media')?.getAttribute('alt') ?? '';
export function browseSignature(root: Element) {
  const row = cards(root);
  return row.length && !root.ownerDocument.querySelector('[role="dialog"],[role="alertdialog"],[cmdk-root],.rail[data-open],.chrome[data-splash]') ? row.map(identity).join('|') : '';
}
/** A focused browse gesture only moves existing pictures. Capture the real HTML
 * artwork once at BOTH authored sizes, then follow Motion's own inline projection
 * matrices. Settled views, dialogs, hover lighting and forms use the full paint. */
export async function prepareStudioBrowseLayers(source: HTMLElement, template: HTMLElement, width: number, height: number, rasterize: Rasterize, signal: AbortSignal) {
  const signature = browseSignature(source);
  if (!signature)
    return null;
  const originals = cards(source), painted = cards(template);
  if (painted.length !== originals.length || painted.some(card => !card.querySelector('img.card__media[src]')))
    return null;
  const active = originals.find(card => card.hasAttribute('data-active')), side = originals.find(card => !card.hasAttribute('data-active'));
  if (!active || !side)
    return null;
  const win = source.ownerDocument.defaultView!;
  const size = (card: HTMLElement) => {
    const cs = win.getComputedStyle(card);
    return { w: parseFloat(cs.width), h: parseFloat(cs.height), designW: card.style.getPropertyValue('--w'), designH: card.style.getPropertyValue('--h') };
  };
  const shapes = [size(side), size(active)];
  // Keep the original poster framing, bevelled glass, type, glints and shadows
  // in the sprites. Padding includes the active card's painted bloom.
  const margin = 52, cellW = Math.ceil(shapes[1].w + 2 * margin), cellH = Math.ceil(shapes[1].h + 2 * margin);
  const columns = Math.min(5, originals.length), atlasWidth = cellW * columns, cardRasterHeight = cellH * 2 * Math.ceil(originals.length / columns);
  const labelH = 72, atlasHeight = cardRasterHeight + labelH * 2 * Math.ceil(originals.length / columns);
  const atlas = template.cloneNode(false) as HTMLElement, css = template.querySelector('style')!.cloneNode(true);
  Object.assign(atlas.style, { width: atlasWidth + 'px', height: atlasHeight + 'px', background: 'transparent' });
  atlas.appendChild(css);
  const row = template.querySelector('.card-row')!.cloneNode(false) as HTMLElement;
  atlas.appendChild(row);
  const slots: Slot[][] = [];
  for (let i = 0; i < painted.length; i++) {
    slots[i] = [];
    for (let mode = 0; mode < 2; mode++) {
      const shape = shapes[mode], tile = painted[i].cloneNode(true) as HTMLElement;
      const x = (i % columns) * cellW, y = (Math.floor(i / columns) * 2 + mode) * cellH;
      tile.style.setProperty('--w', shape.designW);
      tile.style.setProperty('--h', shape.designH);
      for (const [key, value] of Object.entries({ left: (x + margin) + 'px', top: (y + margin) + 'px', width: shape.w + 'px', height: shape.h + 'px', transform: 'none', filter: 'none', opacity: '1', translate: 'none' }))
        tile.style.setProperty(key, value, 'important');
      tile.toggleAttribute('data-active', mode === 1);
      for (const element of tile.querySelectorAll<HTMLElement>('.glass,.card__media-wrap,.card__label'))
        element.style.setProperty('transform', 'none', 'important');
      const hero = tile.querySelector('.card__media--hero');
      hero?.remove();
      const label = tile.querySelector('.card__label');
      const labelY = cardRasterHeight + (Math.floor(i / columns) * 2 + mode) * labelH;
      if (label) {
        // Motion counter-scales labels while the outer picture changes size.
        // Rasterize the actual font and its shadow as a separate, unscaled strip.
        const labelTile = tile.cloneNode(false) as HTMLElement;
        for (const [key, value] of Object.entries({ left: x + 'px', top: labelY + 'px', height: labelH + 'px' }))
          labelTile.style.setProperty(key, value, 'important');
        labelTile.appendChild(label);
        row.appendChild(labelTile);
      }
      row.appendChild(tile);
      slots[i][mode] = { x, y, w: shape.w, h: shape.h, margin, labelY };
    }
  }
  const backing = template.cloneNode(true) as HTMLElement;
  for (const item of backing.querySelectorAll<HTMLElement>('.card-row,.title-band,.minimap'))
    item.style.visibility = 'hidden';
  const backdrop = await rasterize(backing, width, height);
  signal.throwIfAborted();
  const sprites = await rasterize(atlas, atlasWidth, atlasHeight);
  signal.throwIfAborted();
  const settled = source.ownerDocument.createElement('canvas');
  settled.width = width;
  settled.height = height;
  const settledContext = settled.getContext('2d')!;
  let selected = originals.indexOf(active), layoutSelection = selected, geometries: Box[] = [], nodes: HTMLElement[] = [], mapBox: Box | undefined, titleBox: Box | undefined;
  function layout(next: HTMLElement[]) {
    nodes = next;
    geometries = nodes.map(card => {
      const cs = win.getComputedStyle(card);
      return { x: parseFloat(cs.left), y: parseFloat(cs.top), w: parseFloat(cs.width), h: parseFloat(cs.height) };
    });
  }
  layout(originals);
  function selection() {
    if (browseSignature(source) !== signature)
      return -1;
    return cards(source).findIndex(card => card.hasAttribute('data-active'));
  }
  return {
    signature,
    refresh(canvas: HTMLCanvasElement) {
      const next = selection();
      if (next < 0)
        return;
      settledContext.drawImage(canvas, 0, 0);
      selected = next;
      const title = source.querySelector('.title-band')?.getBoundingClientRect();
      titleBox = title && { x: title.x - 5, y: title.y - 5, w: title.width + 10, h: title.height + 10 };
      const map = source.querySelector('.minimap')?.getBoundingClientRect();
      mapBox = map && { x: map.x - 8, y: map.y - 8, w: map.width + 16, h: map.height + 16 };
    },
    changed() { const next = selection(); return next >= 0 && next !== selected; },
    draw(ctx: CanvasRenderingContext2D) {
      const next = selection();
      if (next < 0)
        return false;
      const current = cards(source);
      if (current.some((card, i) => card !== nodes[i]) || next !== layoutSelection) {
        layout(current);
        layoutSelection = next;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(backdrop, 0, 0);
      // Chrome is exact from the most recent settled paint. Keep the title/map
      // while their native text animation resolves to the next film.
      if (titleBox)
        ctx.drawImage(settled, titleBox.x, titleBox.y, titleBox.w, titleBox.h, titleBox.x, titleBox.y, titleBox.w, titleBox.h);
      if (mapBox)
        ctx.drawImage(settled, mapBox.x, mapBox.y, mapBox.w, mapBox.h, mapBox.x, mapBox.y, mapBox.w, mapBox.h);
      for (let i = 0; i < nodes.length; i++) {
        const box = geometries[i], slot = slots[i][i === next ? 1 : 0], transform = nodes[i].style.transform;
        const m = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null;
        const scaleX = m?.a ?? 1, scaleY = m?.d ?? 1, dx = m?.e ?? 0, dy = m?.f ?? 0;
        const x = box.x + dx + (1 - scaleX) * box.w / 2, y = box.y + dy + (1 - scaleY) * box.h / 2;
        const sx = scaleX * box.w / slot.w, sy = scaleY * box.h / slot.h;
        const sw = slot.w + slot.margin * 2, sh = slot.h + slot.margin * 2;
        ctx.drawImage(sprites, slot.x, slot.y, sw, sh, x - slot.margin * sx, y - slot.margin * sy, sw * sx, sh * sy);
        ctx.drawImage(sprites, slot.x, slot.labelY, slot.w, labelH, x, y + box.h * scaleY - labelH, slot.w, labelH);
      }
      return true;
    },
  };
}
