/**
 * Visual capture of the table effects: plays the tutorial and screenshots each kind of effect the first
 * time it is on screen (card slam, skill banner, modifier, number slam, seat number…).
 *
 *   node e2e/fxshots.mjs        → e2e/out/fx-*.png
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
await page.goto(server.url);
await page.fill('.field input', '特效');
await page.click('.home__tutorial');
await page.waitForSelector('.table');

const want = ['.fx__play', '.fx__via', '.fx__skill', '.fx__mod', '.fx__value.tier1', '.fx__value.tier2', '.fx__value.tier3', '.fx__seatfx', '.fx__passive', '.fx__banner', '.fx__dice'];
const got = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 400_000 && got.size < want.length) {
  await page.evaluate(ACT, Math.random()).catch(() => {});
  const tip = await page.locator('.coach__tip .btn--gold:has-text("知道了")').count();
  if (tip) await page.click('.coach__tip .btn--gold:has-text("知道了")', { timeout: 800 }).catch(() => {});
  for (const sel of want) {
    if (got.has(sel) || !(await page.locator(sel).count())) continue;
    await sleep(380); // let the entrance animation land
    if (!(await page.locator(sel).count())) continue;
    got.add(sel);
    await page.screenshot({ path: `${OUT}/fx-${sel.replace(/[^a-z0-9]+/gi, '_')}.png` });
    log('captured', sel);
  }
  await sleep(60);
}
log('missing:', want.filter((s) => !got.has(s)).join(', ') || 'none');
await browser.close();
server.stop();
