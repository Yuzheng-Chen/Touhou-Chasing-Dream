/**
 * UX regression test with a REAL mouse (Playwright mouse events, not DOM .click()):
 *  - no animation that forces main-thread paints (only transform/opacity are animated), no backdrop blur   (jank)
 *  - hover preview is placed beside the pointer from its very first frame                                    (flash at the bottom)
 *  - preview disappears when the gallery closes under the pointer                                            (lingering preview)
 *  - keyword side boxes appear for cards that need them, not for plain ones
 *  - the four card kinds are visually distinct (silhouette / aspect ratio / tag)
 *  - room settings (custom rounds etc.), latency indicator, emotes, tutorial coach
 *
 *   node e2e/ux.mjs
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
const server = await startServer(args.url);
const browser = await chromium.launch({ headless: args.headed !== 'true' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
const page = await ctx.newPage();
const problems = [];page.on('dialog', (d) => d.accept());

page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));

/** Animations that are not compositor-friendly, and any backdrop blur currently on screen. */
async function jankAudit(where) {
  const r = await page.evaluate(() => {
    const SAFE = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'offset', 'composite', 'easing', 'offset-distance']);
    const bad = new Set();
    for (const a of document.getAnimations()) {
      const target = a.effect?.target;
      if (target && !target.isConnected) continue;
      for (const kf of a.effect?.getKeyframes?.() ?? []) {
        for (const k of Object.keys(kf)) if (!SAFE.has(k) && k !== 'computedOffset') bad.add(`${target?.className?.baseVal ?? target?.className ?? target?.tagName}: ${k}`);
      }
    }
    const blurred = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
    }).map((el) => String(el.className).split(' ')[0]);
    return { bad: [...bad], blurred };
  });
  // Framer-motion drives some transitions through inline styles on transform/opacity; those show up as safe.
  const bad = r.bad.filter((b) => !/^(\S+: )?(transform|opacity)$/.test(b));
  assert.deepEqual(bad, [], `${where}: animations touching layout/paint properties: ${bad.join('; ')}`);
  assert.deepEqual(r.blurred, [], `${where}: backdrop-filter in use on: ${r.blurred.join(', ')}`);
}

