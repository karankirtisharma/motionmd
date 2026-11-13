/**
 * Browser interaction checks for the intro on the simulated host: keyboard
 * order, visible focus, target sizes, rotation by button, drag and touch,
 * studies focus return, readiness inside the sheet, system reduced motion, the
 * graphics fallback, enlarged text, short and narrow viewports, entry, and the
 * scoped host rules as the visitor meets them.
 *
 *   node tools/check-browser.mjs [--base http://127.0.0.1:8080/index.html]
 *                                [--out docs/evidence/browser-checks.json] [--only name,name]
 *
 * Every result here is simulated-host evidence from headless Chrome with its
 * software renderer. Requires Playwright and Chrome (see tools/capture.mjs).
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const base = option('base', 'http://127.0.0.1:8080/index.html');
const out = resolve(root, option('out', 'docs/evidence/browser-checks.json'));
const only = option('only') ? new Set(option('only').split(',')) : null;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const dir = process.env.PLAYWRIGHT_DIR;
    if (!dir) throw new Error('Playwright is not installed. Run `npm i -D playwright`, or set PLAYWRIGHT_DIR to a node_modules folder that has it.');
    return createRequire(dir.endsWith('/') ? dir : `${dir}/`)('playwright');
  }
}
const { chromium } = await loadPlaywright();
const chrome = option('chrome', process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined));
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});

const lm = (name) => `[data-lm="${name}"]`;
const pill = (group, id) => `label[for="lm-${group}-${id}"]`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function open({ query, viewport = DESKTOP, mobile = false, reducedMotion = 'no-preference', scene = true, still = false, rootFontPx = null, beforeGoto = null }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A larger default text size (the browser's font-size setting): the root
  // font size is set the moment <html> exists, before any style applies.
  if (rootFontPx) {
    await page.addInitScript((px) => {
      const apply = () => {
        if (!document.documentElement) return false;
        document.documentElement.style.fontSize = `${px}px`;
        return true;
      };
      if (!apply()) new MutationObserver((_, observer) => { if (apply()) observer.disconnect(); }).observe(document, { childList: true });
    }, rootFontPx);
  }
  // `still` checks run on the static fallback: host and interface behaviour
  // does not depend on the renderer, and the software renderer used by
  // headless Chrome otherwise leaves the page too few frames to act on time.
  if (beforeGoto) beforeGoto(page);
  await page.goto(`${base}?${query}&panel=0${still ? '&graphics=still' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(window.__lm)', null, { timeout: 30_000 });
  if (scene && !still) await page.waitForFunction("window.__lm.intro.graphics !== 'pending'", null, { timeout: 90_000 });
  return { page, context, errors };
}
const mode = (page) => page.evaluate(() => document.querySelector('.lm-root').dataset.mode);
const untilMode = (page, name, timeout = 60_000) => page.waitForFunction((wanted) => document.querySelector('.lm-root')?.dataset.mode === wanted, name, { timeout });
const active = (page) => page.evaluate(() => {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  return element.dataset.lm ?? element.id ?? element.tagName.toLowerCase();
});
const snapshot = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lm.intro.snapshot)));
const liveText = (page) => page.evaluate(() => [document.querySelector('[data-lm="live-polite"]').textContent, document.querySelector('[data-lm="live-assertive"]').textContent]);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function expect(condition, message, detail) {
  if (!condition) throw Object.assign(new Error(message), { detail });
}

// ---------------------------------------------------------------- keyboard
check('keyboard-order-desktop', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__lm.intro.director.seek(41));
  await page.waitForTimeout(600);
  const order = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await active(page));
  }
  await context.close();
  const expected = ['sound', 'lm-light-warm', 'lm-destination-lounge', 'version-immersive', 'version-lite', 'rotate-left', 'rotate-right', 'studies'];
  expect(JSON.stringify(order.slice(0, expected.length)) === JSON.stringify(expected), 'Tab order differs from the specification', { order, expected });
  return { order: order.slice(0, expected.length), note: 'sound and light in the header, then room, version, rotation, studies; the Enter action follows when the room is ready' };
});

check('keyboard-choices-and-entry', async () => {
  const { page, context } = await open({ query: 'case=early&speed=1', still: true });
  await page.focus('#lm-destination-lounge');
  await page.keyboard.press('ArrowRight');
  let state = await snapshot(page);
  expect(state.preferences.destinationId === 'motion-floor', 'Arrow key did not select Motion floor');
  await page.waitForFunction("document.querySelector('[data-lm=\"live-polite\"]').textContent.length > 0", null, { timeout: 5_000 });
  const [announced] = await liveText(page);
  expect(/First stop: Motion floor\./.test(announced), 'Selection was not announced', { announced });
  await page.keyboard.press('ArrowLeft');
  state = await snapshot(page);
  expect(state.preferences.destinationId === 'lounge' && state.destinationRequestId === 2, 'Arrow key did not return to the lounge with a new request');
  await untilMode(page, 'ready');
  // The light control is on the page once the room is ready.
  await page.focus('#lm-light-warm');
  await page.keyboard.press('ArrowRight');
  expect((await snapshot(page)).preferences.lightMode === 'soft', 'Arrow key did not select Soft');
  // Tab on to the Enter action and activate it from the keyboard.
  let focused = await active(page);
  for (let i = 0; i < 8 && focused !== 'enter'; i += 1) {
    await page.keyboard.press('Tab');
    focused = await active(page);
  }
  expect(focused === 'enter', 'Enter was not reachable by Tab', { focused });
  await page.keyboard.press('Enter');
  await page.waitForFunction('Boolean(window.__lm.host.entered)', null, { timeout: 20_000 });
  const entered = await page.evaluate(() => window.__lm.host.entered);
  await context.close();
  expect(entered.destinationId === 'lounge' && entered.preferences.lightMode === 'soft', 'Entry did not carry the room and light', entered);
  return { entered };
});

check('focus-visible', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__lm.intro.director.seek(41));
  const seen = {};
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    const item = await page.evaluate(() => {
      const element = document.activeElement;
      // A radio shows its ring on the pill beside it.
      const target = element.matches('.lm-radio') ? element.nextElementSibling : element;
      const style = getComputedStyle(target);
      return { name: element.dataset.lm ?? element.id, style: style.outlineStyle, width: parseFloat(style.outlineWidth), colour: style.outlineColor, offset: style.outlineOffset };
    });
    seen[item.name] = item;
  }
  await context.close();
  for (const [name, item] of Object.entries(seen)) {
    expect(item.style !== 'none' && item.width >= 2, `No visible focus ring on ${name}`, item);
  }
  return { rings: Object.fromEntries(Object.entries(seen).map(([name, item]) => [name, `${item.width}px ${item.style} ${item.colour}, offset ${item.offset}`])) };
});

// ------------------------------------------------------------- target sizes
async function targetSizes(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const items = [...document.querySelectorAll('.lm-root button, .lm-root a[href], .lm-root label.lm-pill')].filter(visible);
    return items.map((element) => {
      const box = element.getBoundingClientRect();
      return { name: element.dataset.lm ?? element.getAttribute('for') ?? element.textContent.trim().slice(0, 24), width: Math.round(box.width), height: Math.round(box.height) };
    });
  });
}
check('target-sizes', async () => {
  const report = {};
  for (const [label, options] of Object.entries({
    desktop: { query: 'case=normal&hold=39050&speed=20', viewport: DESKTOP },
    phone: { query: 'case=normal&hold=39050&speed=20', viewport: PHONE, mobile: true },
    'phone-failure': { query: 'case=failure&speed=10', viewport: PHONE, mobile: true },
  })) {
    const { page, context } = await open(options);
    if (label === 'phone-failure') await untilMode(page, 'failed');
    else {
      await page.waitForTimeout(2600);
      await page.evaluate(() => window.__lm.intro.director.seek(41));
      await page.waitForTimeout(400);
    }
    const sizes = await targetSizes(page);
    await context.close();
    const small = sizes.filter((item) => item.width < 44 || item.height < 44);
    expect(small.length === 0, `Targets under 44 px in ${label}`, small);
    report[label] = { controls: sizes.length, smallest: sizes.reduce((min, item) => Math.min(min, item.width, item.height), Infinity) };
  }
  return report;
});

// ----------------------------------------------------------------- rotation
check('rotation-buttons-and-drag', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__lm.intro.director.seek(41));
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => ({ user: window.__lm.intro.director.userYaw, passive: window.__lm.intro.snapshot.passive, takenOver: window.__lm.intro.director.facts.takenOver }));
  await page.click(lm('rotate-right'));
  await page.click(lm('rotate-right'));
  const afterButtons = await page.evaluate(() => ({ user: window.__lm.intro.director.userYaw, passive: window.__lm.intro.snapshot.passive, takenOver: window.__lm.intro.director.facts.takenOver }));
  expect(afterButtons.user > before.user + 0.2, 'Rotate right did not turn the model', { before, afterButtons });
  expect(afterButtons.takenOver === true && afterButtons.passive === false, 'Input did not take over from passive movement', afterButtons);
  // Twelve presses stay inside the bounded range.
  for (let i = 0; i < 12; i += 1) await page.click(lm('rotate-right'));
  const limit = await page.evaluate(() => ({ user: window.__lm.intro.director.userYaw, limit: window.__lm.intro.stage.look.yaw.limitDeg * Math.PI / 180 }));
  expect(limit.user <= limit.limit + 1e-6, 'Rotation exceeded its limit', limit);
  // Drag on the model, away from the copy and the controls.
  const box = await page.evaluate(() => { const b = document.querySelector('[data-lm="stage"]').getBoundingClientRect(); return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.35 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 180, box.y, { steps: 6 });
  const during = await page.evaluate(() => document.querySelector('.lm-root').dataset.dragging);
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.__lm.intro.director.userYaw);
  await context.close();
  expect(during === 'true', 'Dragging state was not set while the pointer was down');
  expect(afterDrag < limit.user - 0.12, 'Dragging left did not turn the model back', { afterDrag, from: limit.user });
  return { buttonsYawRad: +afterButtons.user.toFixed(3), limitRad: +limit.limit.toFixed(3), afterDragRad: +afterDrag.toFixed(3) };
});

check('touch-rotation-and-scroll', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20', viewport: PHONE, mobile: true });
  await page.waitForTimeout(2600);
  await page.waitForSelector(lm('rotate'), { state: 'visible', timeout: 60_000 });
  const facts = await page.evaluate(() => {
    const canvas = document.querySelector('[data-lm="canvas"]');
    const rotate = document.querySelector('[data-lm="rotate"]').getBoundingClientRect();
    return { touchAction: getComputedStyle(canvas).touchAction, layout: document.querySelector('.lm-root').dataset.layout, pod: [Math.round(rotate.width), Math.round(rotate.height)] };
  });
  expect(facts.layout === 'stacked', 'The phone viewport did not use the stacked layout', facts);
  expect(facts.touchAction === 'pan-y', 'Vertical scrolling is not left to the page on the canvas', facts);
  const client = await context.newCDPSession(page);
  const box = await page.evaluate(() => { const b = document.querySelector('[data-lm="stage"]').getBoundingClientRect(); return { x: b.left + b.width * 0.42, y: b.top + b.height * 0.4 }; });
  const touch = (type, x) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: box.y, id: 1 }] });
  await touch('touchStart', box.x);
  for (let i = 1; i <= 6; i += 1) await touch('touchMove', box.x + i * 22);
  await touch('touchEnd', box.x + 132);
  await page.waitForTimeout(300);
  const yaw = await page.evaluate(() => window.__lm.intro.director.userYaw);
  await page.tap(lm('rotate-left'));
  const afterTap = await page.evaluate(() => window.__lm.intro.director.userYaw);
  await context.close();
  expect(Math.abs(yaw) > 0.05, 'A horizontal touch drag did not turn the model', { yaw });
  expect(afterTap < yaw, 'The Rotate left button did not turn the model', { yaw, afterTap });
  return { touchAction: facts.touchAction, dragYawRad: +yaw.toFixed(3), afterButtonRad: +afterTap.toFixed(3), podSize: facts.pod };
});

// ------------------------------------------------------------------ studies
check('studies-focus-return-and-ready-in-sheet', async () => {
  const { page, context } = await open({ query: 'case=early&speed=1' });
  await page.focus(lm('studies'));
  await page.keyboard.press('Enter');
  const opened = { focus: await active(page), inert: await page.evaluate(() => document.querySelector('[data-lm="main"]').inert) };
  expect(opened.focus === 'sheet-title' && opened.inert === true, 'Opening the studies did not focus the sheet heading', opened);
  // Explore the Light study from the keyboard.
  await page.focus('[data-study="light"]');
  await page.keyboard.press('Enter');
  const detail = { focus: await active(page), title: await page.textContent(lm('sheet-title')), view: await page.evaluate(() => document.querySelector('[data-lm="sheet"]').dataset.view) };
  expect(detail.view === 'detail' && detail.title === 'Light' && detail.focus === 'sheet-title', 'The Light detail did not open with focus on its heading', detail);
  // The room becomes ready while the detail is open.
  await untilMode(page, 'ready');
  await page.waitForTimeout(250);
  const atReady = await page.evaluate(() => ({
    focus: document.activeElement?.dataset.lm,
    sheetOpen: !document.querySelector('[data-lm="sheet"]').hidden,
    view: document.querySelector('[data-lm="sheet"]').dataset.view,
    readyRow: !document.querySelector('[data-lm="sheet-ready"]').hidden,
    enterLabel: document.querySelector('[data-lm="sheet-enter"]').textContent,
    live: document.querySelector('[data-lm="live-polite"]').textContent,
  }));
  expect(atReady.sheetOpen && atReady.view === 'detail' && atReady.focus === 'sheet-title', 'Readiness moved focus or closed the detail', atReady);
  expect(atReady.readyRow && atReady.enterLabel === 'Enter the lounge', 'Enter was not offered inside the sheet', atReady);
  expect(/ready/i.test(atReady.live), 'Readiness was not announced', atReady);
  // Escape returns to the Light card, then to Explore studies.
  await page.keyboard.press('Escape');
  const backToList = await page.evaluate(() => ({
    view: document.querySelector('[data-lm="sheet"]').dataset.view,
    focus: document.activeElement?.dataset.study,
    // Back in the list with the room ready: nothing claims loading continues.
    loadingContinuesShown: getComputedStyle(document.querySelector('[data-lm="sheet-foot-text"]')).visibility !== 'hidden',
  }));
  expect(backToList.view === 'list' && backToList.focus === 'light', 'Back to studies did not restore focus to the Light card', backToList);
  expect(backToList.loadingContinuesShown === false, 'The sheet still says loading continues after the room is ready', backToList);
  await page.keyboard.press('Escape');
  const closed = { focus: await active(page), hidden: await page.evaluate(() => document.querySelector('[data-lm="sheet"]').hidden), inert: await page.evaluate(() => document.querySelector('[data-lm="main"]').inert) };
  await context.close();
  expect(closed.hidden && closed.focus === 'studies' && closed.inert === false, 'Closing the sheet did not restore focus to Explore studies', closed);
  return { opened, detail, atReady, backToList, closed };
});

// ----------------------------------------------------------- reduced motion
check('system-reduced-motion-first-paint', async () => {
  const { page, context } = await open({ query: 'case=normal&speed=1', reducedMotion: 'reduce', scene: false });
  const first = await page.evaluate(() => ({
    motion: document.querySelector('.lm-root').dataset.motion,
    reduced: window.__lm.intro.snapshot.preferences.reducedMotion,
    rotateHidden: document.querySelector('[data-lm="rotate"]').hidden,
  }));
  expect(first.motion === 'reduced' && first.reduced === true, 'The system preference was not applied before the scene started', first);
  await page.waitForFunction("window.__lm.intro.graphics !== 'pending'", null, { timeout: 90_000 });
  const frame = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-lm="canvas"]');
    window.__lm.intro.stage.renderOnce();
    return canvas.toDataURL('image/png').length + ':' + canvas.toDataURL('image/png').slice(-64);
  });
  const a = await frame();
  await page.waitForTimeout(6_000);
  const b = await frame();
  const later = await page.evaluate(() => ({
    facts: window.__lm.intro.director.facts,
    time: window.__lm.intro.director.time,
    yaw: window.__lm.intro.stage.yaw,
    rotateHidden: document.querySelector('[data-lm="rotate"]').hidden,
    lightVisible: !document.querySelector('[data-lm="light"]').hidden,
    animations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
  }));
  await context.close();
  expect(a === b, 'The reduced-motion composition changed between two frames six seconds apart');
  expect(later.facts.reduced && later.yaw === 0 && later.rotateHidden, 'Reduced motion still turns the model or shows rotation controls', later);
  expect(later.animations === 0, 'CSS animations are running in reduced motion', later);
  return { first, later: { yaw: later.yaw, rotateHidden: later.rotateHidden, lightControlVisible: later.lightVisible, runningAnimations: later.animations }, identicalFramesSixSecondsApart: true };
});

check('system-motion-setting-followed', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20' });
  await page.waitForTimeout(2600);
  const controls = await page.evaluate(() => ({
    motionControl: Boolean(document.querySelector('[data-lm="motion"], [data-lm="preferences"]')),
    lightInHeader: Boolean(document.querySelector('[data-lm="header"] [data-lm="light"]:not([hidden])')),
    version: [...document.querySelectorAll('[data-lm="version"] button')].map((button) => `${button.textContent.trim()}:${button.getAttribute('aria-pressed')}`),
  }));
  expect(!controls.motionControl, 'A reduce-motion control is still on the page', controls);
  expect(controls.lightInHeader, 'The light control is not in the header', controls);
  expect(controls.version.join('|') === 'Immersive Version:true|Lite Version:false', 'The version choice is not Immersive and Lite with Immersive current', controls);
  await page.click(lm('rotate-right'));
  // The visitor turns on reduced motion in the system settings mid-session.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__lm.intro.snapshot.preferences.reducedMotion === true, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const on = await page.evaluate(() => ({
    reduced: window.__lm.intro.snapshot.preferences.reducedMotion,
    rotateHidden: document.querySelector('[data-lm="rotate"]').hidden,
    hostPreference: window.__lm.host.trace.filter((event) => event.type === 'setPreferences').at(-1).preferences.reducedMotion,
    yaw: window.__lm.intro.stage.yaw,
  }));
  await context.close();
  expect(on.reduced && on.rotateHidden && on.hostPreference === true, 'The system setting did not apply or reach the host', on);
  expect(Math.abs(on.yaw) < 1e-6, 'The model did not return to its still composition', on);
  return { controls, on };
});

// --------------------------------------------------------- graphics fallback
check('graphics-fallback-still', async () => {
  const { page, context, errors } = await open({ query: 'case=normal&hold=39050&speed=20&graphics=still' });
  await page.waitForTimeout(2600);
  await page.waitForFunction("document.querySelector('[data-lm=\"poster\"]').dataset.visible === 'true'", null, { timeout: 20_000 });
  const state = await page.evaluate(() => ({
    graphics: window.__lm.intro.graphics,
    poster: document.querySelector('[data-lm="poster"]').getAttribute('src').split('/').pop(),
    canvasVisible: document.querySelector('[data-lm="canvas"]').dataset.visible,
    body: document.querySelector('[data-lm="body"]').textContent,
    status: document.querySelector('[data-lm="status-label"]').textContent,
    percent: document.querySelector('[data-lm="status-value"]').textContent,
    rotateHidden: document.querySelector('[data-lm="rotate"]').hidden,
    threeLoaded: performance.getEntriesByType('resource').some((entry) => /chunks\/(stage|director)/.test(entry.name)),
  }));
  expect(state.graphics === 'still' && state.poster === 'loading-lounge-warm.webp' && state.canvasVisible === 'false', 'The still did not stand in for the scene', state);
  expect(state.rotateHidden && /simpler preview/.test(state.body), 'The fallback copy or the hidden rotation is wrong', state);
  expect(state.status === 'Preparing lighting' && state.percent === '63%', 'Real status is not shown beside the still', state);
  await page.click(pill('destination', 'motion-floor'));
  await page.click(pill('light', 'soft'));
  await page.waitForFunction("document.querySelector('[data-lm=\"poster\"]').getAttribute('src').endsWith('loading-motion-floor-soft.webp')", null, { timeout: 10_000 });
  const chosen = await snapshot(page);
  await context.close();
  expect(chosen.preferences.destinationId === 'motion-floor' && chosen.preferences.lightMode === 'soft', 'Choices do not work on the still', chosen.preferences);
  expect(errors.length === 0, 'Page errors on the fallback path', errors);
  return { ...state, afterChoices: 'loading-motion-floor-soft.webp' };
});

check('graphics-context-loss', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__lm.intro.stage.renderer.forceContextLoss());
  await page.waitForFunction("window.__lm.intro.graphics === 'still'", null, { timeout: 15_000 });
  await page.waitForFunction("document.querySelector('[data-lm=\"poster\"]').dataset.visible === 'true'", null, { timeout: 15_000 });
  const state = await page.evaluate(() => ({ status: window.__lm.intro.snapshot.status, mode: document.querySelector('.lm-root').dataset.mode, destination: !document.querySelector('[data-lm="destination"]').hidden }));
  await context.close();
  expect(state.mode === 'loading' && state.destination, 'Losing the intro renderer disturbed loading or the choices', state);
  return { ...state, note: 'the intro renderer failing is not a load failure' };
});

// ------------------------------------------------ content security policy
check('strict-content-security-policy', async () => {
  const count = () => {
    const stage = window.__lm.intro.stage;
    let withImage = 0;
    const kinds = new Set();
    stage?.scene.traverse((object) => {
      if (object.isMesh && object.material?.map) { withImage += 1; kinds.add(object.material.map.image?.constructor?.name); }
    });
    return {
      graphics: window.__lm.intro.graphics,
      withImage,
      kinds: [...kinds].sort(),
      fonts: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family).sort(),
    };
  };
  // The usual page first: how many surfaces carry an image.
  const models = (page, list) => page.on('request', (request) => { const name = request.url().split('/').pop().split('?')[0]; if (name.endsWith('.glb')) list.push(name); });
  const usualModels = [];
  const usual = await open({ query: 'case=normal&hold=39050&speed=20', beforeGoto: (page) => models(page, usualModels) });
  await usual.page.waitForTimeout(1500);
  const plain = await usual.page.evaluate(count);
  await usual.context.close();

  // Then dev/csp.html: no inline code, no evaluated strings, no fetch() of blob: URLs.
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const strictModels = [];
  models(page, strictModels);
  const refused = [];
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) refused.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${new URL('dev/csp.html', base)}?case=normal&hold=39050&speed=20&panel=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lm && window.__lm.intro.graphics !== 'pending', null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const strict = await page.evaluate(count);
  const heading = await page.evaluate(() => document.querySelector('[data-lm="heading"]').textContent);
  await context.close();

  // The meshopt decoder is WebAssembly: refused without 'wasm-unsafe-eval'.
  const other = refused.filter((text) => !/blob:|WebAssembly|wasm/i.test(text));
  expect(usualModels[0] === 'Living_Maquette_meshopt.glb' && !usualModels.includes('Living_Maquette_quantized.glb'), 'The usual page did not load the compressed model alone', usualModels);
  expect(strictModels.includes('Living_Maquette_quantized.glb'), 'Under the strict policy the quantized model was not used', strictModels);
  expect(errors.length === 0, 'Page errors under the strict policy', errors);
  expect(other.length === 0, 'The policy refused something other than fetch() of blob: URLs', other.slice(0, 4));
  expect(strict.graphics === '3d', 'The scene did not start under the strict policy', strict);
  expect(strict.withImage === plain.withImage && plain.withImage > 0, 'Surfaces lost their images under the strict policy', { plain, strict });
  expect(strict.kinds.includes('HTMLImageElement'), 'The images did not take the image-element path', strict);
  expect(strict.fonts.length >= 2 && heading.length > 0, 'Fonts or copy missing under the strict policy', { fonts: strict.fonts, heading });
  return {
    policy: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'",
    refusedBlobFetches: refused.length,
    modelsRequested: { usualPage: usualModels, strictPolicy: strictModels },
    surfacesWithImage: { usualPage: plain.withImage, strictPolicy: strict.withImage },
    decodedThrough: { usualPage: plain.kinds, strictPolicy: strict.kinds },
    fonts: strict.fonts,
  };
});

// ------------------------------------------------- responsive and large text
async function clipping(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.lm-root');
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const rail = document.querySelector('[data-lm="status"]').getBoundingClientRect();
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const scroller = document.scrollingElement;
    scroller.scrollTop = scroller.scrollHeight; // the end of the page, where the rail rests in flow
    const controls = [...root.querySelectorAll('[data-lm="main"] button, [data-lm="main"] label.lm-pill, [data-lm="main"] .lm-title, [data-lm="main"] .lm-body')].filter(visible);
    const offPage = [];
    const underRail = [];
    // The header and the rail are read too: their text and controls stay on the page.
    const furniture = [...root.querySelectorAll('[data-lm="header"] .lm-brand, [data-lm="header"] button, [data-lm="status"], [data-lm="status-label"], [data-lm="status-value"], [data-lm="status"] button')].filter(visible);
    for (const element of furniture) {
      const box = element.getBoundingClientRect();
      const name = element.dataset.lm ?? element.className;
      if (box.left < -0.5 || box.right > viewport.width + 0.5) offPage.push({ name, left: Math.round(box.left), right: Math.round(box.right) });
    }
    const railNow = document.querySelector('[data-lm="status"]').getBoundingClientRect();
    for (const element of controls) {
      const box = element.getBoundingClientRect();
      const name = element.dataset.lm ?? element.getAttribute('for') ?? element.className;
      if (box.left < -0.5 || box.right > viewport.width + 0.5) offPage.push({ name, left: Math.round(box.left), right: Math.round(box.right) });
      // Scroll each control into view, then see whether the pinned rail covers it.
      element.scrollIntoView({ block: 'center' });
      const shown = element.getBoundingClientRect();
      const railBox = document.querySelector('[data-lm="status"]').getBoundingClientRect();
      const covered = shown.bottom > railBox.top + 1 && shown.top < railBox.bottom - 1 && shown.right > railBox.left && shown.left < railBox.right;
      if (covered) underRail.push({ name, top: Math.round(shown.top), bottom: Math.round(shown.bottom), railTop: Math.round(railBox.top) });
    }
    scroller.scrollTop = 0;
    return {
      layout: root.dataset.layout,
      viewport,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      rail: [Math.round(rail.left), Math.round(rail.top), Math.round(rail.width), Math.round(rail.height)],
      railAtEnd: Math.round(railNow.bottom),
      offPage,
      underRail,
      body: getComputedStyle(document.querySelector('[data-lm="body"]')).fontSize,
      rootFont: getComputedStyle(document.documentElement).fontSize,
    };
  });
}
/** Tab through the page: no focused control may sit under the pinned rail. */
async function focusClearOfRail(page) {
  await page.evaluate(() => { document.scrollingElement.scrollTop = 0; document.body.focus(); });
  const obscured = [];
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const fact = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || !element.closest('.lm-root')) return null;
      // A radio is drawn by its label.
      const drawn = element.matches('.lm-radio') ? element.nextElementSibling : element;
      const box = drawn.getBoundingClientRect();
      const rail = document.querySelector('[data-lm="status"]').getBoundingClientRect();
      const inRail = Boolean(element.closest('[data-lm="status"]'));
      const covered = !inRail && box.bottom > rail.top + 1 && box.top < rail.bottom - 1;
      const outside = box.top < -1 || box.bottom > window.innerHeight + 1;
      return { name: element.dataset.lm ?? element.id ?? element.tagName.toLowerCase(), covered, outside, top: Math.round(box.top), bottom: Math.round(box.bottom), railTop: Math.round(rail.top) };
    });
    if (!fact) continue; // the browser's own stop between the last control and the first
    if (seen.includes(fact.name)) break;
    seen.push(fact.name);
    if (fact.covered || fact.outside) obscured.push(fact);
  }
  return { order: seen, obscured };
}

