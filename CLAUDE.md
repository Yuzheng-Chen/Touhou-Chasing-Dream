# 逐梦东方圈 (Touhou Chasing Dream) — online multiplayer

Web version of the hidden-role card game described in `game_rule.pdf` (rulebook, rev. 20190905) and `cards.md` (card list).
Players host it on a VPS and play with friends in the browser. UI language: Simplified Chinese.

## Environment (this Windows PC)

winget is blocked by Group Policy, so the toolchain is **portable** under `%USERPROFILE%\tools`
(`node`, `python312`, `git\cmd`), and it is on the *user* PATH. A fresh shell may need:

```powershell
$t="$env:USERPROFILE\tools"; $env:Path="$t\node;$t\python312;$t\python312\Scripts;$t\git\cmd;$env:Path"
```

Never commit or print `admin_account_use_when_install.txt` (it is git/docker-ignored).

## Commands

| What | Command |
|---|---|
| Dev (server :3000 + Vite :5173 with WS proxy) | `npm run dev` → open http://localhost:5173 |
| Tests (engine rules + bot fuzzing) | `npm test` |
| Typecheck everything | `npm run typecheck` |
| Bot-vs-bot balance sim | `npm run sim -w @tcd/server -- 300 5` (games, players) |
| Production build | `npm run build` then `npm start` (serves client + WS on `PORT`, default 3000) |
| Deploy on VPS | `DOMAIN=game.example.com docker compose -f deploy/docker-compose.yml up -d --build` |

## Architecture

npm workspaces monorepo:

```
packages/shared   Card catalogue + wire protocol + rule constants (pure TS, no deps)
  src/cards/*.ts    ACTION_CARDS / EVENT_CARDS / OFFICIAL_CARDS / ROLE_CARDS — single source of truth
  src/protocol.ts   Prompt (decisions), GameView (per-player projection), LogEntry+Fx, socket event maps
  src/rules.ts      limits, judgement tables, endThreshold
packages/server   Authoritative engine + Socket.IO rooms (Express serves the built client)
  src/engine/Game.ts     state + primitives: ask(), draw/discard/transfer, changeInfluence/changeCommunity, judge, officialActive
  src/engine/flow.ts     game loop: role select → rounds → turn phases → final settlement; playCard, listMoves
  src/engine/actions.ts  one handler per action card
  src/engine/events.ts   one handler per event card, EventCtx (event-only modifiers), resolveEvent, decideDirection (最终解释权 → 墨菲定律)
  src/engine/roles.ts    role triggers (called from Game primitives) + action-phase skills + alt plays (当作X打出)
  src/engine/officials.ts revealOfficial (花映塚 / 凭依华); other officials are queried inline via g.officialActive(id)
  src/engine/scoring.ts  win conditions, bonuses, 胜点
  src/engine/view.ts     buildView(): hides hands, face-down roles/events, others' prompts
  src/engine/bot.ts      random-but-sane bot (also used for fuzzing)
  src/rooms.ts           RoomHub: sessions (token → playerId), rooms (4-char code), bots, host controls, chat, reconnect
packages/client   React 19 + Vite + zustand + motion
  src/store.ts          socket wiring; turns new log entries into an fx queue + meter "pulses"
  src/cards/Card.tsx    the card component (art + frame + text); CardBack; YinYang
  src/game/*            Table, Seat, Center (meter/official/decks/zones), MyArea (hand), prompt.tsx (all decision UIs), Fx, Results, SidePanel
  src/screens/*         Home, Lobby, Sheets (rules + card gallery)
  public/art/cards/<cardId>.webp, public/art/bg/*.webp   generated illustrations
tools/art          ComfyUI pipeline (see "Art" below)
deploy/            docker-compose + Caddy (auto-HTTPS), systemd unit alternative
```

### Engine model (read before changing rules)

* The engine is **async/await coroutine style**. A card effect is an `async` function that calls
  `await g.ask(player, promptSpec)` whenever a player must decide. `ask` resolves from the socket
  (`Game.answer`), from the bot (`botAnswer`), from the timeout (`defaultValue`), or from a test script (`opts.decide`).
* Several `ask`s can be pending at once (simultaneous choices use `Promise.all`).
* **All number changes go through `g.changeInfluence` / `g.changeCommunity`.** They apply clamps, 神灵庙,
  备受瞩目 locks, 自闭 immunity, 桃源民 negation, NPC / 分层 / 东方乙烷, and fire role reactions
  (挂裱 counter, 洗地, 扩列, 游场 …). Event cards use `ev.comm()` / `ev.inf()` instead, which add the
  event-only modifiers (辉针城 doubling, 事先科普, 煽风点火, 心绮楼, 噩梦日记, 游场②) and then call the primitives.
