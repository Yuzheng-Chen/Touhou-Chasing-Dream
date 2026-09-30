/**
 * Test of the local multi-seat console (/local): several human seats in ONE browser window, each an
 * independent identity. Plays a full game through the console, checking that seats are isolated.
 *
 *   node e2e/local.mjs --seats 4
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const SEATS = Number(args.seats ?? 4);
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });

const server = await startServer(args.url);
const browser = await chromium.launch({ headless: args.headed !== 'true' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));

let ok = false;
try {
  await page.goto(`${server.url}/local?n=${SEATS}`);
  await page.screenshot({ path: `${OUT}/local-setup.png` });
  await page.click('.local__card .btn--primary');

  // Seat iframes appear (seat 1 first, the rest once the room code is known).
  await page.waitForFunction((n) => document.querySelectorAll('.local__stage iframe').length === n, SEATS, { timeout: 20000 });
  const seatFrames = () => page.frames().filter((f) => /[?&]as=/.test(f.url()));
  const frameFor = (i) => seatFrames().find((f) => new URL(f.url()).searchParams.get('as').endsWith(String(i + 1)));
  for (let i = 0; i < SEATS; i++) await frameFor(i).waitForSelector('.lobby__code', { timeout: 20000 });
  log(`${SEATS} seats seated in one room`);

  // Independent identities: each iframe shows its own nickname as "you" and the same room code.
  const codes = new Set();
  for (let i = 0; i < SEATS; i++) {
    const f = frameFor(i);
    codes.add((await f.textContent('.lobby__code')).trim().slice(0, 4));
    assert.equal((await f.textContent('.seat-slot.is-you .seat-slot__name')).replace('👑', '').trim(), `玩家${i + 1}`);
  }
  assert.equal(codes.size, 1, 'all seats are in the same room');
  await page.screenshot({ path: `${OUT}/local-lobby.png` });

  // Start from the console's button (forwarded to seat 1).
  await page.click('.local__actions .btn--gold');
  for (let i = 0; i < SEATS; i++) await frameFor(i).waitForSelector('.rolepick', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/local-rolepick.png` });

  // Drive every seat; switch tabs with Alt+N while playing.
  let done = false;
  const drivers = Array.from({ length: SEATS }, (_, i) => (async () => {
    while (!done) {
      try {
        const did = await frameFor(i).evaluate(ACT, Math.random());
        await sleep(did ? 25 : 90);
      } catch { await sleep(200); }
    }
  })());

  let sawDot = false;
  let shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    if (await page.locator('.seat-tab__dot').count()) sawDot = true;
    if (shots === 0 && (await frameFor(0).locator('.table .myarea__role').count())) {
      await sleep(1500);
      await page.keyboard.press('Alt+2');
      await sleep(300);
      assert.ok(await page.locator('.seat-tab.is-active:nth-child(2)').count(), 'Alt+2 selects seat 2');
      await page.screenshot({ path: `${OUT}/local-focus-seat2.png` });
      await page.click('.local__actions .btn:has-text("总览")');
      await sleep(800);
      await page.screenshot({ path: `${OUT}/local-grid.png` });

      // Isolation: in every seat's own window, only its own role is face-up (unless revealed by play).
      for (let i = 0; i < SEATS; i++) {
        const f = frameFor(i);
        const ownRole = await f.locator('.myarea__role .card').first().getAttribute('aria-label');
        assert.ok(ownRole, `seat ${i + 1} sees its own role`);
        const [hiddenOpp, revealedOpp] = await f.evaluate(() => [
          document.querySelectorAll('.seat__role > .card--back').length,
          document.querySelectorAll('.seat__role > .card:not(.card--back)').length,
        ]);
        assert.equal(hiddenOpp + revealedOpp, SEATS - 1);
        log(`seat ${i + 1}: role ${ownRole}; opponents face-down ${hiddenOpp}, face-up ${revealedOpp}`);
      }
      await page.click('.local__actions .btn:has-text("聚焦")');
      shots++;
    }
    if ((await Promise.all(Array.from({ length: SEATS }, (_, i) => frameFor(i).locator('.results__sheet').count()))).every((c) => c > 0)) break;
    await sleep(300);
  }
  done = true;
  await Promise.all(drivers);
  assert.ok(sawDot, 'a seat tab showed a "waiting for you" dot at some point');
  for (let i = 0; i < SEATS; i++) assert.equal(await frameFor(i).locator('.results__sheet').count(), 1, `seat ${i + 1} got results`);
  await page.screenshot({ path: `${OUT}/local-results.png` });
  log('game finished in the console; results shown on every seat');

  // Rematch from the console.
  await page.click('.local__actions .btn:has-text("再来一局")');
  for (let i = 0; i < SEATS; i++) await frameFor(i).waitForSelector('.lobby__code', { timeout: 10000 });
  log('rematch → back in the lobby');

  assert.deepEqual(problems, [], problems.join('\n'));
  ok = true;
  log(`✔ local console with ${SEATS} seats passed`);
} catch (e) {
  console.error('✘ FAILED:', e.message);
  await page.screenshot({ path: `${OUT}/local-FAIL.png` }).catch(() => {});
  if (problems.length) console.error(problems.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