check('viewports-and-enlarged-text', async () => {
  const cases = {
    // `fits`: the approved viewports show every state without scrolling.
    'desktop 1440x900': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1440, height: 900 }, fits: true },
    'desktop 1440x900 failure': { query: 'case=failure&speed=10', viewport: { width: 1440, height: 900 }, until: 'failed', fits: true },
    'desktop 1440x900 stall, three actions': { query: 'case=stall&speed=10', viewport: { width: 1440, height: 900 }, until: 'stalled', fits: true },
    'desktop 1280x720': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1280, height: 720 }, fits: true },
    'desktop 1280x720 stall, three actions': { query: 'case=stall&speed=10', viewport: { width: 1280, height: 720 }, until: 'stalled', fits: true },
    'desktop 1920x1080': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1920, height: 1080 } },
    'desktop 1024x768': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1024, height: 768 } },
    'short 1280x560': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1280, height: 560 } },
    'tablet 820x1180': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 820, height: 1180 }, mobile: true },
    'phone 390x844': { query: 'case=normal&hold=39050&speed=20', viewport: PHONE, mobile: true, fits: true },
    'phone 390x844 ready': { query: 'case=returning', viewport: PHONE, mobile: true, until: 'ready', fits: true },
    'phone 390x844 failure': { query: 'case=failure&speed=10', viewport: PHONE, mobile: true, until: 'failed', fits: true },
    'phone 390x844 stall, three actions': { query: 'case=stall&speed=10', viewport: PHONE, mobile: true, until: 'stalled', fits: true },
    'phone 360x800': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 360, height: 800 }, mobile: true },
    'phone 360x640 short': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 360, height: 640 }, mobile: true },
    'phone 360x800 text 150%': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 360, height: 800 }, mobile: true, rootFontPx: 24 },
    'phone 360x800 text 150% failure': { query: 'case=failure&speed=10', viewport: { width: 360, height: 800 }, mobile: true, rootFontPx: 24, until: 'failed' },
    'phone 360x800 text 150% ready': { query: 'case=returning', viewport: { width: 360, height: 800 }, mobile: true, rootFontPx: 24, until: 'ready' },
    'phone 390x844 text 200%': { query: 'case=normal&hold=39050&speed=20', viewport: PHONE, mobile: true, rootFontPx: 32 },
    'phone 390x844 text 200% failure': { query: 'case=failure&speed=10', viewport: PHONE, mobile: true, rootFontPx: 32, until: 'failed' },
    'desktop 1440x900 text 150%': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1440, height: 900 }, rootFontPx: 24 },
    'desktop 1440x900 text 200%': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 1440, height: 900 }, rootFontPx: 32 },
    'browser zoom 200% (720x450)': { query: 'case=normal&hold=39050&speed=20', viewport: { width: 720, height: 450 } },
  };
  const report = {};
  for (const [label, { until, fits, ...options }] of Object.entries(cases)) {
    const { page, context } = await open({ ...options, still: true });
    if (until) await untilMode(page, until);
    else await page.waitForTimeout(2400);
    const result = await clipping(page);
    // Where the rail is pinned and the page scrolls, focus must stay clear of it.
    if (result.layout === 'stacked' && result.pageHeight > result.viewport.height + 1) {
      result.focus = await focusClearOfRail(page);
    }
    await context.close();
    report[label] = result;
    if (options.rootFontPx) expect(result.rootFont === `${options.rootFontPx}px`, `The enlarged text size was not in effect at ${label}`, result);
    if (fits) expect(result.pageHeight <= result.viewport.height + 1, `The page scrolls at ${label}`, result);
    expect(result.pageWidth <= result.viewport.width + 1, `Horizontal overflow at ${label}`, result);
    expect(result.offPage.length === 0, `Controls outside the page at ${label}`, result.offPage);
    expect(result.underRail.length === 0, `Controls covered by the rail at ${label}`, result.underRail);
    if (result.focus) {
      expect(result.focus.order.length >= 4, `Keyboard focus did not move through the page at ${label}`, result.focus);
      expect(result.focus.obscured.length === 0, `A focused control was left under the pinned rail at ${label}`, result.focus.obscured);
    }
  }
  return Object.fromEntries(Object.entries(report).map(([label, result]) => [label, {
    layout: result.layout, page: `${result.pageWidth}x${result.pageHeight}`, scrolls: result.pageHeight > result.viewport.height + 1, rootText: result.rootFont, bodyText: result.body,
    ...(result.focus ? { focusedControlsClearOfRail: result.focus.order.length } : {}),
  }]));
});

