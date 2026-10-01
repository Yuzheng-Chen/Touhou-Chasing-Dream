/**
 * "中止本局" vote with two real browser players + one AI.
 * A refusal keeps the game going (and the proposer waits out a cooldown); unanimous agreement returns both players to the room.
 *
 *   node e2e/vote.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });
const server = await startServer(args.url);
const browser = await chromium.launch();
const problems = [];
let ok = false;
try {
  const [a, b] = await Promise.all([0, 1].map(async (i) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => problems.push(`seat ${i}: ${e.message}`));
    return page;
  }));

  await a.goto(server.url);
  await a.fill('.field input', '甲');
  await a.click('.home__create');
  await a.waitForSelector('.lobby__code');
  const code = (await a.textContent('.lobby__code')).trim().slice(0, 4);
  await b.goto(server.url);
  await b.fill('.field input', '乙');
  await b.fill('.home__code', code);
  await b.click('.home__join .btn--gold');
  await b.waitForSelector('.lobby__code');
  await a.click('.seat-slot__add');
  await a.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 3);
  await a.click('.lobby__foot .btn--primary');
  for (const p of [a, b]) {
    await p.waitForSelector('.rolepick');
    await p.locator('.rolepick__item .card').first().click();
    await p.waitForSelector('.table', { timeout: 10000 });
  }
  log('2 humans + 1 AI in a running game');

  // 1) Refusal
  await a.click('.topbar__abort');
  await b.waitForSelector('.votemodal');
  assert.match(await b.textContent('.votemodal'), /甲 提议|提议/);
  await b.screenshot({ path: `${OUT}/vote-modal.png` });
  assert.equal(await a.locator('.votemodal .btn').count(), 0, 'the proposer has no buttons (already voted yes)');
  await b.click('.votemodal .btn:has-text("拒绝")');
  await a.waitForSelector('.votemodal', { state: 'detached' });
  await b.waitForSelector('.votemodal', { state: 'detached' });
  assert.equal(await a.locator('.table').count(), 1, 'game continues after a refusal');
  await a.waitForSelector('.toast:has-text("拒绝")');
  log('refusal keeps the game');

  // 2) Cooldown for the same proposer
  await a.click('.topbar__abort');
  await a.waitForSelector('.toast:has-text("秒后再试")', { timeout: 5000 });
  assert.equal(await b.locator('.votemodal').count(), 0, 'no vote opened during the cooldown');
  log('cooldown after a refusal');

  // 3) Unanimous → both back in the room
  await b.click('.topbar__abort');
  await a.waitForSelector('.votemodal');
  await a.click('.votemodal .btn--gold:has-text("同意")');
  for (const p of [a, b]) {
    await p.waitForSelector('.lobby__code', { timeout: 8000 });
    assert.equal(await p.locator('.table').count(), 0);
  }
  log('unanimous vote returned both players to the room');

  // The room is usable again: a new game can start.
  await a.click('.lobby__foot .btn--primary');
  for (const p of [a, b]) await p.waitForSelector('.rolepick', { timeout: 8000 });
  log('a new game starts from the same room');

  assert.deepEqual(problems, [], problems.join('\n'));
  ok = true;
  log('✔ abort vote passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
  if (problems.length) console.error(problems.join('\n'));
} finally {
  await sleep(100);
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
