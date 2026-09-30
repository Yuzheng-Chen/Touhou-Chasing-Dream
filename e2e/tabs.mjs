/**
 * Independent seats in ONE browser profile via `?as=`: tabs share localStorage, so identity must be
 * namespaced. Checks distinct players, same room, identity surviving a reload, and that a plain tab
 * (no `?as=`) is yet another identity.
 *
 *   node e2e/tabs.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { log, parseArgs, startServer } from './lib.mjs';

const args = parseArgs();
const server = await startServer(args.url);
const browser = await chromium.launch();
const ctx = await browser.newContext(); // ONE profile: shared localStorage
let ok = false;
try {
  const a = await ctx.newPage();
  await a.goto(`${server.url}/?as=alice&name=Alice`);
  await a.click('.home__create');
  await a.waitForSelector('.lobby__code');
  const code = (await a.textContent('.lobby__code')).trim().slice(0, 4);

  const join = async (query, who) => {
    const p = await ctx.newPage();
    await p.goto(`${server.url}/${query}`);
    if (who) await p.fill('.field input', who);
    await p.fill('.home__code', code);
    await p.click('.home__join .btn--gold');
    await p.waitForSelector('.lobby__code');
    return p;
  };
  const b = await join('?as=bob&name=Bob');
  const plain = await join('', '路人');

  const youOf = (p) => p.textContent('.seat-slot.is-you .seat-slot__name').then((t) => t.replace('👑', '').trim());
  assert.equal(await youOf(a), 'Alice');
  assert.equal(await youOf(b), 'Bob');
  assert.equal(await youOf(plain), '路人');
  for (const p of [a, b, plain]) {
    await p.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 3);
  }
  log('three independent identities in one browser profile');

  // Reload keeps each tab's own identity (and its seat).
  await b.reload();
  await b.waitForSelector('.lobby__code');
  assert.equal(await youOf(b), 'Bob');
  await a.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 3);
  log('reload keeps the seat');
  ok = true;
  log('✔ ?as= tabs passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