// ------------------------------------------------------- host rules, on screen
check('early-entry-while-decoration-unfinished', async () => {
  const { page, context } = await open({ query: 'case=early&speed=1' });
  await untilMode(page, 'ready');
  const atReady = await page.evaluate(() => ({
    decorativeSeconds: +window.__lm.intro.director.time.toFixed(1),
    sinceMountMs: window.__lm.trace.find((event) => event.type === 'world_ready')?.sinceMountMs,
    enter: document.querySelector('[data-lm="enter"]').textContent,
    heading: document.querySelector('[data-lm="heading"]').textContent,
  }));
  // The decorative plan runs 80 s. The reading is taken when this check notices
  // readiness, which the software renderer delays by a few seconds.
  expect(atReady.decorativeSeconds < 40, 'Readiness did not arrive while the decorative sequence was still unfinished', atReady);
  await page.click(lm('enter'));
  const pending = await page.evaluate(() => ({ busy: document.querySelector('[data-lm="enter"]').getAttribute('aria-busy'), label: document.querySelector('[data-lm="status"]').getAttribute('aria-label') }));
  await page.waitForFunction('Boolean(window.__lm.host.entered)', null, { timeout: 20_000 });
  const entered = await page.evaluate(() => ({ host: window.__lm.host.entered, completed: window.__lm.trace.find((event) => event.type === 'entry_completed') }));
  await page.waitForFunction("document.querySelector('.lm-arrival')?.dataset.visible === 'true'", null, { timeout: 20_000 });
  await context.close();
  expect(pending.busy === 'true' && pending.label === 'Entering the lounge', 'The pending acknowledgement was not shown as pending', pending);
  expect(entered.host.destinationId === 'lounge' && entered.host.entryRequestId === 1, 'The host did not commit the current entry', entered);
  return { decorativePlanSeconds: 80, atReady, pending, enteredAfterMountMs: entered.completed.sinceMountMs, handedOver: entered.host };
});

