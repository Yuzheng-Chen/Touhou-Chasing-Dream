/**
 * Chaos / "monkey" test with several independent players and REAL mouse input.
 *
 * Each seat plays through the UI (driver.mjs) while a monkey, per seat, hammers the page with the mouse:
 * random hovers (all over the table, over cards, over seats), random clicks on visible buttons and cards,
 * hotkeys, opening sheets and closing them again, emotes, tab switches in the log panel, resizes.
 * The game must still complete, no seat may throw a page error or log a console error, no text may show
 * "undefined"/"NaN"/"[object", and no hover preview may linger after the pointer leaves cards.
 *
 *   node e2e/monkey.mjs --players 4 --games 1 --seed 7
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const N = Number(args.players ?? 4);
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });

// Tiny seeded PRNG so a failing run can be replayed with --seed.
let s = Number(args.seed ?? Date.now() % 100000) >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
log(`monkey seed ${args.seed ?? s}`);

const server = await startServer(args.url);
const browser = await chromium.launch({ headless: args.headed !== 'true' });
const problems = [];
const seats = [];

for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[seat ${i}] pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`[seat ${i}] console: ${m.text()}`));
  seats.push({ ctx, page, i });
}

/** One random mouse action. Never presses anything that leaves the room or kicks people. */
async function monkey({ page }) {
  const roll = rand();
  const vp = page.viewportSize();
  if (roll < 0.35) {
    await page.mouse.move(rand() * vp.width, rand() * vp.height, { steps: 1 + Math.floor(rand() * 6) });
  } else if (roll < 0.6) {
    // hover a random card (previews + glossary)
    const cards = await page.$$('.card');
    if (cards.length) {
      const b = await pick(cards).boundingBox();
      if (b) await page.mouse.move(b.x + b.width * rand(), b.y + b.height * rand(), { steps: 2 });
    }
  } else if (roll < 0.78) {
    // click somewhere harmless-ish: a random button/card that is not a leave/kick/reset control
    const targets = await page.$$('button:not([disabled]), .card.is-clickable, .seat, .tab');
    const el = pick(targets);
    if (el) {
      const text = ((await el.textContent().catch(() => '')) || '').trim();
      const label = (await el.getAttribute('aria-label').catch(() => '')) || '';
      if (!/离开|退出|重置|取消托管|跳过教学|×/.test(text + label)) await el.click({ timeout: 800, trial: false }).catch(() => {});
    }
  } else if (roll < 0.86) {
    await page.keyboard.press(pick(['Escape', 'l', '1', '2', '3', ' ', 'Tab']));
  } else if (roll < 0.92) {
    await page.click(pick(['text=规则', 'text=图鉴', '.topbar .btn--icon']), { timeout: 600 }).catch(() => {});
    await sleep(120);
    await page.keyboard.press('Escape');
  } else if (roll < 0.97) {
    await page.click('.emotepicker .btn', { timeout: 500 }).catch(() => {});
    await page.click(`.emotepicker__pop button >> nth=${Math.floor(rand() * 8)}`, { timeout: 500 }).catch(() => {});
  } else {
    await page.setViewportSize({ width: pick([1100, 1280, 1440, 1600]), height: pick([720, 820, 900]) });
  }
}

async function sanity({ page, i }) {
  const bad = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/undefined|NaN|\[object|null\b/);
    return m ? m[0] : null;
  });
  if (bad) problems.push(`[seat ${i}] page text contains "${bad}"`);
}

let ok = false;
try {
  const [host, ...guests] = seats;
  await host.page.goto(server.url);
  await host.page.fill('.field input', '猴子1');
  await host.page.click('.home__create');
  await host.page.waitForSelector('.lobby__code');
  const code = (await host.page.textContent('.lobby__code')).trim().slice(0, 4);
  for (const g of guests) {
    await g.page.goto(server.url);
    await g.page.fill('.field input', `猴子${g.i + 1}`);
    await g.page.fill('.home__code', code);
    await g.page.click('.home__join .btn--gold');
    await g.page.waitForSelector('.lobby__code');
  }
  await host.page.waitForFunction((n) => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === n, N);
  log(`room ${code} with ${N} seats; starting`);
  await host.page.click('.lobby__foot .btn--primary');
  for (const x of seats) await x.page.waitForSelector('.rolepick', { timeout: 15000 });

  let done = false;
  const loops = seats.flatMap((x) => [
    // the "player": reacts like a human, at human speed
    (async () => {
      while (!done) {
        await x.page.evaluate(ACT, rand()).catch(() => {});
        await sleep(40 + rand() * 120);
      }
    })(),
    // the monkey
    (async () => {
      while (!done) {
        await monkey(x).catch(() => {});
        await sleep(30 + rand() * 90);
      }
    })(),
  ]);

  const t0 = Date.now();
  let checked = 0;
  while (Date.now() - t0 < 360_000) {
    const finished = await Promise.all(seats.map((x) => x.page.locator('.results__sheet').count()));
    if (finished.every((c) => c > 0)) break;
    if (++checked % 15 === 0) for (const x of seats) await sanity(x);
    await sleep(400);
  }
  done = true;
  await Promise.all(loops);
  for (const x of seats) assert.equal(await x.page.locator('.results__sheet').count(), 1, `seat ${x.i} reached the results screen despite the monkey`);

  // Pointer leaves every card → no preview may remain.
  for (const x of seats) {
    await x.page.keyboard.press('Escape');
    await x.page.mouse.move(2, 2, { steps: 2 });
  }
  await sleep(500);
  for (const x of seats) {
    const lingering = await x.page.evaluate(() => document.querySelector('.card-preview')?.querySelectorAll('.card').length ?? 0);
    assert.equal(lingering, 0, `seat ${x.i}: a card preview lingers after the pointer left`);
    await sanity(x);
  }
  await seats[0].page.screenshot({ path: `${OUT}/monkey-final.png` });
  assert.deepEqual(problems, [], `problems:\n${problems.slice(0, 12).join('\n')}`);
  ok = true;
  log(`✔ monkey test passed (${N} seats, game completed under random mouse input)`);
} catch (e) {
  console.error('✘ FAILED:', e.message);
  await Promise.all(seats.map((x) => x.page.screenshot({ path: `${OUT}/monkey-FAIL-seat${x.i}.png` }).catch(() => {})));
  if (problems.length) console.error(problems.slice(0, 12).join('\n'));
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
