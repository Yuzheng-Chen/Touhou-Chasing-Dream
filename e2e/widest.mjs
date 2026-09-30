/** Debug helper: on a phone-sized table, list the elements that stick out past the viewport. */
import { chromium } from 'playwright';
import { ACT } from './driver.mjs';
import { parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const W = Number(args.width ?? 390);
const server = await startServer(args.url);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto(server.url);
await page.fill('.field input', '宽度');
await page.click('.home__create');
await page.waitForSelector('.lobby__code');
for (let i = 0; i < 3; i++) { await page.click('.seat-slot__add'); await sleep(100); }
await page.click('.lobby__foot .btn--primary');
await page.waitForSelector('.rolepick');
for (let i = 0; i < 40; i++) { await page.evaluate(ACT, 0.99).catch(() => {}); await sleep(120); }
const rows = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  return {
    vw, scrollW: document.documentElement.scrollWidth,
    out: [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r, el }) => r.width > 0 && r.right > vw + 2 && !el.closest('.opponents') && getComputedStyle(el).position !== 'fixed')
      .sort((a, b) => b.r.right - a.r.right)
      .slice(0, 12)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`),
  };
});
console.log(JSON.stringify(rows, null, 1));
// Which top-level section forces the width? Hide each in turn and re-measure.
const culprits = await page.evaluate(() => {
  const base = document.documentElement.scrollWidth;
  const res = [];
  for (const el of document.querySelectorAll('.topbar, .opponents, .center, .myarea, .center__strips, .cmeter, .center__row, .hand, .myarea__self, .myarea__events, .topbar__left, .topbar__right, .topbar__center')) {
    const prev = el.style.display;
    el.style.display = 'none';
    const w = document.documentElement.scrollWidth;
    el.style.display = prev;
    if (w < base) res.push(el.className.split(' ')[0] + ' -> ' + w);
  }
  return { base, res };
});
console.log(JSON.stringify(culprits));
await browser.close();
server.stop();