check('already-ready-on-arrival', async () => {
  // Measured on the static fallback so the number is the interface alone.
  const { page, context } = await open({ query: 'case=returning', still: true });
  await untilMode(page, 'ready', 10_000);
  const state = await page.evaluate(() => ({
    readyAfterMountMs: window.__lm.trace.find((event) => event.type === 'world_ready')?.sinceMountMs,
    enter: document.querySelector('[data-lm="enter"]').textContent,
    graphics: window.__lm.intro.graphics,
  }));
  await context.close();
  expect(state.readyAfterMountMs < 500, 'Entry was not available at once for a room that is already usable', state);
  return state;
});

check('route-change-rejects-stale-readiness', async () => {
  // Each room takes eight seconds here, so the first lounge task is still
  // running when the visitor goes lounge -> Motion floor -> lounge.
  const { page, context } = await open({ query: 'case=early&speed=1&route=8000', still: true });
  await page.waitForFunction("window.__lm.host.trace.some((event) => event.type === 'world-complete')", null, { timeout: 30_000 });
  await page.click(pill('destination', 'motion-floor'));
  await page.click(pill('destination', 'lounge'));
  await page.waitForFunction("window.__lm.trace.some((event) => event.source === 'adapter' && event.type === 'patch' && event.readyForEntry && event.accepted === false)", null, { timeout: 40_000 });
  const afterStale = await page.evaluate(() => {
    const stale = window.__lm.trace.find((event) => event.source === 'adapter' && event.type === 'patch' && event.readyForEntry && event.accepted === false);
    return { stale: { scope: stale.scope, accepted: stale.accepted, reason: stale.reason }, canEnter: window.__lm.intro.snapshot.canEnter, mode: document.querySelector('.lm-root').dataset.mode, request: window.__lm.intro.snapshot.destinationRequestId };
  });
  await untilMode(page, 'ready');
  const accepted = await page.evaluate(() => window.__lm.trace.filter((event) => event.source === 'adapter' && event.type === 'patch' && event.readyForEntry && event.accepted).map((event) => event.scope));
  await context.close();
  expect(afterStale.stale.scope.destinationRequestId === 0 && afterStale.request === 2, 'The stale result was not the first lounge request', afterStale);
  expect(accepted.length === 1 && accepted[0].destinationRequestId === 2, 'Readiness was not granted by the latest lounge request alone', accepted);
  return { rejected: afterStale.stale, enterOfferedAfterRejection: afterStale.canEnter, grantedBy: accepted[0] };
});

