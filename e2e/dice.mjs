/**
 * The 3-D die: for every face the server can roll, the cube must come to rest showing exactly that face (hit-test the middle
 * of the cube — back faces are never hit), stay visible for the whole result phase, and read out the right meaning.
 * Effects are injected through the store hook (`?e2e`), so no game luck is needed.
 *
 *   node e2e/dice.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });
const server = await startServer(args.url, { realtime: true });
const browser = await chromium.launch();
let ok = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}/?e2e=1`);
  await page.fill('.field input', '骰子');
  await page.click('.home__tutorial');
  await page.waitForSelector('.table', { timeout: 15_000 });
  await page.waitForFunction(() => window.__tcd);

  const who = await page.evaluate(() => window.__tcd.useStore.getState().game.players.find((p) => p.isBot).id);
  const meaning = { truth: (f) => (f % 2 ? '真' : '假'), two: (f) => String(Math.floor((f - 1) / 2)), delta: (f) => ['−3', '−2', '−1', '+1', '+2', '+3'][f - 1] };
  const faces = [1, 2, 3, 4, 5, 6];
  const kinds = ['truth', 'two', 'delta'];
  for (const [i, face] of faces.entries()) {
    const judge = kinds[i % 3];
    const result = judge === 'truth' ? face % 2 === 1 : judge === 'two' ? Math.floor((face - 1) / 2) : [-3, -2, -1, 1, 2, 3][face - 1];
    await page.evaluate(({ face, judge, result, who, i }) => {
      const s = window.__tcd.useStore;
      s.setState({ fxQueue: [{ seq: 90000 + i, at: Date.now(), text: '', fx: { type: 'dice', playerId: who, face, judge, result } }] });
    }, { face, judge, result, who, i });
    await page.waitForSelector('.dieresult:not(.dieresult--wait)', { timeout: 9000 });
    await sleep(400);
    const seen = await page.evaluate(() => {
      document.querySelector('.fx').style.pointerEvents = 'auto'; // the layer ignores the pointer; hit-testing needs it
      const cube = document.querySelector('.cube');
      const b = cube.getBoundingClientRect();
      const hit = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2).map((e) => /cube__face--(\d)/.exec(e.className)?.[1]).find(Boolean);
      return { hit, w: Math.round(b.width), text: document.querySelector('.dieresult b')?.textContent, line: document.querySelector('.dieresult span')?.textContent, lit: document.querySelector('.dicelegend__cell.is-hit small')?.textContent };
    });
    if (i < 3) await page.screenshot({ path: `${OUT}/dice-${face}.png` });
    assert.equal(seen.hit, String(face), `the die rests showing ${face}, not ${seen.hit}`);
    assert.equal(seen.text, meaning[judge](face), `result text for ${judge} ${face}`);
    assert.equal(seen.lit, String(face), 'the legend highlights the rolled face');
    assert.match(seen.line, new RegExp(`点数 ${face}`));
    log(`face ${face} (${judge}): rests correctly, reads "${seen.text}" — ${seen.line}`);
    await page.evaluate(() => window.__tcd.useStore.setState({ fxQueue: [] }));
    await page.waitForSelector('.fx__dice', { state: 'detached', timeout: 3000 });
  }
  assert.deepEqual(errors, [], errors.join('\n'));
  ok = true;
  log('✔ dice passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
