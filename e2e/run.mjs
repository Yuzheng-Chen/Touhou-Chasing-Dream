/**
 * Multiplayer end-to-end test.
 *
 *   npm run e2e -- --players 4 --games 2          # build + run (from repo root)
 *   node e2e/run.mjs --players all                # 3..8 players, one game each
 *
 * Every player is an independent browser context (own storage ⇒ own identity, hand and role) driven
 * only through the UI. Checks: lobby, role choice, full games to final scoring, rematch, spectator,
 * hidden-information invariants on every socket frame, reconnection (reload, network loss, long
 * absence → 托管), and zero console errors.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const PLAYERS = args.players ?? '4';
const GAMES = Number(args.games ?? 2);
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
const HEADED = args.headed === 'true';
const GAME_TIMEOUT = Number(args.timeout ?? 420) * 1000;
mkdirSync(OUT, { recursive: true });
// ── hidden-information invariants, checked on every game:state frame ──────────────
const PRIVATE_KEYS = new Set(['hand', 'roleOptions', 'turnEvent', 'faceDownEvent', 'oshi', 'pendingGift']);

function* keysOutsideMe(obj, path = '') {
  if (Array.isArray(obj)) {
    for (const v of obj) yield* keysOutsideMe(v, path);
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      yield path + k;
      yield* keysOutsideMe(v, `${path}${k}.`);
    }
  }
}

function checkFrame(seat, state, problems) {
  const pid = seat.playerId;
  const bad = (m) => problems.push(`[seat ${seat.idx} ${seat.name}] ${m}`);
  const { me, ...rest } = state;
  if (me && me.id !== pid) bad(`view belongs to ${me.id}, not ${pid}`);
  if (!seat.spectator && !me && state.phase !== 'finished') bad('member got no private view');
  if (seat.spectator && me) bad('spectator received a private view');
  for (const k of keysOutsideMe(rest)) {
    const leaf = k.split('.').pop();
    if (PRIVATE_KEYS.has(leaf)) bad(`private field "${k}" present outside "me"`);
  }
  for (const p of state.players) {
    if (p.id === pid) continue;
    if (!p.roleRevealed && state.phase !== 'finished' && p.role !== null) bad(`role of hidden player ${p.name} leaked (${p.role})`);
  }
  if (me) {
    const mine = state.players.find((p) => p.id === pid);
    if (mine && mine.handCount !== me.hand.length) bad(`handCount ${mine.handCount} ≠ hand ${me.hand.length}`);
  }
  if (state.prompt && seat.spectator) bad('spectator received a prompt');
  if (state.phase === 'finished') {
    if (state.players.some((p) => !p.role)) bad('roles not revealed at game end');
    if (!state.result) bad('finished without a result');
  }
}

// ── seats ────────────────────────────────────────────────────────────────────────
class Seat {
  constructor(test, idx, name) {
    Object.assign(this, { test, idx, name, page: null, ctx: null, state: null, playerId: null, stop: { done: true }, spectator: false, frames: 0 });
    this.stats = {};
  }

  async open() {
    this.page = await this.ctx.newPage();
    const { page } = this;
    page.on('pageerror', (e) => this.test.problems.push(`[seat ${this.idx}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) this.test.problems.push(`[seat ${this.idx}] console.error: ${m.text()}`);
    });
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string' || !payload.startsWith('42')) return;
        let msg;
        try { msg = JSON.parse(payload.slice(2)); } catch { return; }
        if (msg[0] === 'game:state' && msg[1]) {
          if (msg[1].me) this.playerId = msg[1].me.id;
          this.state = msg[1];
          this.frames++;
          checkFrame(this, msg[1], this.test.problems);
        }
      });
    });
  }

  startDriver() {
    this.stopDriver();
    const stop = (this.stop = { done: false });
    (async () => {
      while (!stop.done) {
        let did = null;
        try {
          did = await this.page.evaluate(ACT, Math.random());
        } catch {
          if (this.page.isClosed()) return;
        }
        if (did === 'stuck') {
          this.test.problems.push(`[seat ${this.idx}] UI got stuck on a prompt`);
          await this.page.screenshot({ path: `${OUT}/stuck-seat${this.idx}.png` }).catch(() => {});
          await sleep(1500);
        }
        if (did) this.stats[did] = (this.stats[did] ?? 0) + 1;
        await sleep(did ? 25 : 90);
      }
    })();
  }
  stopDriver() {
    this.stop.done = true;
  }
}

class Test {
  constructor(url, browser, n) {
    Object.assign(this, { url, browser, n, seats: [], problems: [], code: null, spectator: null });
  }

  async setup() {
    for (let i = 0; i < this.n; i++) {
      const seat = new Seat(this, i, `玩家${i + 1}`);
      seat.ctx = await this.browser.newContext({ viewport: { width: 1440, height: 820 } });
      await seat.open();
      this.seats.push(seat);
    }
  }

  async lobby() {
    const [host, ...guests] = this.seats;
    await host.page.goto(this.url);
    await host.page.fill('.field input', host.name);
    await host.page.click('.home__create');
    await host.page.waitForSelector('.lobby__code');
    this.code = (await host.page.textContent('.lobby__code')).trim().slice(0, 4);
    assert.match(this.code, /^[A-Z0-9]{4}$/, 'room code');
    log(`room ${this.code}`);
    for (const g of guests) {
      await g.page.goto(this.url);
      await g.page.fill('.field input', g.name);
      await g.page.fill('.home__code', this.code);
      await g.page.click('.home__join .btn--gold');
      await g.page.waitForSelector('.lobby__code');
    }
    await this.expectLobby();
    await host.page.screenshot({ path: `${OUT}/${this.n}p-lobby.png` });
  }

  async expectLobby() {
    for (const s of this.seats) {
      await s.page.waitForFunction((n) => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === n, this.n, { timeout: 10000 });
    }
    // Only the host may start.
    assert.equal(await this.seats[0].page.locator('.lobby__foot .btn--primary').count(), 1);
    for (const g of this.seats.slice(1)) assert.equal(await g.page.locator('.lobby__foot .btn--primary').count(), 0, 'guest must not see the start button');
  }

  async startGame(label) {
    await this.seats[0].page.click('.lobby__foot .btn--primary');
    for (const s of this.seats) await s.page.waitForSelector('.rolepick', { timeout: 15000 });
    await this.seats[0].page.screenshot({ path: `${OUT}/${this.n}p-${label}-rolepick.png` });
    this.seats.forEach((s) => s.startDriver());
  }

  async until(cond, what, timeout = GAME_TIMEOUT) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await cond()) return;
      if (this.problems.some((p) => p.includes('stuck'))) throw new Error(`aborting: ${this.problems.find((p) => p.includes('stuck'))}`);
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  get round() {
    return Math.max(0, ...this.seats.map((s) => s.state?.round ?? 0));
  }
  get phase() {
    return this.seats[0].state?.phase;
  }

  // ── scenarios ──────────────────────────────────────────────────────────────────
  /** Reload the page: identity lives in localStorage, so this must land back at the same seat. */
  async reloadSeat(seat) {
    const before = seat.playerId;
    const handBefore = seat.state?.me?.hand.length;
    log(`reload seat ${seat.idx}`);
    seat.stopDriver();
    await seat.page.reload();
    await seat.page.waitForSelector('.table', { timeout: 15000 });
    await this.until(() => seat.state?.me && seat.state.me.id === before, 'same identity after reload', 15000);
    await seat.page.waitForFunction(() => document.querySelectorAll('.hand__card').length >= 0);
    log(`  seat ${seat.idx} back: id ${before === seat.playerId ? 'same' : 'DIFFERENT'}, hand ${handBefore} → ${seat.state.me.hand.length}`);
    assert.equal(seat.playerId, before, 'identity must survive reload');
    seat.startDriver();
  }

  /** Drop the network without closing the tab; socket.io must reconnect by itself. */
  async networkBlip(seat, ms = 1500) {
    log(`network blip seat ${seat.idx} (${ms}ms)`);
    seat.stopDriver();
    await seat.ctx.setOffline(true);
    // The UI must notice the loss and say so …
    await seat.page.waitForSelector('.conn-banner', { timeout: 15000 });
    await sleep(ms);
    const frames = seat.frames;
    await seat.ctx.setOffline(false);
    // … then reconnect by itself, clear the banner and receive fresh state.
    await seat.page.waitForSelector('.conn-banner', { state: 'detached', timeout: 20000 });
    await this.until(() => seat.frames > frames, 'state after network recovery', 20000);
    await seat.page.waitForSelector('.table');
    seat.startDriver();
  }

  /** Close the tab for longer than the offline timeout → a bot covers → returning hands the seat back. */
  async absence(seat, ms = 4500) {
    log(`close seat ${seat.idx} for ${ms}ms (expect 托管)`);
    const id = seat.playerId;
    const watcher = this.seats.find((s) => s !== seat);
    seat.stopDriver();
    await seat.page.close();
    await this.until(() => watcher.state?.players.find((p) => p.id === id)?.auto === true, 'bot takeover of the absent seat', ms + 8000);
    log('  托管 active; other players see it');
    await sleep(800); // the bot plays a little
    await seat.open();
    await seat.page.goto(this.url);
    await seat.page.waitForSelector('.table', { timeout: 15000 });
    await this.until(() => seat.state?.me?.id === id, 'same identity after returning', 15000);
    await this.until(() => watcher.state?.players.find((p) => p.id === id)?.auto === false, '托管 cleared on return', 8000);
    log('  back in control');
    seat.startDriver();
  }

  async joinSpectator() {
    const ctx = await this.browser.newContext({ viewport: { width: 1440, height: 820 } });
    const seat = new Seat(this, 99, '观众');
    seat.ctx = ctx;
    seat.spectator = true;
    await seat.open();
    await seat.page.goto(this.url);
    await seat.page.fill('.field input', seat.name);
    await seat.page.fill('.home__code', this.code);
    await seat.page.click('.home__join .btn--gold');
    await seat.page.waitForSelector('.myarea--spectator', { timeout: 15000 });
    assert.equal(await seat.page.locator('.hand__card').count(), 0, 'spectator sees no hand');
    assert.equal(await seat.page.locator('.seat').count(), this.n, 'spectator sees every seat as opponent');
    await this.until(() => seat.state, 'spectator state');
    this.spectator = seat;
    await seat.page.screenshot({ path: `${OUT}/${this.n}p-spectator.png` });
    log('spectator attached');
  }

  // ── one complete game ──────────────────────────────────────────────────────────
  async playToEnd(label, scenarios) {
    const t0 = Date.now();
    let done = 0;
    const steps = [];
    if (scenarios) {
      const a = this.seats[1];
      const b = this.seats[Math.min(2, this.n - 1)];
      const c = this.seats[Math.min(3, this.n - 1)];
      // Absence first and early: the bot only covers a few seconds, and short games (8 players = 4 rounds) end quickly.
      steps.push([1, () => this.absence(c)], [2, () => this.reloadSeat(a)], [2, () => this.networkBlip(b)]);
      if (!this.spectator) steps.unshift([1, () => this.joinSpectator()]);
    }
    let shot = false;
    await this.until(async () => {
      if (!shot && this.round >= 2 && this.phase === 'action') {
        shot = true;
        await this.seats[0].page.screenshot({ path: `${OUT}/${this.n}p-${label}-table.png` });
      }
      while (done < steps.length && this.round >= steps[done][0] && this.phase && this.phase !== 'finished') {
        const [, fn] = steps[done++];
        await fn();
      }
      return (await Promise.all(this.seats.map((s) => s.page.locator('.results__sheet').count()))).every((c) => c > 0);
    }, `${label} to finish`);
    assert.equal(done, steps.length, 'all reconnect scenarios ran before the game ended');
    this.seats.forEach((s) => s.stopDriver());
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    log(`${label} finished after ${secs}s, ${this.round} rounds`);
    await this.verifyResults(label);
  }

  async verifyResults(label) {
    await sleep(600);
    const read = (page) =>
      page.evaluate(() =>
        [...document.querySelectorAll('.rline')].map((r) => ({
          name: r.querySelector('.rline__who b')?.textContent,
          win: r.classList.contains('is-winner'),
          score: r.querySelector('.rline__score b')?.textContent,
          vp: r.querySelector('.rline__vp b')?.textContent,
          reason: r.querySelector('.rline__reason')?.textContent,
        })));
    const tables = await Promise.all(this.seats.map((s) => read(s.page)));
    for (const t of tables) assert.equal(t.length, this.n, 'one result row per player');
    for (const t of tables) assert.deepEqual(t, tables[0], 'all players see the same results');
    const res = this.seats[0].state.result;
    assert.ok(res, 'result in state');
    assert.equal(res.lines.length, this.n);
    const winners = tables[0].filter((r) => r.win).map((r) => r.name);
    assert.equal(winners.length, res.winnerIds.length, 'winner rows match result');
    assert.ok(tables[0].every((r) => Number(r.vp) >= 0 && Number(r.vp) <= 2));
    if (res.winnerIds.length) assert.ok(tables[0].filter((r) => r.vp === '2').length >= 1, 'a winner takes 2 victory points');
    if (this.spectator) {
      // The spectator has no driver: it sits through the settlement show (and may skip it like anybody else).
      await this.spectator.page.waitForSelector('.ceremony', { timeout: 10_000 });
      await this.spectator.page.click('.ceremony__skip', { timeout: 5000 }).catch(() => {});
      await this.spectator.page.waitForSelector('.results__sheet', { timeout: 10_000 });
      assert.equal(await this.spectator.page.locator('.results__sheet').count(), 1, 'spectator sees results too');
    }
    // Everyone's role is public now.
    for (const s of this.seats) assert.ok(s.state.players.every((p) => p.role), 'all roles revealed at the end');
    await this.seats[0].page.screenshot({ path: `${OUT}/${this.n}p-${label}-results.png` });
    log(`${label} results: ${tables[0].map((r) => `${r.name}${r.win ? '★' : ''}=${r.score}/${r.vp}`).join('  ')}`);
  }

  async rematch() {
    const before = this.seats[0].state.id;
    await this.seats[0].page.click('.results__actions .btn--primary');
    for (const s of this.seats) await s.page.waitForSelector('.lobby__code', { timeout: 10000 });
    await this.expectLobby();
    // A fresh lobby must not carry anything over.
    for (const s of this.seats) assert.equal(await s.page.locator('.results__sheet').count(), 0);
    log('rematch: back in the lobby');
    return before;
  }

  async close() {
    await Promise.all([...this.seats, this.spectator].filter(Boolean).map((s) => s.ctx.close().catch(() => {})));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────
async function runOne(url, browser, n) {
  log(`━━ ${n} players ━━`);
  const t = new Test(url, browser, n);
  await t.setup();
  try {
    await t.lobby();
    let prevId = null;
    for (let g = 1; g <= GAMES; g++) {
      await t.startGame(`game${g}`);
      await t.playToEnd(`game${g}`, g === 1);
      const id = t.seats[0].state.id;
      if (prevId) assert.notEqual(id, prevId, 'rematch is a new game');
      prevId = id;
      if (g < GAMES) {
        await t.rematch();
        for (const s of t.seats) s.state = null;
      }
    }
    const stats = {};
    for (const s of t.seats) for (const [k, v] of Object.entries(s.stats)) stats[k] = (stats[k] ?? 0) + v;
    log('UI actions:', JSON.stringify(stats));
    const frames = t.seats.reduce((a, s) => a + s.frames, 0);
    log(`frames inspected for privacy: ${frames}`);
    assert.deepEqual(t.problems, [], `problems:\n${t.problems.slice(0, 15).join('\n')}`);
    log(`✔ ${n} players passed`);
    return { n, ok: true, stats };
  } catch (e) {
    await Promise.all(t.seats.map((s, i) => s.page?.screenshot({ path: `${OUT}/FAIL-${n}p-seat${i}.png` }).catch(() => {})));
    console.error(`✘ ${n} players FAILED:`, e.message);
    if (t.problems.length) console.error('problems so far:\n' + t.problems.slice(0, 15).join('\n'));
    return { n, ok: false };
  } finally {
    await t.close();
  }
}

const server = await startServer(args.url);
log(`server at ${server.url}`);
const browser = await chromium.launch({ headless: !HEADED });
const sizes = PLAYERS === 'all' ? [3, 4, 5, 6, 7, 8] : PLAYERS.split(',').map(Number);
const results = [];
for (const n of sizes) results.push(await runOne(server.url, browser, n));
await browser.close();
const serverErrors = server.errors?.() ?? '';
server.stop();
if (serverErrors.trim()) console.error('server stderr:\n' + serverErrors);
console.log('\nsummary:', results.map((r) => `${r.n}p ${r.ok ? '✔' : '✘'}`).join('  '));
process.exit(results.every((r) => r.ok) && !serverErrors.trim() ? 0 : 1);