check('failure-retry-keeps-choices', async () => {
  const { page, context } = await open({ query: 'case=failure&speed=1', still: true });
  await page.click(pill('destination', 'motion-floor'));
  await untilMode(page, 'failed');
  const failed = await page.evaluate(() => ({
    alert: document.querySelector('[data-lm="live-assertive"]').textContent,
    focusable: [...document.querySelectorAll('[data-lm="recovery"] button')].filter((button) => !button.hidden).map((button) => button.textContent.trim()),
    studies: !document.querySelector('[data-lm="studies"]').hidden,
  }));
  expect(/A small pause/.test(failed.alert), 'The failure was not announced as an alert', failed);
  expect(failed.focusable.join('|') === 'Try again|Use Lite Version' && failed.studies, 'Recovery actions or Explore studies are missing', failed);
  // Two activations in the same instant: a real click, then a second one
  // before anything can have changed.
  await page.focus(lm('retry'));
  await page.evaluate(() => { const button = document.querySelector('[data-lm="retry"]'); button.click(); button.click(); });
  await page.waitForFunction('window.__lm.intro.snapshot.attemptId === 1 && !window.__lm.intro.snapshot.retryPending', null, { timeout: 20_000 });
  await page.waitForFunction("window.__lm.trace.filter((event) => event.source === 'adapter' && event.type === 'patch' && event.scope.attemptId === 0 && event.accepted === false).length >= 2", null, { timeout: 20_000 });
  const after = await page.evaluate(() => ({
    retries: window.__lm.host.trace.filter((event) => event.type === 'retry-requested').length,
    preferences: window.__lm.intro.snapshot.preferences,
    staleRejected: window.__lm.trace.filter((event) => event.source === 'adapter' && event.type === 'patch' && event.scope.attemptId === 0 && event.accepted === false).length,
    canEnter: window.__lm.intro.snapshot.canEnter,
  }));
  await untilMode(page, 'ready', 90_000);
  const ready = await page.evaluate(() => ({ heading: document.querySelector('[data-lm="heading"]').textContent, attemptId: window.__lm.intro.snapshot.attemptId }));
  await context.close();
  expect(after.retries === 1, 'More than one retry reached the host', after);
  expect(after.preferences.destinationId === 'motion-floor', 'The chosen room was not kept through retry', after.preferences);
  expect(after.staleRejected >= 2 && after.canEnter === false, 'Late results from the old attempt were not refused', after);
  return { failed, after, ready };
});

