/**
 * Visual capture of the table effects: plays a real-time game (1 human + 3 AI) and screenshots each kind of effect
 * the first time it is on screen (card on the stage, target lock, dice, role reveal, calculation tape, turn banner …).
 * Also checks that a card stays visible and fully opaque on the stage from landing until it settles.
 *
 *   node e2e/fxshots.mjs [--budget 300]        → e2e/out/fx-*.png
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { ROOT, log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const OUT = resolve(ROOT, args.out ?? 'e2e/out');
mkdirSync(OUT, { recursive: true });
// Real server pacing (no fast-forward), so effects are captured the way players see them.
const server = await startServer(args.url, { realtime: args.fast !== 'true' });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(server.url);
await page.fill('.field input', '特效');
await page.click('.home__create');
await page.waitForSelector('.lobby__code');
for (let i = 0; i < 3; i++) await page.click('.seat-slot__add');
await page.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 4);
await page.click('.lobby__foot .btn--primary');
await page.waitForSelector('.rolepick');
await page.locator('.rolepick__item .card').first().click();
await page.waitForSelector('.table', { timeout: 15000 });

// What the stage card looks like frame by frame (a card must not vanish after landing).
await page.evaluate(() => {
  const S = (window.__stage = { frames: 0, gaps: [], seen: false, since: 0 });
  const tick = () => {
    const el = document.querySelector('.stage__card:not(.is-leaving)');
    const now = performance.now();
    if (el) {
      const o = Number(getComputedStyle(el).opacity);
      const inner = Number(getComputedStyle(el.querySelector('.stage__slam') ?? el).opacity);
      if (!S.seen) { S.seen = true; S.since = now; }
      if (now - S.since > 900 && (o < 0.3 || inner < 0.9)) S.gaps.push({ t: Math.round(now), o, inner });
    } else S.seen = false;
    S.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// The die that came to rest must show the face the server rolled: hit-test the middle of the cube (back faces are not hit).
let diceChecked = 0;
const diceProblems = [];
async function checkDie() {
  // Each throw is its own `.fx__dice`; judge only dice that are at rest and read their own cube against their own result text.
  const results = await page.evaluate(() => {
    document.querySelector('.fx').style.pointerEvents = 'auto'; // hit-testing needs it
    return [...document.querySelectorAll('.fx__dice')].map((d) => {
      const res = d.querySelector('.dieresult:not(.dieresult--wait) span')?.textContent?.match(/点数 (\d)/);
      const cube = d.querySelector('.cube');
      if (!res || !cube || !d.querySelector('.dice3d__bounce.is-rest')) return null;
      const b = cube.getBoundingClientRect();
      const hit = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2).find((e) => d.contains(e) && /cube__face--\d/.test(e.className));
      return { expected: res[1], shown: /cube__face--(\d)/.exec(hit?.className ?? '')?.[1] ?? 'none' };
    }).filter(Boolean);
  });
  for (const r of results) {
    diceChecked++;
    if (r.expected !== r.shown) diceProblems.push(r);
  }
}
const want = ['.stage__card', '.stage__via', '.fx__target .reticle', '.fx__skill', '.fx__reveal .revealpanel', '.fx__mod', '.fx__value.tier1', '.fx__value.tier2', '.fx__value.tier3',
  '.tape', '.fx__seatfx', '.fx__passive', '.fx__banner', '.fx__dice', '.fx__block', '.fx__turn', '.fx__round', '.fx__discard'];
const got = new Set();
const t0 = Date.now();
const budget = Number(args.budget ?? 300) * 1000;
const shotAfter = { '.fx__dice': [900, 2600, 4300], '.fx__reveal .revealpanel': [400, 2500] };
while (Date.now() - t0 < budget && got.size < want.length) {
  await page.evaluate(ACT, Math.random()).catch(() => {});
  await checkDie().catch(() => {});
  const skip = await page.locator('.ceremony__skip').count();
  if (skip) break;
  for (const sel of want) {
    if (got.has(sel) || !(await page.locator(sel).count())) continue;
    got.add(sel);
    const base = sel.replace(/[^a-z0-9]+/gi, '_');
    let waited = 0;
    for (const [i, ms] of (shotAfter[sel] ?? [450]).entries()) {
      await sleep(ms - waited);
      waited = ms;
      await page.screenshot({ path: `${OUT}/fx-${base}${i ? `-${i}` : ''}.png` });
    }
    log('captured', sel);
  }
  await sleep(60);
}
log('missing:', want.filter((s) => !got.has(s)).join(', ') || 'none');
const st = await page.evaluate(() => window.__stage);
log(`stage frames ${st.frames}; frames where a standing card was faded: ${st.gaps.length}; dice checked: ${diceChecked}, wrong faces: ${diceProblems.length}`);
if (diceProblems.length) console.log(JSON.stringify(diceProblems.slice(0, 5)));
if (st.gaps.length) console.log(JSON.stringify(st.gaps.slice(0, 5)));
if (errors.length) console.log('page errors:', errors.join('\n'));

// the finale: let the ceremony run on its own for a few beats
if (await page.locator('.ceremony__skip').count()) {
  for (const [i, ms] of [1200, 3500, 3500, 3500, 3500, 3500, 3500].entries()) {
    await sleep(ms);
    await page.screenshot({ path: `${OUT}/fx-ceremony-${i}.png` });
  }
}
await browser.close();
server.stop();
process.exit(errors.length || st.gaps.length || diceProblems.length ? 1 : 0);
