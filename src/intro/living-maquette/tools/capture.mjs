/**
 * Runtime captures of the intro at the screen-index viewports, each next to
 * the approved screen it corresponds to.
 *
 *   node tools/capture.mjs --kit <path-to-extracted-kit> [--base http://127.0.0.1:8080/index.html]
 *                          [--out docs/evidence/captures] [--only D03,M01] [--chrome <path>]
 *
 * The page under test is the standalone preview, so everything captured here
 * is simulated-host evidence. Requires Playwright (npm i -D playwright, or set
 * PLAYWRIGHT_DIR to a node_modules folder that has it) and a Chrome build;
 * headless Chrome draws the scene with its software renderer.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const base = option('base', 'http://127.0.0.1:8080/index.html');
const out = resolve(root, option('out', 'docs/evidence/captures'));
const kit = option('kit') ? resolve(option('kit')) : null;
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

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844, mobile: true };
const lm = (name) => `[data-lm="${name}"]`;
const pill = (group, id) => `label[for="lm-${group}-${id}"]`;
const mode = (name) => `document.querySelector('.lm-root')?.dataset.mode === '${name}'`;

/**
 * query:  preview parameters (the simulated host scenario and where to hold it)
 * until:  page expression that must hold before anything else happens
 * steps:  clicks and waits, in order
 * seek:   decorative time to compose (the miniature only; never readiness)
 */
const STATES = [
  { id: 'D01', anchor: 'D01_first_arrival', viewport: DESKTOP, query: 'case=normal&hold=600', seek: 2 },
  { id: 'D02', anchor: 'D02_structure_download', viewport: DESKTOP, query: 'case=normal&hold=15470', seek: 9 },
  { id: 'D03', anchor: 'D03_lighting_theme_anchor', viewport: DESKTOP, query: 'case=normal&hold=39050', seek: 41 },
  { id: 'D04', anchor: 'D04_details_and_familiarisation', viewport: DESKTOP, query: 'case=normal&hold=62010', seek: 63 },
  { id: 'D05', anchor: 'D05_motion_floor_selected', viewport: DESKTOP, query: 'case=normal&hold=70000', seek: 30, steps: [{ click: pill('destination', 'motion-floor') }, { until: 'Boolean(window.__lm.intro.stage?.workspaceRoot)' }] },
  { id: 'D06', anchor: 'D06_soft_light_preference', viewport: DESKTOP, query: 'case=slow&hold=25000&sticky=1', seek: 45, seekFirst: true, steps: [{ click: pill('light', 'soft') }, { wait: 2500 }] },
  { id: 'D07', anchor: 'D07_in-page_preview_studies', viewport: DESKTOP, query: 'case=normal&hold=70000', seek: 30, steps: [{ click: lm('studies') }] },
  { id: 'D08', anchor: 'D08_ready_to_enter', viewport: DESKTOP, query: 'case=early', until: mode('ready') },
  { id: 'D09', anchor: 'D09_slow_active_preparation', viewport: DESKTOP, query: 'case=slow&hold=40000&wait=2500', until: mode('slow'), seek: 75 },
  { id: 'D10', anchor: 'D10_failure_and_recovery', viewport: DESKTOP, query: 'case=failure', until: mode('failed'), seek: 45 },
  { id: 'D11', anchor: 'D11_light_version_landing', viewport: DESKTOP, query: 'case=normal&hold=39050', steps: [{ click: lm('version-lite') }, { until: mode('light-landing') }] },
  // 2026-11 revision: no reduce-motion control; the system setting applies.
  { id: 'D12', anchor: 'D12_preferences_reduced_motion', viewport: DESKTOP, query: 'case=slow&hold=25000', reducedMotion: 'reduce' },
  { id: 'D13', anchor: 'D13_light_study_detail', viewport: DESKTOP, query: 'case=normal&hold=70000', seek: 30, steps: [{ click: lm('studies') }, { click: '[data-study="light"]' }] },
  { id: 'T01', anchor: 'T01_matched_arrival_in_the_lounge', viewport: DESKTOP, query: 'case=early', until: mode('ready'), steps: [{ click: lm('enter') }, { until: "document.querySelector('.lm-arrival')?.dataset.visible === 'true'" }, { wait: 1200 }] },
  { id: 'M01', anchor: 'M01_mobile_arrival', viewport: MOBILE, query: 'case=normal&hold=39050', seek: 41 },
  { id: 'M02', anchor: 'M02_mobile_destination_and_light', viewport: MOBILE, query: 'case=normal&hold=70000', seek: 30, steps: [{ click: pill('destination', 'motion-floor') }, { click: pill('light', 'soft') }, { until: 'Boolean(window.__lm.intro.stage?.workspaceRoot)' }] },
  { id: 'M03', anchor: 'M03_mobile_ready', viewport: MOBILE, query: 'case=early', until: mode('ready') },
  { id: 'M04', anchor: 'M04_mobile_slow_preparation', viewport: MOBILE, query: 'case=slow&hold=40000&wait=2500', until: mode('slow'), seek: 75 },
  { id: 'M05', anchor: 'M05_mobile_preview_studies', viewport: MOBILE, query: 'case=normal&hold=70000', steps: [{ click: lm('studies') }] },
  { id: 'M06', anchor: 'M06_light_study_detail_ready', viewport: MOBILE, query: 'case=early', until: mode('ready'), steps: [{ click: lm('studies') }, { click: '[data-study="light"]' }] },
  { id: 'M07', anchor: 'M07_failure_and_recovery', viewport: MOBILE, query: 'case=failure', until: mode('failed'), seek: 45 },
  { id: 'M08', anchor: 'M08_retry_in_progress', viewport: MOBILE, query: 'case=failure&retry=slow', until: mode('failed'), seek: 45, steps: [{ click: lm('retry') }, { until: mode('retrying') }] },
  { id: 'M09', anchor: 'M09_light_version_landing', viewport: MOBILE, query: 'case=normal&hold=39050', steps: [{ click: lm('version-lite') }, { until: mode('light-landing') }] },
  // The 2026-11 desktop reference: the D03 moment beside the revised design.
  { id: 'R01', reference: 'docs/reference/2026-11_desktop_reference.png', viewport: DESKTOP, query: 'case=normal&hold=39050', seek: 41 },
];

