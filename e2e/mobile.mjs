/**
 * Responsive smoke test: Home, Lobby and a live table at phone / tablet / laptop sizes, playing
 * against AI seats. Fails on horizontal page overflow, or a decision panel that is off-screen.
 *
 *   node e2e/mobile.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1280, height: 720 },
];

const server = await startServer(args.url);
const browser = await chromium.launch({ headless: true });
const failures = [];

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.width < 900, isMobile: size.width < 900 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const overflow = async (where) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (o.sw > o.iw + 1) failures.push(`${size.name} ${where}: horizontal overflow ${o.sw} > ${o.iw}`);
  };
  try {
    await page.goto(server.url);
    await page.fill('.field input', '手机玩家');
    await sleep(1200);
    await page.screenshot({ path: `${OUT}/m-${size.name}-home.png` });
    await overflow('home');

    await page.click('.home__create');
    await page.waitForSelector('.lobby__code');
    for (let i = 0; i < 3; i++) { await page.click('.seat-slot__add'); await sleep(120); }
    await sleep(500);
    await page.screenshot({ path: `${OUT}/m-${size.name}-lobby.png` });
    await overflow('lobby');

    await page.click('.lobby__foot .btn--primary');
    await page.waitForSelector('.rolepick');
    await sleep(800);
    await page.screenshot({ path: `${OUT}/m-${size.name}-roles.png` });
    await overflow('role pick');

    // Play until a turn prompt shows, then look at the table with the decision panel open.
    let shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !shot) {
      const did = await page.evaluate(ACT, 0.99).catch(() => null);
      const kind = await page.evaluate(() => document.querySelector('.decide')?.dataset.kind ?? null);
      if (kind === 'turn' && (await page.locator('.hand__card').count()) >= 2) {
        await sleep(600);
        await page.screenshot({ path: `${OUT}/m-${size.name}-table.png` });
        await overflow('table');
        const box = await page.locator('.decide').boundingBox();
        if (!box || box.y < 0 || box.y + box.height > size.height + 1) failures.push(`${size.name}: decision panel off-screen ${JSON.stringify(box)}`);
        shot = true;
      }
      await sleep(did ? 40 : 120);
    }
    if (!shot) failures.push(`${size.name}: never reached a turn prompt`);
    if (errors.length) failures.push(`${size.name}: ${errors[0]}`);
    log(`${size.name} ${size.width}×${size.height} checked`);
  } finally {
    await ctx.close();
  }
}

await browser.close();
server.stop();
if (failures.length) {
  console.error('✘ responsive problems:\n' + failures.join('\n'));
  process.exit(1);
}
log('✔ responsive smoke test passed');
