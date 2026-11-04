// Optional browser regression. Set QA_PLAYWRIGHT_MODULE to an installed Playwright
// or playwright-core module and CHROME_PATH if supplying your own Chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 558 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/studio?embed=lounge&display=tv&f=1&i=3', process.env.BASE_URL || 'http://127.0.0.1:3001').href);
  await page.locator('.card[data-active]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('.card img, .stage__plate')].every(img => img.complete && img.naturalWidth));
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole('button', { name: 'Control center' }).click();
    for (const prefix of ['Sound', 'Captions', 'Language']) {
      const tile = page.getByRole('button', { name: new RegExp('^' + prefix) });
      const element = await tile.elementHandle();
      await element.focus();
      for (let press = 0; press < 2; press++) {
        const before = await element.innerText();
        await page.keyboard.press('Space');
        await page.waitForFunction(({ node, before }) =>
          node.isConnected && document.activeElement === node && node.innerText !== before,
          { node: element, before }, { timeout: 2000 });
      }
      await element.dispose();
    }
    await page.keyboard.press('Escape');
    await page.locator('.cc').waitFor({ state: 'hidden' });
    const grid = page.getByRole('button', { name: 'See all 50 films' });
    await grid.hover();
    await page.waitForTimeout(150);
    await grid.click();
    const cells = page.locator('.overview__cell');
    assert.equal(await cells.count(), 50);
    assert.equal(await cells.evaluateAll(nodes => new Set(nodes.map(n => n.getAttribute('aria-label'))).size), 50);
    assert.ok(await page.locator('.overview__cell[aria-current]').evaluate(el => el === document.activeElement));
    await cells.last().focus();
    await page.keyboard.press('Enter');
    await page.locator('.overview').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.card[data-active]')?.getAttribute('data-film-id') === 'title-design-food-beverage');
  }
  assert.deepEqual(errors, []);
  console.log('PASS. Native preference tiles retained focus across updates and repeat opens. All 50 films remained selectable.');
} finally {
  await browser.close();
}