check('stall-keep-waiting', async () => {
  const { page, context } = await open({ query: 'case=stall&speed=1', still: true });
  await untilMode(page, 'stalled');
  const stalled = await page.evaluate(() => ({
    heading: document.querySelector('[data-lm="heading"]').textContent,
    actions: [...document.querySelectorAll('[data-lm="recovery"] button')].filter((button) => !button.hidden).map((button) => button.textContent.trim()),
    alert: document.querySelector('[data-lm="live-assertive"]').textContent,
  }));
  expect(stalled.actions.includes('Keep waiting') && stalled.alert === '', 'A stall should offer Keep waiting and must not raise an alert', stalled);
  await page.click(lm('keep-waiting'));
  await page.waitForFunction("document.activeElement?.dataset.lm === 'recovery-reopen'", null, { timeout: 5_000 }).catch(() => {});
  const waiting = { mode: await mode(page), focus: await active(page), choices: await page.evaluate(() => !document.querySelector('[data-lm="destination"]').hidden) };
  expect(waiting.mode === 'stalled-waiting' && waiting.focus === 'recovery-reopen' && waiting.choices, 'Keep waiting did not return the choices with a way back', waiting);
  await untilMode(page, 'loading', 90_000);
  await context.close();
  return { stalled, waiting, cleared: 'the host reported progress again and the page returned to loading' };
});

