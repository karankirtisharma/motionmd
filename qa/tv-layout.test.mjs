import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/studio/styles/globals.css', import.meta.url), 'utf8');
const stage = readFileSync(new URL('../src/studio/styles/stage.css', import.meta.url), 'utf8');
const views = readFileSync(new URL('../src/studio/styles/views.css', import.meta.url), 'utf8');
const row = readFileSync(new URL('../src/studio/components/CardRow.tsx', import.meta.url), 'utf8');
const tv = '#md-studio-root[data-tv]';
// Read the actual declarations/geometry instead of keeping a separate fixture
// of the layout. These checks complement the real curved-screen browser pass.
function declarations(text, selector) {
  const start = text.indexOf(selector + ' {');
  assert.ok(start >= 0, `missing selector: ${selector}`);
  const body = text.slice(text.indexOf('{', start) + 1, text.indexOf('}', start));
  return Object.fromEntries(body.split(';').filter(v => v.includes(':')).map(v => {
    const colon = v.indexOf(':'); return [v.slice(0, colon).trim(), v.slice(colon + 1).trim()];
  }));
}
const rule = selector => declarations(css, selector);
function px(value) { assert.match(value, /^\d+(?:\.\d+)?px$/); return parseFloat(value); }
function shape(name) {
  const match = row.match(new RegExp(`const ${name} = \\{ w: ([\\d.]+), h: ([\\d.]+), cy: ([\\d.]+) \\}`));
  assert.ok(match, `missing ${name} card geometry`);
  return {w: Number(match[1]), h: Number(match[2]), cy: Number(match[3])};
}
const focus = shape('FOCUS'), side = shape('SIDE');
const cardRule = rule(`${tv} .card-row[data-view="browse"]`);
const cardTop = rule(`${tv} .card-row[data-view="browse"] .card`).top;
const scaleMatch = cardRule['--u'].match(/^min\(100vw \/ ([\d.]+), \(100dvh - ([\d.]+)px\) \/ ([\d.]+)\)$/);
const topMatch = cardTop.match(/^calc\(([\d.]+)px \+ \(var\(--y\) - ([\d.]+)\) \* var\(--u\)\)$/);
assert.ok(scaleMatch && topMatch, 'review the geometry evaluator if the layout model changes');
function boxes(width, height) {
  const unit = Math.min(width / Number(scaleMatch[1]), (height - Number(scaleMatch[2])) / Number(scaleMatch[3]));
  const box = shape => {
    const y = Number(topMatch[1]) + (shape.cy - shape.h / 2 - Number(topMatch[2])) * unit;
    return {y, bottom:y + shape.h * unit, width:shape.w * unit, height:shape.h * unit};
  };
  return {focus:box(focus), side:box(side)};
}

test('TV browse chrome stays inside the bezel safe area without reducing the large cards', () => {
  const title = rule(`${tv} .title-band`);
  const hint = rule(`${tv} .chrome[data-view="browse"] .hint`);
  const controls = rule(`${tv}:has(.card-row[data-view="browse"]) .studio-screen-controls`);
  const button = rule(`${tv}:has(.card-row[data-view="browse"]) .studio-screen-controls button`);
  const map = rule(`${tv} .chrome[data-view="browse"] .minimap`);
  assert.ok(px(title.top) >= 32, 'heading needs clearance below the physical top bezel');
  for (const [name, element] of Object.entries({hint,controls,map})) {
    assert.ok(px(element.bottom) >= 32, `${name} needs clearance above the lower bezel`);
  }
  assert.ok(px(button['min-height']) >= 44, 'footer targets must remain comfortably clickable');
  for (const height of [540,558,576,600]) {
    const b = boxes(1600,height);
    const mapTop = height - px(map.bottom) - px(map.height);
    const hintTop = height - px(hint.bottom) - 15 * 1.5;
    const controlsTop = height - px(controls.bottom) - px(button['min-height']);
    assert.ok(mapTop - b.side.bottom >= 8, `map clears first/last-selection neighbours at height ${height}`);
    assert.ok(hintTop - b.focus.bottom >= 12, `hint clears the active card at height ${height}`);
    assert.ok(controlsTop - b.side.bottom >= 40, `footer controls clear outer cards at height ${height}`);
  }
  const authored = boxes(1600,558).focus;
  assert.ok(authored.width >= 280 && authored.height >= 360, 'retain the requested large TV cards');
  assert.equal(cardRule.translate, 'none', 'do not move the complete carousel behind the bezel');
});

test('compact TV map contains all ten rows and its caption with separate readable areas', () => {
  const map = rule(`${tv} .chrome[data-view="browse"] .minimap`);
  const grid = rule(`${tv} .chrome[data-view="browse"] .minimap__grid`);
  const label = rule(`${tv} .chrome[data-view="browse"] .minimap__label`);
  assert.ok(px(grid.height) / 10 >= 5, 'all ten format rows retain at least five pixels');
  assert.ok(px(label.top) - px(grid.top) - px(grid.height) >= 8, 'caption does not overlap dots');
  assert.ok(px(map.height) - px(label.top) - px(label['font-size']) * 1.15 >= 6, 'caption stays above the map rim');
});

test('TV safe-area overrides do not transform ancestor coordinate systems or affect standalone Studio', () => {
  const wide = css.slice(css.indexOf('@media (min-aspect-ratio: 5/2)'));
  for (const selector of wide.matchAll(/([^{}]+)\{/g)) {
    if (selector[1].trim().startsWith('@')) continue;
    assert.ok(selector[1].includes('[data-tv]'), 'safe-area rules must remain TV-only');
  }
  assert.equal(rule(`${tv} .wordmark`).display, 'none');
  assert.equal(declarations(stage,'#md-studio-root .title-band').position,'absolute');
  const fade = declarations(views,'#md-studio-root .fade-layer');
  assert.equal(fade.inset,'0');
  assert.equal(fade.transform,undefined);
  assert.equal(fade.translate,undefined);
  assert.equal(rule(`${tv} .title-band`).transform,undefined);
});