/** Track the preview's rect for ~12 frames right after the mouse lands on a card. */
async function hoverAndTrace(x, y) {
  await page.mouse.move(6, 410); // park the pointer on neutral ground first
  await sleep(120);
  await page.evaluate(() => {
    window.__trace = [];
    const el = document.querySelector('.card-preview');
    const tick = () => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      window.__trace.push({ top: r.top, left: r.left, w: r.width, h: r.height, vis: cs.visibility });
      if (window.__trace.length < 14) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(x, y, { steps: 1 }); // arrives in one pointer event, like a quick flick
  await sleep(450);
  return page.evaluate(() => window.__trace);
}

let ok = false;
try {
  // ── Home ─────────────────────────────────────────────────────────────────────
  await page.goto(server.url);
  await page.waitForSelector('.home__card');
  await sleep(800);
  await jankAudit('home');
  await page.screenshot({ path: `${OUT}/ux-home.png` });
  log('home: no layout-animating keyframes, no backdrop blur');

  // ── Gallery: kinds are distinguishable ───────────────────────────────────────
  await page.click('text=卡牌图鉴');
  await page.waitForSelector('.gallery .card');
  const kinds = {};
  for (const tab of ['行动', '事件', '官作', '角色']) {
    await page.click(`.tabs .tab:has-text("${tab}")`);
    await sleep(250);
    kinds[tab] = await page.evaluate(() => {
      const c = document.querySelector('.gallery .card');
      const r = c.getBoundingClientRect();
      const tag = c.querySelector('.card__kind, .card__ribbon b')?.textContent;
      return { kind: c.dataset.kind, ratio: +(r.width / r.height).toFixed(2), tag, radius: getComputedStyle(c).borderTopLeftRadius };
    });
    await page.screenshot({ path: `${OUT}/ux-gallery-${tab}.png` });
  }
  log('kinds', JSON.stringify(kinds));
  assert.equal(kinds['行动'].tag, '行动');
  assert.equal(kinds['事件'].tag, '事件');
  assert.equal(kinds['官作'].tag, '官作');
  assert.equal(kinds['角色'].tag, '角色');
  assert.ok(kinds['官作'].ratio > 1, 'official cards are landscape');
  assert.ok(kinds['事件'].ratio < 0.8 && kinds['行动'].ratio < 0.8, 'action/event are portrait');
  assert.notEqual(kinds['事件'].radius, kinds['行动'].radius, 'event cards have an arched silhouette, unlike action cards');

  // ── Hover preview: placement from the first frame, keyword boxes ────────────
  await page.click('.tabs .tab:has-text("行动")');
  await sleep(250);
  const versus = page.locator('.gallery .card[data-card="versus"]');
  const box = await versus.boundingBox();
  const px = box.x + box.width / 2;
  const py = box.y + box.height / 2;
  const trace = await hoverAndTrace(px, py);
  const visible = trace.filter((t) => t.vis === 'visible');
  assert.ok(visible.length, 'preview became visible');
  for (const t of visible) {
    assert.ok(Math.abs(t.top + t.h / 2 - py) < t.h / 2 + 10 || t.top >= 12, `preview vertical placement off at first frames: ${JSON.stringify(t)}`);
    assert.ok(t.top >= 11 && t.top + t.h <= 820 + 1, `preview within viewport: ${JSON.stringify(t)}`);
    assert.ok(t.left + t.w <= px - 20 || t.left >= px + 20, `preview must not cover the pointer: ${JSON.stringify(t)}`);
  }
  assert.ok(Math.abs(visible[0].top - visible.at(-1).top) < 2, 'preview does not jump after its first visible frame');
  const gloss = await page.$$eval('.card-preview .gloss__term', (els) => els.map((e) => e.textContent));
  log('联机对战 gloss boxes:', gloss.join(' | '));
  assert.ok(gloss.includes('增减判定'), '联机对战 explains 增减判定');
  await page.screenshot({ path: `${OUT}/ux-hover-versus.png` });

  // a plain card has no boxes
  const create = await page.locator('.gallery .card[data-card="create"]').boundingBox();
  await page.mouse.move(create.x + create.width / 2, create.y + create.height / 2, { steps: 4 });
  await sleep(300);
  assert.equal(await page.locator('.card-preview .gloss__box').count(), 0, '创作 needs no keyword boxes');

  // an official that refers to another official/card
  await page.click('.tabs .tab:has-text("官作")');
  await sleep(250);
  const swr = await page.locator('.gallery .card[data-card="swr"]').boundingBox();
  await page.mouse.move(swr.x + swr.width / 2, swr.y + swr.height / 2, { steps: 4 });
  await sleep(300);
  const swrGloss = await page.$$eval('.card-preview .gloss__term', (els) => els.map((e) => e.textContent));
  log('东方绯想天 gloss boxes:', swrGloss.join(' | '));
  assert.ok(swrGloss.includes('东方非想天则') && swrGloss.includes('联机对战') && swrGloss.includes('拼点'), '绯想天 explains 非想天则, 联机对战 and 拼点');
  await page.screenshot({ path: `${OUT}/ux-hover-swr.png` });

  // right half of the screen: preview flips to the pointer's left, stays on screen
  const rightCard = await page.locator('.gallery .card[data-card="in"]').boundingBox().catch(() => null);
  await page.mouse.move(1380, 400, { steps: 3 });
  await page.mouse.move(rightCard ? rightCard.x + rightCard.width / 2 : 1100, rightCard ? rightCard.y + 40 : 300, { steps: 4 });
  await sleep(300);
  const r2 = await page.evaluate(() => { const r = document.querySelector('.card-preview').getBoundingClientRect(); return { l: r.left, r: r.right }; });
  assert.ok(r2.l >= 0 && r2.r <= 1440, 'preview stays inside the viewport near the right edge');

  // ── No flicker when the pointer rests on a card's bottom edge (the card used to lift away from under it) ──
  await page.click('.tabs .tab:has-text("行动")');
  await sleep(250);
  const edge = await page.locator('.gallery .card[data-card="rumor"]').boundingBox();
  await page.mouse.move(6, 410);
  await page.evaluate(() => {
    window.__samples = [];
    const tick = () => {
      const el = document.querySelector('.card-preview');
      window.__samples.push(el && el.querySelector('.card') ? 1 : 0);
      if (window.__samples.length < 70) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height - 1.5, { steps: 1 });
  await sleep(1300);
  const samples = await page.evaluate(() => window.__samples);
  const flips = samples.slice(1).filter((v, i) => v !== samples[i]).length;
  assert.ok(flips <= 1, `preview flickered ${flips} times while the pointer rested on a card edge: ${samples.join('')}`);
  log('no hover flicker at the card edge');

  // ── The wheel scrolls long card text inside the preview, without scrolling the gallery behind it ──
  await page.click('.tabs .tab:has-text("角色")');
  await sleep(250);
  let before = null;
  for (const id of ['original_player', 'oshi', 'local_king', 'doomsayer', 'cosplayer', 'anti_profit']) {
    const b = await page.locator(`.gallery .card[data-card="${id}"]`).boundingBox();
    if (!b) continue;
    await page.mouse.move(6, 410);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await sleep(350);
    before = await page.evaluate(() => {
      const t = document.querySelector('.card-preview .card__text');
      return t ? { text: t.scrollTop, sheet: document.querySelector('.sheet__body').scrollTop, over: t.scrollHeight > t.clientHeight + 2 } : null;
    });
    if (before?.over) break;
  }
  assert.ok(before?.over, 'some role card text overflows its box in the preview (precondition)');  assert.ok(await page.locator('.card-preview__hint').count(), 'overflowing text shows a scroll hint');
  await page.mouse.wheel(0, 160);
  await sleep(250);
  const after = await page.evaluate(() => ({ text: document.querySelector('.card-preview .card__text').scrollTop, sheet: document.querySelector('.sheet__body').scrollTop }));
  assert.ok(after.text > before.text, `wheel scrolled the preview text (${before.text} → ${after.text})`);
  assert.equal(after.sheet, before.sheet, 'the gallery behind did not scroll');
  log('wheel scrolls long preview text');
  // ── Closing the gallery while the pointer is over a card must clear the preview ──
  await page.keyboard.press('Escape');
  await sleep(500);
  const lingering = await page.evaluate(() => {
    const el = document.querySelector('.card-preview');
    return { vis: getComputedStyle(el).visibility, cards: el.querySelectorAll('.card').length };
  });
  assert.equal(lingering.cards, 0, 'preview content removed after closing the gallery');
  assert.equal(lingering.vis, 'hidden', 'preview hidden after closing the gallery');
  log('hover preview: stable placement, glossary boxes, clears on close');

  // ── Guide ────────────────────────────────────────────────────────────────────
  await page.click('text=新手指南');
  await page.waitForSelector('.guide');
  for (const tab of ['目标', '一轮怎么玩', '四种牌', '数值与骰子', '技巧']) {
    await page.click(`.guide__tabs .tab:has-text("${tab}")`);
    await sleep(350);
    await page.screenshot({ path: `${OUT}/ux-guide-${tab}.png` });
  }
  await page.keyboard.press('Escape');

  // ── Lobby: settings ──────────────────────────────────────────────────────────
  await page.fill('.field input', '测试员');
  await page.click('.home__create');
  await page.waitForSelector('.lobby__code');
  for (let i = 0; i < 3; i++) { await page.click('.seat-slot__add'); await sleep(120); }
  await page.waitForSelector('.opts');
  const subtitle = () => page.textContent('.opt--wide .opt__sub');
  await page.waitForFunction(() => document.querySelectorAll('.seat-slot:not(.seat-slot--empty)').length === 4);
  assert.match(await subtitle(), /共 8 轮/, 'rulebook default is 12 − players = 8 rounds');
  await jankAudit('lobby');

  // custom length
  await page.click('.seg button:has-text("自定义")');
  await page.waitForSelector('.opt--wide .stp');
  await page.click('.opt--wide .stp button[aria-label="减少"]');
  await page.click('.opt--wide .stp button[aria-label="减少"]');
  await page.waitForFunction(() => /共 6 轮/.test(document.querySelector('.opt--wide .opt__sub')?.textContent ?? ''));
  await page.click('.chips button:has-text("30秒")');
  await page.click('.seg button:has-text("房主")');
  await page.waitForSelector('.chips button.is-on:has-text("30秒")');
  await page.screenshot({ path: `${OUT}/ux-lobby-settings.png` });
  await page.click('.seg button:has-text("标准")');
  await page.waitForFunction(() => /共 8 轮/.test(document.querySelector('.opt--wide .opt__sub')?.textContent ?? ''));
  log('lobby settings: standard 8 rounds ⇄ custom 6, time limit, first player');

  // latency indicator is measured and shown
  await page.waitForSelector('.lobby__head-actions .signal[data-ping]', { timeout: 8000 });
  const lobbyPing = Number(await page.getAttribute('.lobby__head-actions .signal', 'data-ping'));
  assert.ok(lobbyPing >= 0 && lobbyPing < 1000, `ping looks sane: ${lobbyPing}`);
  log(`latency indicator: ${lobbyPing} ms`);

  // ── Role selection: keyword boxes on hover; then the in-game abort vote returns to the room ──
  await page.click('.lobby__foot .btn--primary');
  await page.waitForSelector('.rolepick');
  await sleep(700);
  const firstRole = await page.locator('.rolepick__item .card').first().boundingBox();
  await page.mouse.move(firstRole.x + firstRole.width / 2, firstRole.y + firstRole.height / 2, { steps: 3 });
  await page.waitForSelector('.rolepick__gloss .gloss__box', { timeout: 3000 });
  const roleGloss = await page.$$eval('.rolepick__gloss .gloss__term', (els) => els.map((e) => e.textContent));
  assert.ok(roleGloss.some((t) => /·/.test(t)), `role cards explain their faction: ${roleGloss}`);
  await page.screenshot({ path: `${OUT}/ux-rolepick-gloss.png` });
  log('role selection hover shows keyword boxes:', roleGloss.join(' | '));
  await page.locator('.rolepick__item .card').first().click();
  await page.waitForSelector('.table', { timeout: 10000 });
  await page.click('.topbar__abort');
  await page.waitForSelector('.lobby__code', { timeout: 8000 }); // sole human + AI: the vote passes at once
  log('中止本局 returned to the room');
  await page.waitForSelector('.lobby__head-actions .btn:has-text("离开")');
  // ── Tutorial with coach ──────────────────────────────────────────────────────
  await page.click('.lobby__head-actions .btn:has-text("离开")');
  await page.waitForSelector('.home__tutorial');
  await page.click('.home__tutorial');
  await page.waitForSelector('.table', { timeout: 15000 });
  await page.evaluate(() => {
    window.__fxSeen = new Set();
    const root = document.querySelector('.fx');
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) [n, ...n.querySelectorAll('*')].forEach((e) => String(e.className).split(' ').forEach((c) => c.startsWith('fx__') && window.__fxSeen.add(c)));
    }).observe(root, { childList: true, subtree: true });
  });
  let viaDone = false;
  /** Play a card "as 传教" with the real mouse: explanation on hover, source preview, reveal confirmation. */
  async function viaFlow() {
    const cards = page.locator('.hand .card.is-playable');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      await page.waitForSelector('.playmenu', { timeout: 2000 }).catch(() => {});
      const item = page.locator('.playmenu__item:has-text("当作「传教」")').first();
      if (!(await item.count())) {
        await page.keyboard.press('Escape');
        await page.mouse.click(700, 120); // close the menu
        continue;
      }
      await item.hover();
      await page.waitForSelector('.card-preview [data-card="evangelist"]', { timeout: 3000 });
      const why = await item.locator('.playmenu__why').textContent();
      assert.match(why, /角色技能「传教」/, 'option explains where it comes from');
      assert.match(why, /传教爱好者/, 'option names the role that grants it');
      assert.ok(await item.locator('.playmenu__reveal').count(), 'option warns that it reveals the role');
      await page.screenshot({ path: `${OUT}/ux-play-menu-why.png` });
      await item.click();
      await page.waitForSelector('.revealconfirm', { timeout: 3000 });
      await page.screenshot({ path: `${OUT}/ux-reveal-confirm.png` });
      await page.click('.revealconfirm .btn:has-text("再想想")');
      await page.waitForSelector('.revealconfirm', { state: 'detached', timeout: 3000 });
      assert.equal(await page.locator('.decide[data-kind="turn"]').count(), 1, 'cancelling the reveal changes nothing');
      assert.equal(await page.evaluate(() => document.querySelector('.myarea__roleflag')?.textContent), '未公开', 'role still hidden after cancelling');
      await cards.nth(i).click();
      await page.locator('.playmenu__item:has-text("当作「传教」")').first().click();
      await page.click('.revealconfirm .btn--gold:has-text("翻开并发动")');
      await page.waitForSelector('.fx__via, .fx__skill', { timeout: 8000 });
      log('played as 传教: explanation, source preview, reveal confirmation, skill effect');
      return true;
    }
    return false;
  }
  const tips = [];
  let emoted = false;
  let audited = false;
  const t0 = Date.now();
  let lastPrompt = null;
  while (Date.now() - t0 < 240_000) {
    // A human needs a moment to see a new decision (and the coach needs a frame to react to it).
    const promptId = await page.evaluate(() => document.querySelector('.decide')?.dataset.promptId ?? null);
    if (promptId && promptId !== lastPrompt) {
      lastPrompt = promptId;
      await sleep(450);
    }
    if (!viaDone && !(await page.locator('.coach__tip').count()) && (await page.locator('.decide[data-kind="turn"]').count()) && (await page.locator('.hand .card.is-playable').count()) >= 2) {
      viaDone = await viaFlow();
    }    const hasTip = await page.locator('.coach__tip').count();
    if (!hasTip) await page.evaluate(ACT, Math.random()).catch(() => {});
    const tip = await page.evaluate(() => {
      const t = document.querySelector('.coach__tip');
      return t ? { title: t.querySelector('.coach__title').textContent, finale: !!t.querySelector('.btn--gold')?.textContent.includes('回到首页') } : null;
    });
    if (tip) {
      const overlap = await page.evaluate(() => {
        const t = document.querySelector('.coach__tip')?.getBoundingClientRect();
        const d = document.querySelector('.decide')?.getBoundingClientRect();
        if (!t || !d) return false;
        return !(t.right < d.left || t.left > d.right || t.bottom < d.top || t.top > d.bottom);
      });
      assert.equal(overlap, false, 'a coach tip must never cover the decision panel');
    }
    if (tip && !tips.includes(tip.title)) {
      tips.push(tip.title);
      await page.screenshot({ path: `${OUT}/ux-coach-${tips.length}.png` });
    }
    if (tip?.finale) break;
    if (tip && !tip.finale) {
      // let the player read for a moment, then dismiss
      await sleep(350);
      await page.click('.coach__tip .btn--gold:has-text("知道了")', { timeout: 1500 }).catch(() => {});
    }
    if (!emoted && tips.length >= 3) {
      emoted = true;
      await page.click('.emotepicker .btn');
      await page.click('.emotepicker__pop button >> nth=0');
      await page.waitForSelector('.myarea .emote-bubble', { timeout: 4000 });
      log('emote bubble shows above my seat');
    }
    if (!audited && (await page.locator('.fx__play, .fx__flight, .fx__banner').count())) {
      audited = true;
      await jankAudit('table with effects');
    }
    await sleep(90);
  }
  log('coach tips shown:', tips.join(' → '));
  for (const needed of ['欢迎来到教学局！', '社群规模', '官作牌', '行动阶段']) assert.ok(tips.includes(needed), `coach showed "${needed}"`);
  assert.ok(viaDone, 'the 传教 explanation flow was exercised');
  const seenFx = await page.evaluate(() => [...window.__fxSeen]);
  log('effects rendered:', seenFx.filter((c) => /^fx__(play|via|skill|mod|value|num|seatfx|passive|shock|rays)$/.test(c)).join(' '));
  for (const needed of ['fx__play', 'fx__value', 'fx__num', 'fx__shock']) assert.ok(seenFx.includes(needed), `effect "${needed}" rendered during play`);  assert.ok(tips.includes('教学完成！'), 'tutorial reached its finale');
  await page.waitForSelector('.topbar .signal[data-ping]', { timeout: 6000 });
  await page.click('.coach__tip .btn--gold:has-text("回到首页")');
  await page.waitForSelector('.home__card', { timeout: 8000 });
  log('tutorial: played to the end and returned home');

  assert.deepEqual(problems, [], problems.join('\n'));
  ok = true;
  log('✔ UX regression test passed');
} catch (e) {
  console.error('✘ FAILED:', e.message);
  await page.screenshot({ path: `${OUT}/ux-FAIL.png` }).catch(() => {});
  if (problems.length) console.error(problems.slice(0, 8).join('\n'));
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