check('entry-declined-then-retried', async () => {
  const { page, context } = await open({ query: 'case=returning&entry=fail', still: true });
  await untilMode(page, 'ready', 10_000);
  await page.focus(lm('enter'));
  await page.keyboard.press('Enter');
  await page.waitForFunction("document.querySelector('[data-lm=\"note\"]').dataset.tone === 'error'", null, { timeout: 15_000 });
  const declined = await page.evaluate(() => ({
    note: document.querySelector('[data-lm="note"]').textContent || document.querySelector('[data-lm="live-assertive"]').textContent,
    alert: document.querySelector('[data-lm="live-assertive"]').textContent,
    focus: document.activeElement?.dataset.lm,
    busy: document.querySelector('[data-lm="enter"]').getAttribute('aria-busy'),
    mode: document.querySelector('.lm-root').dataset.mode,
  }));
  expect(/could not enter the room/.test(declined.alert) && declined.focus === 'enter' && declined.busy === null && declined.mode === 'ready', 'A declined entry did not return the stable page with a recoverable message', declined);
  await page.keyboard.press('Enter');
  await page.waitForFunction('Boolean(window.__lm.host.entered)', null, { timeout: 15_000 });
  const entered = await page.evaluate(() => window.__lm.host.entered.entryRequestId);
  await context.close();
  return { declined, secondRequestEntered: entered };
});