* Hand changes go through `g.gainCards` / `g.loseCards` / `g.discard` / `g.transfer` so 人脉, 律人律己, 以身作则, 老资历 fire.
* `g.n(x)` = printed number (doubled under 辉针城). Dice results and computed X are *not* doubled.
* Reaction prompts use `{ secret: true }` so other players can't see who is deciding (hides hand info).
* Log text uses tokens `{p:playerId}`, `{c:cardId}`, `{n:+2}`; the client renders them as coloured chips.
  Attach an `Fx` to a log entry to get an animation (`play`, `dice`, `event`, `official`, `reveal`).
* `safely()` in flow.ts catches handler exceptions so a rules bug skips one effect instead of freezing a live game.

### Adding / fixing a card
1. Text lives in `packages/shared/src/cards/*.ts` (keep it faithful to the rulebook incl. 规则更正).
2. Behaviour lives in `ACTIONS[id]`, `EVENTS[id]`, or roles.ts. Use the primitives above.
3. Add a scripted test in `packages/server/test/rules.test.ts` (see `test/harness.ts`: `scriptedGame`, `giveCards`, `startTurn`, `setOfficial`).
4. `npm test` — the fuzz suite plays 125 full bot games and checks card conservation + bounds.

## Rule interpretations (decided during setup — revisit if playtesters disagree)

* 众筹: effects are cumulative by threshold (≥1: each funder +1; ≥2: 社群±X; ≥3: each funder draws 1); all players join → cancelled.
* 白嫖 / ZUN的迷之发言 / 文花帖DS take a **random** card (blind pick, like the physical game). 白嫖 can't target yourself.
* 东方文花帖DS replaces the whole draw phase.
* 煽风点火 adds +1 magnitude to every community *and* influence change of the next resolved event. All queued delay cards trigger together (FAQ).
* 大病一场 is handled outside `resolveEvent`, so it does not consume delay cards ("无视任何牌效果").
* 二轩目直播·正 repeats the last event that was *resolved*, in the same direction.
* "失去手牌" includes playing a reaction card outside your turn (affects 人脉 / 律人律己).
* 挂裱 counter can answer any influence reduction caused by another player (cards, events, skills); it's blocked by 东方红魔乡.
* 桃源民·遗世独立 covers influence reductions, being 白嫖'd, and forced discards caused by another player's card/event.
* NPC: X is capped at ceil(|decrease|/2). 分层 and 居高临下: once per turn.
* 最终结算: `lockdown` disables active skills and reaction cards; passive skills still apply.
* First player is random (rulebook uses "youngest player rolls a die").
* 胜点 tie: equal top score → higher influence gets 2; if still tied, all tied players get 2.
* Role dealing: each player is offered ≥1 繁荣 and ≥1 小众 role (rulebook suggests balancing).
* 鬼形兽: the 3rd action card becomes a copy of the last discarded action; if that copy is unplayable (e.g. 墨菲定律) the 3rd card can't be played.
* 事件牌 counts in `cards.md` sum to 78 (rulebook says 60), actions to 79 (rulebook 80) — we follow `cards.md`.

## Art

Generated locally with ComfyUI + Animagine XL 4.0 (SDXL, 832×1216, 28 steps, CFG 5, euler_a) on the RTX 4070 SUPER.
* Install: `tools/art/setup-comfyui.ps1` (ComfyUI at `%USERPROFILE%\ComfyUI`, torch cu126).
* Run server: `%USERPROFILE%\ComfyUI\venv\Scripts\python.exe %USERPROFILE%\ComfyUI\main.py --port 8188`
* Prompts: `tools/art/prompts.json` (`id → {prompt, size?, seed?}`); style/negative in `tools/art/generate.py`.
* Generate missing: `...\venv\Scripts\python.exe tools/art/generate.py`; redo some: `generate.py id1 id2 --seed-offset 3`.
* Output: `packages/client/public/art/cards/<id>.webp` (640 px wide) and `.../art/bg/<id>.webp`.

## Roadmap / known gaps (prioritised)

1. **Playtest with humans** and fix rule edge cases; add a scripted test for each fix.
2. **Auto-play (托管)** for disconnected players (today their prompts wait for the timeout, then take the default).
3. Smarter bots (faction-aware: push community toward their side, protect own influence, use reactions wisely).
4. Sound design (card play, dice, event stingers, turn chime) with a mute toggle.
5. Mobile polish (hand fan + decision panel on narrow screens; long-press for card preview).
6. Card-flight animations between seats for transfers/draws (`Fx` `draw` / `transfer` exist but aren't animated yet).
7. Game persistence across server restarts (state is in memory; the engine is a coroutine, so this needs an event log + replay).
8. Spectator polish; in-game tooltips explaining phases; post-game replay of the log.
