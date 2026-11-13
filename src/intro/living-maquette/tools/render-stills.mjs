/**
 * Pre-render the stills that stand in for the live miniature: the first-paint
 * poster, the reduced-motion composition and the graphics fallback.
 *
 *   node tools/render-stills.mjs [--base http://127.0.0.1:8080] [--chrome <path>] [--ppu 72]
 *
 * Each still is drawn by dev/stills.html with the runtime's own stage, look and
 * director, so it lines up with the canvas that later replaces it. Output:
 * assets/images/stills/<name>.webp (transparent, STILL.bleed around the frame).
 * Requires Playwright and Chrome (see tools/capture.mjs).
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const base = option('base', 'http://127.0.0.1:8080');
const pixelsPerUnit = Number(option('ppu', 72));

export const STILL_NAMES = [
  'structure-warm',
  ...['loading', 'ready'].flatMap((kind) => ['lounge', 'motion-floor'].flatMap((room) => ['warm', 'soft'].map((light) => `${kind}-${room}-${light}`))),
];

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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const out = join(root, 'assets/images/stills');
mkdirSync(out, { recursive: true });
let total = 0;
for (const name of STILL_NAMES) {
  // A fresh page per still: one WebGL context each, nothing carried over.
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  page.on('pageerror', (error) => console.log(`[${name}]`, error.message));
  await page.goto(`${base}/dev/stills.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
  const still = await page.evaluate((options) => window.renderStill(options), { name, pixelsPerUnit });
  const bytes = Buffer.from(still.dataUrl.split(',')[1], 'base64');
  writeFileSync(join(out, `${name}.webp`), bytes);
  total += bytes.length;
  console.log(`${name}.webp  ${still.width}x${still.height}  ${(bytes.length / 1024).toFixed(1)} KB`);
  await page.close();
}
await browser.close();
console.log(`total ${(total / 1024).toFixed(1)} KB`);