check('light-version-route', async () => {
  const { page, context } = await open({ query: 'case=normal&hold=39050&speed=20', still: true });
  await page.waitForTimeout(800);
  const early = await page.evaluate(() => !document.querySelector('[data-lm="version"]').hidden);
  expect(early, 'The Lite Version was not offered during initial loading');
  await page.click(pill('destination', 'motion-floor'));
  await page.click(lm('version-lite'));
  await untilMode(page, 'light-landing');
  const landing = await page.evaluate(() => ({
    heading: document.querySelector('[data-lm="heading"]').textContent,
    focus: document.activeElement?.dataset.lm,
    actions: [...document.querySelectorAll('[data-lm="landing-actions"] button')].map((button) => button.textContent.trim()),
  }));
  expect(landing.focus === 'heading' && landing.actions.join('|') === 'Explore the Lite Version|Back to full studio', 'The landing did not take focus or offer both actions', landing);
  await page.click(lm('landing-back'));
  const back = {
    mode: await mode(page),
    destination: (await snapshot(page)).preferences.destinationId,
    immersiveCurrent: await page.evaluate(() => document.querySelector('[data-lm="version-immersive"]').getAttribute('aria-pressed') === 'true'),
  };
  await page.click(lm('version-lite'));
  await untilMode(page, 'light-landing');
  await page.click(lm('landing-enter'));
  await page.waitForFunction("document.querySelector('.lm-arrival')?.dataset.visible === 'true'", null, { timeout: 10_000 });
  const handed = await page.textContent('.lm-arrival-foot');
  await context.close();
  expect(back.mode === 'loading' && back.destination === 'motion-floor' && back.immersiveCurrent, 'Back to full studio did not return with the choice kept', back);
  expect(/motion-floor/.test(handed), 'The light version did not receive the chosen room', { handed });
  return { offeredFromFirstReport: early, landing, back };
});

check('hidden-tab-pauses-decoration', async () => {
  const { page, context } = await open({ query: 'case=normal&speed=1' });
  await page.waitForTimeout(1500);
  const visible = await page.evaluate(async () => {
    const stage = window.__lm.intro.stage;
    const before = stage.stats.frames;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return { frames: stage.stats.frames - before, time: window.__lm.intro.director.time };
  });
  const hidden = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const stage = window.__lm.intro.stage;
    const director = window.__lm.intro.director;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const frames = stage.stats.frames;
    const time = director.time;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const result = { frames: stage.stats.frames - frames, clockAdvanced: +(director.time - time).toFixed(3), hostStillReporting: window.__lm.intro.snapshot.elapsedMs > 0 };
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    return result;
  });
  await context.close();
  expect(hidden.frames === 0 && hidden.clockAdvanced === 0, 'Decorative work continued while the page was hidden', hidden);
  return { framesInTwoAndAHalfSecondsVisible: visible.frames, whileHidden: hidden };
});

// ------------------------------------------------------------------- run
const results = [];
for (const { name, fn } of checks) {
  if (only && !only.has(name)) continue;
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ check: name, pass: true, ms: Date.now() - started, detail });
    console.log(`pass  ${name}  (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ check: name, pass: false, ms: Date.now() - started, error: String(error.message ?? error).split('\n').slice(0, 4).join(' | '), detail: error.detail ?? null });
    console.log(`FAIL  ${name}  ${String(error.message ?? error).split('\n').slice(0, 4).join(' | ')}`);
    if (error.detail) console.log(`      ${JSON.stringify(error.detail).slice(0, 600)}`);
  }
}
await browser.close();
mkdirSync(dirname(out), { recursive: true });
const passed = results.filter((result) => result.pass).length;
writeFileSync(out, `${JSON.stringify({ evidence: 'simulated host; headless Chrome, software renderer', base, ran: new Date().toISOString(), passed, failed: results.length - passed, results }, null, 2)}\n`);
console.log(`${passed} of ${results.length} checks passed`);
process.exitCode = passed === results.length ? 0 : 1;
