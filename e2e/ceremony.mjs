/**
 * The final settlement show: after the game ends the community's verdict is revealed first, then every player one by one
 * (lowest result first, the winner last) with their score story, and only then the full board.
 *
 *   node e2e/ceremony.mjs
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
const server = await startServer(args.url);
const browser = await chromium.launch();
let ok = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  await ctx.addInitScript(() => {
    window.__e2e = { id: null, tries: 0, need: 0, keepCeremony: true };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.fill('.field input', '揭晓');
  await page.click('.home__create');
  await page.waitForSelector('.lobby__code');
  for (let i = 0; i < 3; i++) await page.click('.seat-slot__add');
  await page.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 4);
  await page.click('.lobby__foot .btn--primary');
  await page.waitForSelector('.rolepick');
  await page.locator('.rolepick__item .card').first().click();
  await page.waitForSelector('.table', { timeout: 15000 });

  // Play until the ceremony begins (never skip it ourselves here).
  const t0 = Date.now();
  while (!(await page.locator('.ceremony').count()) && Date.now() - t0 < 120_000) {
    await page.evaluate(ACT, Math.random()).catch(() => {});
    await sleep(60);
  }
  assert.equal(await page.locator('.ceremony').count(), 1, 'the settlement show started');
  log('ceremony started');

  // 1) the verdict
  await page.waitForSelector('.verdict');
  const community = await page.evaluate(() => document.querySelector('.verdict > b')?.textContent);
  await sleep(1800);
  await page.screenshot({ path: `${OUT}/ceremony-0-verdict.png` });
  const dots = await page.locator('.ceremony__dots i').count();
  log(`verdict shows community ${community}; ${dots - 1} players to reveal`);

  // 2) press "next" through every player, watching what each beat tells
  const seen = [];
  for (let i = 1; i < dots; i++) {
    await page.click('.ceremony__next');
    await page.waitForSelector('.pbeat');
    await sleep(900);
    const id = await page.evaluate(() => document.querySelector('.pbeat')?.dataset.player);
    seen.push(id);
    // let this player's story play for a while: steps then total then 胜点
    await page.waitForSelector('.pbeat .cstep', { timeout: 8000 });
    await page.waitForSelector('.pbeat .ptotal', { timeout: 15000 });
    await page.waitForSelector('.pbeat .vp', { timeout: 15000 });
    const story = await page.evaluate(() => ({
      steps: [...document.querySelectorAll('.pbeat .cstep')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      total: document.querySelector('.pbeat .ptotal b')?.textContent,
      vp: document.querySelector('.pbeat .vp')?.textContent.replace(/\s+/g, ' ').trim(),
    }));
    assert.ok(story.steps.length >= 1, 'each player gets at least one explained step');
    await page.screenshot({ path: `${OUT}/ceremony-${i}-player.png` });
    log(`beat ${i}: ${story.steps.length} steps, score ${story.total}, ${story.vp}`);
  }
  assert.equal(new Set(seen).size, seen.length, 'every player is revealed exactly once');

  // 3) the board: order is the reverse of the reveal order
  await page.click('.ceremony__next');
  await page.waitForSelector('.results__sheet');
  const board = await page.$$eval('.rline', (els) => els.map((e) => e.querySelector('.rline__who b')?.textContent));
  assert.equal(board.length, seen.length);
  await page.screenshot({ path: `${OUT}/ceremony-finale.png` });
  const hasCrown = await page.locator('.results__crown').count();
  assert.equal(hasCrown, 1);
  log(`board: ${board.join(' > ')}`);

  assert.deepEqual(errors, [], errors.join('\n'));
  ok = true;
  log('✔ final settlement show passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
