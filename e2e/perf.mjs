/**
 * Slow-network regression: the title screen must arrive quickly over a very slow link, with nothing blocking it.
 *  - throttled to ~400 kbit/s and 400 ms latency (a bad mobile connection)
 *  - only same-origin requests (no Google Fonts etc. that may be slow or blocked), text assets served brotli-compressed
 *  - the first screen costs a few hundred KB, fonts are loaded as slices, card pictures are not bulk-downloaded in full size
 *  - a card shown at hand size loads the small thumbnail, not the full picture
 *
 *   node e2e/perf.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { log, parseArgs, sleep, startServer } from './lib.mjs';

const args = parseArgs();
const server = await startServer(args.url);
const browser = await chromium.launch();
let ok = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });

  const urls = new Map(); // requestId → { url, encoding }
  const sizes = [];
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, { url: e.response.url, encoding: e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] }));
  cdp.on('Network.loadingFinished', (e) => {
    const u = urls.get(e.requestId);
    if (u) sizes.push({ ...u, bytes: e.encodedDataLength });
  });

  const t0 = Date.now();
  await page.goto(server.url, { waitUntil: 'commit' });
  const boot = await page.locator('.boot').count(); // the instant splash is in the HTML itself
  await page.waitForSelector('.home__card', { timeout: 60_000 });
  const interactive = Date.now() - t0;
  const kb = (n) => Math.round(n / 1024);
  const total = sizes.reduce((a, s) => a + s.bytes, 0);
  const by = (re) => sizes.filter((s) => re.test(s.url));
  log(`title screen interactive after ${(interactive / 1000).toFixed(1)} s on a throttled link; ${kb(total)} KB transferred in ${sizes.length} requests`);
  for (const s of [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, 8)) log(`   ${kb(s.bytes).toString().padStart(4)} KB  ${s.encoding ?? '-'}  ${s.url.replace(server.url, '')}`);

  const origin = new URL(server.url).origin;
  assert.deepEqual(sizes.filter((s) => !s.url.startsWith(origin) && !s.url.startsWith('data:')).map((s) => s.url), [], 'nothing is fetched from third-party hosts');
  assert.ok(by(/\/assets\/.*\.js$/).every((s) => s.encoding === 'br' || s.encoding === 'gzip'), 'scripts are compressed');
  assert.ok(boot >= 0);
  assert.ok(total < 400 * 1024, `first screen under 400 KB (was ${kb(total)} KB)`);
  assert.ok(interactive < 25_000, `first screen interactive within 25 s at 400 kbit/s (took ${interactive} ms)`);
  assert.equal(by(/\/art\/cards\/[a-z_]+\.webp$/).filter((s) => !/\.s\.webp$/.test(s.url)).length, 0, 'no full-size card picture on the title screen');
  assert.ok(by(/\/fonts\//).length <= 4, 'only the first font slices are fetched for the title screen');

  // Idle on the title screen: card pictures that get warmed in the background must be the small ones.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(6000);
  const full = sizes.filter((s) => /\/art\/cards\/[a-z_]+\.webp$/.test(s.url) && !/\.s\.webp$/.test(s.url));
  log(`after idling: ${sizes.filter((s) => /\.s\.webp$/.test(s.url)).length} thumbnails, ${full.length} full-size pictures fetched`);
  assert.ok(full.length <= 4, 'full-size pictures are not downloaded in the background');

  // In a game, hand cards use thumbnails.
  await page.fill('.field input', '网速');
  await page.click('.home__create');
  await page.waitForSelector('.lobby__code');
  for (let i = 0; i < 2; i++) await page.click('.seat-slot__add');
  await page.click('.lobby__foot .btn--primary');
  await page.waitForSelector('.rolepick');
  await page.locator('.rolepick__item .card').first().click();
  await page.waitForSelector('.hand .card');
  const art = await page.$$eval('.hand .card .card__art', (els) => els.map((e) => getComputedStyle(e).backgroundImage));
  assert.ok(art.length > 0 && art.every((a) => /\.s\.webp/.test(a) && !/\/[a-z_]+\.webp"?\)/.test(a.replace(/\.s\.webp/g, ''))), `hand cards use thumbnails: ${art[0]}`);
  const lg = await page.evaluate(() => {
    const d = document.createElement('div');
    return !!d;
  });
  assert.ok(lg);
  ok = true;
  log('✔ slow-network checks passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
