/**
 * Regression: your hand must not twitch while other players are taking their turns.
 * One human + 3 AI play at real server pace; every animation frame the position of each hand card is sampled.
 * While the set of cards in the hand is unchanged and nobody hovers, the positions must stay put.
 *
 *   node e2e/hand.mjs [--seconds 90]
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
const seconds = Number(args.seconds ?? 90);
const server = await startServer(args.url, { realtime: true });
const browser = await chromium.launch();
let ok = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.fill('.field input', '手牌');
  await page.click('.home__create');
  await page.waitForSelector('.lobby__code');
  for (let i = 0; i < 3; i++) await page.click('.seat-slot__add');
  await page.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 4);
  await page.click('.lobby__foot .btn--primary');
  await page.waitForSelector('.rolepick');
  await page.locator('.rolepick__item .card').first().click();
  await page.waitForSelector('.table', { timeout: 15000 });

  // The sampler runs inside the page, every frame.
  await page.evaluate(() => {
    const S = (window.__hand = { moves: [], frames: 0, last: null });
    const box = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
    const tick = () => {
      S.frames++;
      const cards = [...document.querySelectorAll('.hand__card')];
      const sig = cards.map((c) => c.querySelector('.card')?.getAttribute('data-card')).join(',');
      const rects = cards.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10]; });
      const mine = !!document.querySelector('.myarea.is-turn');
      const hovering = !!document.querySelector('.hand__card:hover');
      const menu = !!document.querySelector('.playmenu');
      if (document.querySelector('.table__main.is-shaking')) S.shakeAt = performance.now();
      const shaking = false; // the opponents/centre shake on a big community swing, but never the hand
      const now = performance.now();
      if (!S.last || S.last.sig !== sig) S.changedAt = now; // cards dealt / played / taken: they are allowed to animate for a while
      if (S.last && S.last.sig === sig && S.last.rects.length === rects.length && !hovering && !menu && now - S.changedAt > 1800) {
        rects.forEach((r, i) => {
          const d = Math.max(Math.abs(r[0] - S.last.rects[i][0]), Math.abs(r[1] - S.last.rects[i][1]));
          if (d > 0.6 && !mine && !shaking && !S.diag) {
            const box = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
            S.diag = { hist: S.hist.slice(), prev: S.prevBoxes, now: S.curBoxes,
              main: box('.table__main'), area: box('.myarea'), row: box('.myarea__row'), hand: box('.hand'), center: box('.center'), opp: box('.opponents'),
              scroll: [window.scrollX, window.scrollY, document.scrollingElement.scrollTop],
              anims: document.getAnimations().map((a) => `${a.animationName ?? a.transitionProperty}@${(a.effect?.target?.className || a.effect?.target?.tagName || '').toString().slice(0, 40)}`).slice(0, 25),
            };
          }
          if (d > 0.6 && !mine && !shaking && S.samples?.length !== 6) {
            (S.samples ||= []).push({ i, d, style: cards.map((c) => c.getAttribute('style')), cardT: cards.map((c) => getComputedStyle(c.querySelector('.card')).transform), a: document.getAnimations().filter((a) => a.effect?.target?.classList?.contains('hand__card')).map((a) => `${a.playState}:${JSON.stringify(a.effect.getKeyframes().map((k) => k.transform ?? k.opacity)).slice(0, 120)}`) });
          }
          if (d > 0.6) S.moves.push({ t: Math.round(performance.now()), i, d: Math.round(d * 10) / 10, mine, shaking, cards: sig, prompt: document.querySelector('.decide')?.getAttribute('data-kind') ?? null, fx: document.querySelector('.fx')?.children.length });
        });
      }
      const boxes = { main: box('.table__main'), center: box('.center'), strips: box('.center__strips'), area: box('.myarea'), hand: box('.hand'), opp: box('.opponents'), grid: box('.table__grid'), tbl: box('.table') };
      S.prevBoxes = S.curBoxes; S.curBoxes = boxes;
      const frame = { t: Math.round(now), styles: cards.map((c) => c.getAttribute('style')), rects, wrap: box('.hand') };
      (S.hist ||= []).push(frame); if (S.hist.length > 4) S.hist.shift();
      S.last = { sig, rects };
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await page.evaluate(ACT, Math.random()).catch(() => {});
    await sleep(120);
    if (await page.locator('.results').count()) break;
  }
  const { moves, frames, diag, samples } = await page.evaluate(() => window.__hand);

  if (diag) console.log('DIAG', JSON.stringify(diag));
  log(`frames sampled: ${frames}, hand movements while the card set was unchanged: ${moves.length}`);
  const odd = moves.filter((m) => !m.mine);
  log(`unexplained: ${odd.length}, shake frames: ${moves.filter((m) => m.shaking).length}`);
  if (odd.length) console.log(JSON.stringify(odd.slice(0, 12)));
  await page.screenshot({ path: `${OUT}/hand-end.png` });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(moves.filter((m) => !m.mine).length, 0, 'the hand moved while it was not my turn');
  ok = true;
  log('✔ hand stays still during other players\' turns');
} catch (e) {
  console.error('✘ FAILED:', e.message);
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
