/**
 * Record a representative runtime transition: the glass and light line arrive,
 * the lounge resolves, Warm/Soft, a small rotation, the Motion floor swap, the
 * host-ready assembly and the entry push.
 *
 *   node tools/record-transition.mjs [--base http://127.0.0.1:8080] [--out docs/evidence/transition] [--fps 15]
 *
 * dev/record.html steps the live stage and director on a virtual clock, so the
 * motion is the eased motion a visitor sees even though the software renderer
 * used by headless Chrome draws well below real time. Frames are joined with
 * ffmpeg when it is on the PATH. Requires Playwright and Chrome.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const base = option('base', 'http://127.0.0.1:8080');
const out = resolve(root, option('out', 'docs/evidence/transition'));
const fps = Number(option('fps', 15));

// [label, start (decorative seconds; null continues), duration, { at: [offset, action] }]
const STORYBOARD = [
  { label: 'The glass and the light line arrive', from: 11.4, seconds: 7.4 },
  { label: 'The lounge resolves', seconds: 6.6 },
  { label: 'Soft light, then Warm again', seconds: 6.0, at: [[0.4, 'soft'], [3.2, 'warm']] },
  { label: 'A small rotation', seconds: 4.4, at: [[0.3, 'right'], [0.9, 'right'], [2.3, 'left'], [2.9, 'left']] },
  { label: 'Motion floor, then the lounge', seconds: 6.4, at: [[0.4, 'motion-floor'], [3.4, 'lounge']] },
  { label: 'The host reports the room ready', seconds: 4.6, at: [[0.6, 'ready']] },
  { label: 'Entry acknowledged', seconds: 1.3, at: [[0.2, 'enter']] },
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
const browser = await chromium.launch({
  executablePath: option('chrome', process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined)),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
await page.goto(`${base}/dev/record.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120_000 });

const frames = join(out, 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
let index = 0;
const marks = [];
const started = Date.now();
for (const segment of STORYBOARD) {
  if (segment.from !== undefined) await page.evaluate((seconds) => window.recorder.seek(seconds), segment.from);
  const count = Math.round(segment.seconds * fps);
  const pending = [...(segment.at ?? [])];
  for (let i = 0; i < count; i += 1) {
    const elapsed = i / fps;
    const apply = [];
    while (pending.length && pending[0][0] <= elapsed + 1e-6) apply.push(pending.shift()[1]);
    const time = await page.evaluate((options) => window.recorder.frame(options), { dt: 1 / fps, label: segment.label, apply });
    if (i === 0 || apply.length) marks.push({ frame: index, decorativeSeconds: +time.toFixed(2), label: segment.label, apply });
    await page.screenshot({ path: join(frames, `f${String(index).padStart(4, '0')}.png`) });
    index += 1;
  }
  console.log(`${segment.label}: ${count} frames`);
}
await browser.close();
console.log(`${index} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
writeFileSync(join(out, 'storyboard.json'), `${JSON.stringify({ fps, frames: index, evidence: 'live stage and director on a virtual clock; headless Chrome software renderer; readiness and entry are simulated', marks }, null, 2)}\n`);

const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpeg.status === 0) {
  const input = ['-y', '-framerate', String(fps), '-i', join(frames, 'f%04d.png')];
  const mp4 = spawnSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(out, 'transition.mp4')], { encoding: 'utf8' });
  console.log(mp4.status === 0 ? 'wrote transition.mp4' : mp4.stderr.split('\n').slice(-4).join('\n'));
  // A contact strip of key moments for a quick look without a player.
  const picks = marks.filter((mark) => mark.apply.length || mark.frame === 0).map((mark) => mark.frame + Math.round(fps * 1.2)).filter((frame) => frame < index);
  if (mp4.status === 0) rmSync(frames, { recursive: true, force: true });
  void picks;
} else {
  console.log('ffmpeg not found: frames kept in', frames);
}