const { chromium } = await loadPlaywright();
const chrome = option('chrome', process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined));
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--font-render-hinting=none'],
});
mkdirSync(out, { recursive: true });

const settle = async (page, ms = 500) => {
  // Interface transitions, then a couple of frames for the canvas.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
  await page.waitForTimeout(ms);
};

async function capture(state) {
  const context = await browser.newContext({
    viewport: { width: state.viewport.width, height: state.viewport.height },
    deviceScaleFactor: 1,
    hasTouch: Boolean(state.viewport.mobile),
    isMobile: Boolean(state.viewport.mobile),
    reducedMotion: state.reducedMotion ?? 'no-preference',
  });
  try {
    return await captureIn(context, state);
  } finally {
    await context.close(); // also when a step times out: a leaked page keeps drawing
  }
}

async function captureIn(context, state) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  const speed = /hold=/.test(state.query) ? 20 : 10;
  await page.goto(`${base}?${state.query}&speed=${speed}&panel=0`, { waitUntil: 'load' });
  await page.waitForFunction("window.__lm && window.__lm.intro.graphics !== 'pending'", null, { timeout: 90_000 });
  const hold = /hold=(\d+)/.exec(state.query);
  if (hold) await page.waitForTimeout(Number(hold[1]) / speed + 600);
  if (state.until) await page.waitForFunction(state.until, null, { timeout: 90_000 });
  const compose = async () => {
    await page.evaluate((seconds) => window.__lm.intro.director?.seek(seconds), state.seek);
    await settle(page, 300);
    // A second pass: groups that became visible on the first one are composed now.
    await page.evaluate((seconds) => window.__lm.intro.director?.seek(seconds), state.seek);
  };
  if (state.seek !== undefined && state.seekFirst) await compose();
  for (const step of state.steps ?? []) {
    if (step.click) await page.click(step.click);
    if (step.until) await page.waitForFunction(step.until, null, { timeout: 90_000 });
    if (step.wait) await page.waitForTimeout(step.wait);
    await settle(page, 250);
  }
  if (state.seek !== undefined && !state.seekFirst) await compose();
  await settle(page, 1400);
  const file = join(out, `${state.id}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  const facts = await page.evaluate(() => ({
    mode: document.querySelector('.lm-root')?.dataset.mode ?? null,
    layout: document.querySelector('.lm-root')?.dataset.layout ?? null,
    graphics: window.__lm?.intro.graphics ?? null,
    heading: document.querySelector('[data-lm="heading"]')?.textContent ?? null,
    status: document.querySelector('[data-lm="status-label"]')?.textContent ?? null,
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  }));
  return { id: state.id, file, problems, ...facts };
}

async function pair(state) {
  const anchor = state.reference ? join(root, state.reference) : kit && join(kit, '01_ui_package/screens/png', `${state.anchor}.png`);
  if (!anchor || !existsSync(anchor)) return null;
  const title = state.reference ? 'Revised design (2026-11 reference)' : `Approved screen: ${state.anchor}`;
  const toData = (path) => `data:image/${path.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(path).toString('base64')}`;
  const { width, height } = state.viewport;
  const context = await browser.newContext({ viewport: { width: width * 2 + 24, height: height + 44 } });
  const page = await context.newPage();
  await page.setContent(`<body style="margin:0;background:#2a2019;color:#f5eadd;font:13px/44px system-ui,sans-serif">
    <div style="display:flex;gap:24px"><div style="width:${width}px;padding-left:12px">${title}</div><div>Runtime capture: ${state.id} (three.js r186, simulated host)</div></div>
    <div style="display:flex;gap:24px"><img width="${width}" height="${height}" src="${toData(anchor)}"><img width="${width}" height="${height}" src="${toData(join(out, `${state.id}.jpg`))}"></div></body>`);
  const file = join(out, `${state.id}_vs_approved.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  await context.close();
  return file;
}

const results = [];
for (const state of STATES) {
  if (only && !only.has(state.id)) continue;
  try {
    const result = await capture(state);
    result.comparison = await pair(state);
    results.push(result);
    console.log(`${state.id}  ${result.layout}  ${result.mode}  "${result.status ?? ''}"${result.problems.length ? `  PAGE ERRORS: ${result.problems.join(' | ')}` : ''}`);
  } catch (error) {
    results.push({ id: state.id, failed: String(error.message ?? error).split('\n')[0] });
    console.log(`${state.id}  FAILED  ${String(error.message ?? error).split('\n')[0]}`);
  }
}
await browser.close();
const reportPath = join(out, 'captures.json');
const previous = existsSync(reportPath) && only ? JSON.parse(readFileSync(reportPath, 'utf8')).captures : [];
const merged = [...previous.filter((item) => !results.some((result) => result.id === item.id)), ...results]
  .map((item) => ({ ...item, file: item.file && item.file.replace(`${root}/`, ''), comparison: item.comparison && item.comparison.replace(`${root}/`, '') }))
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(reportPath, `${JSON.stringify({ evidence: 'simulated host, headless Chrome software renderer', base, captures: merged }, null, 2)}\n`);
process.exitCode = results.some((result) => result.failed || result.problems?.length) ? 1 : 0;
