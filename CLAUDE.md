# 逐梦东方圈 (Touhou Chasing Dream) — online multiplayer

Web version of the hidden-role card game described in `game_rule.pdf` (rulebook, rev. 20190905) and `cards.md` (card list).
Players host it on a VPS and play with friends in the browser. UI language: Simplified Chinese.
Status: feature-complete for a 1.0 playtest; see "Known gaps" at the bottom.

## Environment (this Windows PC)

winget is blocked by Group Policy, so the toolchain is **portable** under `%USERPROFILE%\tools`
(`node`, `python312`, `git\cmd`), and it is on the *user* PATH. A fresh shell may need:

```powershell
$t="$env:USERPROFILE\tools"; $env:Path="$t\node;$t\python312;$t\python312\Scripts;$t\git\cmd;$env:Path"
```

* Git refuses the repo (owned by a different Windows account) until
  `git config --global --add safe.directory "C:/Users/cheny198/Desktop/Touhou Chasing Dream"` — already done on this PC.
* PowerShell pitfall when patching files with `-replace`/`.Replace` in double-quoted strings: `$(...)` and `${...}` are
  expanded. Prefer the Edit tool for JS/TS containing `$(`.
* Never commit or print `admin_account_use_when_install.txt` (git/docker-ignored).

## Commands

| What | Command |
|---|---|
| Dev (server :3000 + Vite :5173 with WS proxy) | `npm run dev` → http://localhost:5173 |
| **Several human seats on this PC** | `npm run local` (or dev server + http://localhost:5173/local) — see "Local multi-seat" |
| Unit + integration tests (≈2 s) | `npm test` |
| Typecheck everything | `npm run typecheck` |
| Real-browser multiplayer test | `npm run e2e -- --players 4 --games 2` (builds first; `--players all` = 3…8) |
| Real-mouse UX regression (hover, glossary, gallery search/sort, settings, ping, tutorial, OS reduce-motion) | `node e2e/ux.mjs` |
| 3-D dice rest on the rolled face | `node e2e/dice.mjs` |
| Final-settlement show (verdict → one player at a time → board) | `node e2e/ceremony.mjs` |
| Your hand must not move during other players' turns (real-time pacing, ~2 min) | `node e2e/hand.mjs` |
| Effects at real pace: screenshots of every kind + "a card never vanishes from the stage" | `node e2e/fxshots.mjs --budget 150` → `e2e/out/fx-*.png` |
| Slow-network load (400 kbit/s, no third-party hosts, brotli, small first screen, thumbnails) | `node e2e/perf.mjs` |
| Rebuild web fonts (subset + sliced woff2) / card thumbnails | `python tools/fonts/build.py` / `python tools/art/thumbs.py` |
| Chaos test: N players + random real-mouse input | `node e2e/monkey.mjs --players 4 --seed 7` (the seed replays a failure) |
| Everything (types, tests, e2e 3–8p, ux, ceremony, hand, perf, effects, monkey, console, phone) | `npm run check` |
| Bot-vs-bot balance sim | `npm run sim -w @tcd/server -- 2000 5` (games, players) |
| Production build / run | `npm run build` then `npm start` (serves client + WS on `PORT`, default 3000) |
| Deploy on VPS | `DOMAIN=game.example.com docker compose -f deploy/docker-compose.yml up -d --build` |

## Architecture

npm workspaces monorepo (`packages/*`, `e2e`):

```
packages/shared   Card catalogue + wire protocol + rule constants (pure TS, no deps)
  src/cards/*.ts    ACTION_CARDS / EVENT_CARDS / OFFICIAL_CARDS / ROLE_CARDS — single source of truth
  src/protocol.ts   Prompt (decisions), GameView (per-player projection), LogEntry+Fx, socket event maps
  src/rules.ts      limits, judgement tables, endThreshold(players, customRounds)
  src/glossary.ts   keyword side-box texts + explain(cardId): terms found in a card's text + the other cards it mentions
packages/server   Authoritative engine + Socket.IO rooms (Express serves the built client)
  src/engine/Game.ts     state + primitives: ask(), setAuto(), draw/discard/transfer, changeInfluence/changeCommunity, judge, officialActive
  src/engine/flow.ts     game loop: role select → rounds → turn phases → final settlement; playCard, listMoves
  src/engine/actions.ts  one handler per action card
  src/engine/events.ts   one handler per event card, EventCtx (event-only modifiers), resolveEvent, decideDirection (最终解释权 → 墨菲定律)
  src/engine/roles.ts    role triggers (called from Game primitives) + action-phase skills + alt plays (当作X打出)
  src/engine/officials.ts revealOfficial (花映塚 / 凭依华); other officials are queried inline via g.officialActive(id)
  src/engine/scoring.ts  win conditions, bonuses, 胜点
  src/engine/view.ts     buildView(): hides hands, face-down roles/events, others' prompts; the log is sent as a delta (only lines the player has not got)
  src/engine/bot.ts      heuristic bot (AI seats AND 托管 for absent humans AND fuzzing); never throws
  src/rooms.ts           RoomHub: sessions (token → playerId), rooms (4-char code), bots, host controls + validated settings, chat,
                         reconnect, offline 托管, latency (net:ping / net:rtt), emotes, tutorial room (room:tutorial)
packages/client   React 19 + Vite + zustand + motion
  src/store.ts          socket wiring; fx queue, the centre `stage`, `shown` meter values; sounds; log accumulation (server sends deltas); auto-join (?auto=); reports status to /local parent
  src/net.ts            socket, session token, `?as=` identity namespace, prefs
  src/audio.ts          synthesised sound effects (WebAudio, no assets) + mute
  src/cards/Card.tsx    the card component. Each KIND has its own silhouette/colour/tag (see "Card kinds"); keyword highlight; long-press preview on touch
  src/ui/Overlays.tsx   CardPreview (placed in a layout effect from the tracked pointer) + GlossList side boxes; toasts; connection banner
  src/ui/Signal.tsx     latency bars + ms
  src/game/*            Table, Seat, Center, MyArea (hand), prompt.tsx (every decision UI), SidePanel, Emotes, Shortcuts, Coach.tsx (tutorial),
                        Results.tsx (the final-settlement show), Burst.tsx + fx.css (particle presets, effect CSS), ceremony.css
  src/game/fx/          the effects layer: index (queue runner) · Stage (the card standing in the middle) · NumberFx (calculation tape + number slams) ·
                        DiceFx (3-D die) · SkillFx (reveal / skills / modifiers / shields) · TargetFx (lock-on) · Banners (turn, round, official) · Flights
  src/screens/*         Home, Lobby + SettingsPanel, Sheets (settings; lazy-loads Guide + Gallery), Gallery (search / sort / filter), Guide (illustrated rules),
                        LocalSeats (/local console, lazy)
  public/art/…          generated illustrations (`cards/<id>.webp` 640 px + `cards/<id>.s.webp` 240 px thumbnails), public/fonts/ self-hosted font slices
e2e/               Playwright drivers: run.mjs (N independent players), local.mjs (/local console), mobile.mjs (responsive), driver.mjs (the "human")
scripts/local.mjs  `npm run local`
tools/art          ComfyUI pipeline (see "Art") + thumbs.py
tools/fonts        build.py: subsets Noto Serif SC / Ma Shan Zheng into unicode-range slices (public/fonts + styles/fonts.css)
deploy/            docker-compose + Caddy (auto-HTTPS), systemd unit alternative
```

### Engine model (read before changing rules)

* The engine is **async/await coroutine style**. A card effect is an `async` function that calls
  `await g.ask(player, promptSpec)` whenever a player must decide. `ask` resolves from the socket
  (`Game.answer`), from the bot (`botAnswer`), from the timeout (`defaultValue`), or from a test script (`opts.decide`).
* Several `ask`s can be pending at once (simultaneous choices use `Promise.all`).
* **托管 (auto-play)**: two consecutive prompt timeouts, or 25 s offline mid-game (`TCD_OFFLINE_AUTO_MS`), set `player.auto`;
  the bot then answers for them. Any answer / reconnect / 取消托管 (`game:resume`) clears it. The table shows a 托管 tag.
* **All number changes go through `g.changeInfluence` / `g.changeCommunity`.** They apply clamps, 神灵庙,
  备受瞩目 locks, 自闭 immunity, 桃源民 negation, NPC / 分层 / 东方乙烷, and fire role reactions
  (挂裱 counter, 洗地, 扩列, 游场 …). Event cards use `ev.comm()` / `ev.inf()` instead, which add the
  event-only modifiers (辉针城 doubling, 事先科普, 煽风点火, 心绮楼, 噩梦日记, 游场②) and then call the primitives.
* Hand changes go through `g.gainCards` / `g.loseCards` / `g.discard` / `g.transfer` so 人脉, 律人律己, 以身作则, 老资历 fire.
* `g.n(x)` = printed number (doubled under 辉针城). Dice results and computed X are *not* doubled.
* Reaction prompts use `{ secret: true }` so other players can't see who is deciding (hides hand info).
* Log text uses tokens `{p:playerId}`, `{c:cardId}`, `{n:+2}`; the client renders them as coloured chips.
  Attach an `Fx` to a log entry to get an animation (`play`, `dice`, `event`, `official`, `reveal`) and a sound.
* `safely()` in flow.ts catches handler exceptions so a rules bug skips one effect instead of freezing a live game
  (tests fail if anything is caught: they assert `console.error` was never called).
* **Privacy is enforced only in `view.ts`.** Never put another player's hand/role/face-down event/prompt into a `GameView`.
  `test/privacy.test.ts` (string-searches serialised views) and `e2e/run.mjs` (checks *every* socket frame) guard this.

### Adding / fixing a card
1. Text lives in `packages/shared/src/cards/*.ts` (keep it faithful to the rulebook incl. 规则更正).
2. Behaviour lives in `ACTIONS[id]`, `EVENTS[id]`, or roles.ts. Use the primitives above.
3. Add a scripted test in `packages/server/test/audit.test.ts` (helpers in `test/harness.ts`: `scriptedGame`, `giveCards`,
   `startTurn`, `setOfficial`; fix dice with `g.rng.die = () => 6`).
4. `npm test`. `coverage.test.ts` parses `cards.md` and fails if a card/count is missing; `fuzz.test.ts` plays every role
   (face-up and face-down) and proves every card is reachable by bots.

## Testing

| Layer | Where | What it proves |
|---|---|---|
| Coverage audit | `test/coverage.test.ts` | every card name + copy count in `cards.md` exists; every card has a handler |
| Scripted rules | `test/rules.test.ts`, `test/audit.test.ts` | ~40 FAQ-driven interactions (墨菲/最终解释权, 神灵庙+自爆, 人类的本质, 众筹, scoring, …) |
| Fuzz | `test/fuzz.test.ts`, `test/simulate.test.ts` | 26 roles × revealed/hidden × 3–8 players, 125+400 full bot games: no engine errors, card conservation, bounds |
| Privacy | `test/privacy.test.ts` | views never leak hands, turn events, face-down events, hidden roles; prompts routed to the right seat |
| Features | `test/features.test.ts` | glossary correctness; custom rounds / starting hand / host-first / balanced roles; settings clamping; spectator switch; tutorial room; ping; emotes |
| Rooms | `test/rooms.test.ts` | real sockets: room codes, capacity 8, host-only actions, kick, host transfer, reconnect by token, spectators, chat flood |
| Browser e2e | `e2e/run.mjs` | N independent browser contexts play full games through the UI: lobby → role pick → game → scoring → rematch → 2nd game; spectator; reload, real network loss, 25 s absence → 托管 → return; privacy invariant on every frame; 0 console errors |
| Tabs e2e | `e2e/tabs.mjs` | `?as=` gives tabs of ONE browser profile separate identities; reload keeps the seat |
| Effects | `test/effects.test.ts` | fx carry who/what caused each change and its calculation (`calc` steps, 辉针城 ×2, caps); a card stays on the stage until `settle`; immunities → `block`; score story (`ScoreLine.steps`); move `why`/`reveals`; prompt `reveals`; abort vote over sockets; pace validation; the log is sent as a delta |
| Vote e2e | `e2e/vote.mjs` | two browser players: refusal keeps the game, cooldown, unanimous vote returns both to the room, a new game starts |
| UX e2e | `e2e/ux.mjs` | real mouse: no layout/paint-property animations and no backdrop blur (jank); hover preview sits beside the pointer from its FIRST frame, clears when the gallery closes; glossary boxes present/absent as expected; the four card kinds are visually distinct; custom rounds; latency indicator; emote bubble; the whole coached tutorial (tips never cover the decision panel) |
| Ceremony e2e | `e2e/ceremony.mjs` | after a game: verdict → each player once (steps, total, 胜点) → board; "next" / "skip" work |
| Dice e2e | `e2e/dice.mjs` | injects dice effects through the `?e2e` store hook: for every face the cube rests showing exactly that face (hit-test), the result text and legend are right |
| Hand e2e | `e2e/hand.mjs` | real-time game: while other players act, no hand card moves (the bug was side columns of auto width re-centring the hand) |
| Effects e2e | `e2e/fxshots.mjs` | real-time game, screenshots of every effect kind; a card standing on the stage never fades or vanishes before its settle |
| Perf e2e | `e2e/perf.mjs` | 400 kbit/s link: title screen < 400 KB / 25 s, only same-origin requests, brotli, thumbnails not full pictures, no bulk full-size downloads |
| Monkey e2e | `e2e/monkey.mjs` | 3–8 independent players finish a game while a per-seat monkey hovers, clicks, presses keys and resizes at random: no page errors, no "undefined/NaN" text, no lingering preview |
| Console e2e | `e2e/local.mjs` | `/local` with 4–8 seats in one window plays a game; seats are isolated |
| Responsive | `e2e/mobile.mjs` | phone/landscape/tablet/laptop: no horizontal overflow, decision panel on-screen |

Server knobs used by e2e (env): `TCD_TEST_FAST=1` (no cosmetic pauses), `TCD_PROMPT_TIMEOUT=0` (seconds; default 60),
`TCD_OFFLINE_AUTO_MS=3000` (default 25000). A fast server also sets `RoomView.fast`, which makes the client squeeze its effect durations to 4 %. The e2e "human" is `e2e/driver.mjs` `ACT()` — it only clicks what a player could click;
decision UI exposes `data-prompt-id`, `data-kind`, `data-min`, `data-max` for it. Failures leave screenshots in `e2e/out/`.

## Card kinds, glossary, tutorial, settings

* **Kinds must never be confusable** (a playtester confused action cards tagged "事件" with event cards): 行动 = red rounded portrait card with a "行动"
  tag; 事件 = blue **arched** card with a "事件 · topic" ribbon and 正/逆 markers; 官作 = gold **landscape** card; 角色 = portrait with a vertical name strip
  and a "角色" tag. The category label of 消息灵通/火星/走漏风声 is "改事件". Card backs use the same silhouettes. `ux.mjs` asserts tags, ratio and radius.
* **Glossary** (`shared/src/glossary.ts`): hovering a card shows side boxes (Slay-the-Spire style) for non-obvious terms (判定 kinds, 拼点, 偏移量, 扣置, 延时,
  响应, 连锁 …), for a role's faction (its win condition) and for the text of other cards it mentions (东方绯想天 → 东方非想天则, 联机对战). Basics (手牌, 弃牌堆,
  个人影响力, 社群规模) are intentionally absent. To add a term add an entry to `TERMS`; `features.test.ts` guards bounds and duplicates.
* **Tutorial**: Home → 新手教学局 (`room:tutorial`): you (传教爱好者) + 2 AI, 3 rounds, 3 starting cards, no time limit, hidden from the room list.
  `Coach.tsx` has ~19 tips keyed on game state, each anchored to a DOM selector with a highlight ring; tips about your own area dock at the left edge so they never
  cover controls. To add a tip add an entry to `TIPS` (`ux.mjs` plays the whole tutorial).
* **Room settings** (`RoomSettings` in protocol.ts, validated in rooms.ts, enforced through `GameOptions`): rounds (0 = rulebook 12 − players), startingHand,
  firstPlayer, balancedRoles, allowSpectators, roleChoices, promptTimeout, botDelay. UI: `screens/SettingsPanel.tsx`.
* **Jank rules** (a user reported twitching backgrounds on Edge and Brave): animate only transform/opacity; never `backdrop-filter`; never animate
  box-shadow/filter (animate the opacity of a pseudo-element instead); hidden /local seats and background tabs get `html.paused`. `ux.mjs` audits
  `document.getAnimations()` and computed styles. Real GPU smoothness can only be judged on real hardware (headless uses software rendering).
  **There is no "reduce motion" option and no `prefers-reduced-motion` CSS**: shortening every `animation-duration` to ~0 ms (the usual snippet) makes
  *infinite* animations loop thousands of times a second — the real cause of the "twitching background / spinning logo / trembling cover cards" reports from
  players whose OS has animations switched off. `ux.mjs` emulates `reducedMotion: reduce` and fails on any looping animation faster than 400 ms.
* **Latency**: the client times a `net:ping` ack every 3 s, smooths it and reports `net:rtt`; the server exposes `RoomMember.ping` / `PlayerView.ping`
  (re-broadcast only on a ≥ 25 ms change). **Emotes**: whitelist `EMOTES` in rooms.ts and `ui/emotes.ts` on the client; 1 per 1.2 s.
* **Effects pipeline** (what makes the table feel alive; read before touching `game/fx/`): every effect is a `Fx` attached to a log entry; shared `fxMs(fx)`
  (protocol.ts) says how long the table lingers on it. The **server** pauses that long after logging it (`Game.show`, scaled by the room's `pace`:
  epic 1 (default) / normal 0.8 / quick 0.55; tests run `fast`), the **client** (`game/fx/index.tsx`) holds its queue for the same time — so picture and game stay in step.
  Effects that are logged synchronously (a reveal, a passive skill) add to `Game.owed`, paid by the next pause or prompt.
  * **Stage**: `Game.stage()` logs `play` (card on the centre stage — action cards, and events with `direction`), runs the effect, then logs `settle` (`to`: discard /
    delay / chain / keep / gift) and only then moves the card in the state. The client keeps the card in the middle (`store.stage`, `game/fx/Stage.tsx`) for the whole
    decision (targets, reactions, numbers — shows "…" while its owner is deciding), steps aside while numbers/dice/reveals take the middle, flies to its pile on `settle`.
    Nested plays (墨菲定律, 挂裱 counter) stack. A 60 s watchdog clears a stage whose `settle` got lost.
  * `target` (`g.target`): beam from the card to each target seat + reticle. `dice`: a real 3-D cube thrown from the roller's seat, ~5 s, result only after it rests,
    legend of the judgement table (gotcha: never put `filter` / `opacity` on the `.cube` — it flattens the 3-D faces and the die vanishes edge-on). `skill`/`reveal`: a role turning face-up flips in the middle of everyone's screen with its whole text (`RevealFx`).
    `block` (自闭 / 备受瞩目 …): shield at the seat. `discard`: face-up cards fly to the pile. `turn` / `round`: bands. `mod`: only for modifiers that stop a change (事先科普).
  * **Number changes carry their calculation**: `changeInfluence/Community` build `calc: CalcStep[]` (printed number → each modifier → caps/floors); `EventCtx.comm/inf`
    add 煽风点火 / 辉针城 / 心绮楼 …; for action cards `Game.n()` remembers a 辉针城 doubling. With ≥ 2 steps the client tells them one by one (tape) and the number lands
    after the last; tiers by |Δ| (1–2 / 3–4 / ≥ 5) scale the slam. Meters (`store.shown`) and the log panel hold back until the effect that changes them has played.
  * Sounds fire at playback. `log` lines with empty text (settle) are not shown. Draw/transfer flights are not queued (they play on arrival).* **Explaining moves** (`TurnMove.why`, `.reveals`): `flow.listMoves` / `roles.skillMoves` attach a title/text/source card to every non-obvious option
  (role skills granting 当作X, officials, copies). The play menu shows it and hovering previews the source card. Moves with `reveals` (an active skill
  while face-down) open `RevealConfirm`; prompts about your own hidden role carry `Prompt.reveals` (set in `Game.ask` when `cardId === who.role`) and show a warning.
* **Abort vote** (`vote:start` / `vote:cast` / `vote:state`, `Room.startVote`): any seated human may propose "中止本局并回到房间"; every *online, non-托管* human must agree
  (proposer counts yes; offline/托管 players don't block); a refusal or the 30 s timeout cancels it (45 s cooldown per proposer). Tutorial rooms just leave.
  UI: `game/Vote.tsx`; test: `e2e/vote.mjs` + `test/effects.test.ts`.
* **Card effects**: `game/Burst.tsx` maps each action card to a CSS particle preset (rings, coins, flash, siren, smoke, flames, clash, swap, shield, mirror,
  bubbles, paper, sparkle). Draw/transfer log entries become card flights; community swings ≥ 3 shake the opponents and the centre (never your own area); winners get confetti.
* **Final settlement show** (`game/Results.tsx`): after the last effects, the community verdict, then every player from the lowest result to the winner — role flips, the
  story of the score (`ScoreLine.steps`: conditions ticked ✓/✗, base score, bonus), the total counting up, 胜点 stamped with its reason (`vpNote`) — then the board. Skippable.
  The tutorial coach waits for the board (`store.finale`) before its closing tip.
* **Gallery** (`screens/Gallery.tsx`): tabs (角色/行动/事件/官作/全部), search over name + effect text + category + subtitle (all words must match), sort (default / name / count / group),
  group chips. `/` focuses the search box.
* **Network performance** (play on a bad link): self-hosted font slices (`tools/fonts/build.py`; body text uses system CJK fonts), card thumbnails `*.s.webp` (hand/seat sizes;
  large previews layer full picture over thumbnail), thumbnails only are warmed in the background and not on data-saver/slow links, brotli + gzip precompressed assets
  (`client/scripts/precompress.mjs`, served by `server/src/index.ts` with immutable caching), vendor chunks + lazy chunks (Guide, Gallery, Coach, Results, /local),
  Socket.IO `perMessageDeflate`, log sent as a delta (`buildView(..., logSince)`, `Room.logSent`; the client merges in `store.ingestGame`, new connections get a recent tail),
  an instant splash in `index.html`. `e2e/perf.mjs` guards it.

## Local multi-seat (`/local`)

Several human seats in ONE browser window, each with its own identity, hand and role. `?as=NAME` namespaces the session token and nickname
in localStorage, so tabs of the same browser are independent players; `/local` embeds one iframe per seat (`/?as=<run><n>&auto=create|join:CODE`).
Seat 1 creates the room and reports its code via `postMessage`; the others join. Seats report status (waiting for a decision, host, turn,
role, 托管) to the console, which shows tabs with a red dot when a seat must act. Keys: Alt+1…8. Buttons: add AI, start, rematch,
focus/grid (grid renders each seat at 1440×820 and scales it), reset identities.
Same-origin only (`postMessage` checks `location.origin`). It also works in production (hot-seat on a shared screen).

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
* 胜点 tie: equal top score → higher influence gets 2; if still tied, all tied players get 2. A player who meets their win
  condition but has base score 0 gets 0 胜点 (rulebook: "其他得分不为0的玩家计1胜点").
* Role dealing: each player is offered ≥1 繁荣 and ≥1 小众 role (rulebook suggests balancing).
* 鬼形兽: the 3rd action card becomes a copy of the last discarded action; if that copy is unplayable (e.g. 墨菲定律) the 3rd card can't be played.
* 人类的本质: never enters the discard pile; if it copied a delay card it is passed on when that card triggers.
* 火星: the held event is discarded first, so it may itself be picked back up.
* 自闭: others' effects can't touch you (targets, draws, events); your own cards still work.
* Skills described as usable "在你的回合内任意阶段" (新刊预告/社交教育/发布正片/初音) are offered in the action phase only.
* `cards.md` totals: 79 action, 78 event, 24 official, 26 role cards (rulebook boxes say 80/60/23/26) — we follow `cards.md`.

## Art

Generated locally with ComfyUI + Animagine XL 4.0 (SDXL, 832×1216, 28 steps, CFG 5, euler_a) on the RTX 4070 SUPER.
* Install: `tools/art/setup-comfyui.ps1` (ComfyUI at `%USERPROFILE%\ComfyUI`, torch cu126).
* Run server: `%USERPROFILE%\ComfyUI\venv\Scripts\python.exe %USERPROFILE%\ComfyUI\main.py --port 8188`
* Prompts: `tools/art/prompts.json` (`id → {prompt, size?, seed?}`); style/negative in `tools/art/generate.py`.
* Generate missing: `...\venv\Scripts\python.exe tools/art/generate.py`; redo some: `generate.py id1 id2 --seed-offset 3`.
* Output: `packages/client/public/art/cards/<id>.webp` (640 px wide) and `.../art/bg/<id>.webp`.

## Known gaps / roadmap (prioritised)

1. **Playtest with humans** and fix rule edge cases; add a scripted test for each fix. (Bot win rates from `npm run sim` are a smoke test, not balance data.)
2. Reaction windows (墨菲定律, 挂裱, skills) only prompt players who can react, so response *time* can hint at who holds a card.
   A fixed-length "others may respond" countdown shown to everyone would close this leak.
3. Smarter bots (the current one steers 社群规模 by faction and values cards, but doesn't plan, bluff or use most skills well).
4. Reveal skills usable "at any phase" are only offered during the action phase.
5. Game state is in memory: a server restart ends running games (lobby/rooms too). Persisting needs an event log + replay (engine is a coroutine).
6. Draw/transfer flights are not part of the effect queue (they fly on arrival, so they can run slightly ahead of a long effect still playing).
7. Sound is synthesised and minimal; real music/SFX would lift the feel. Phone layout is functional, not yet beautiful. Hand-drawn per-card animation
   (beyond the shared particle presets) would be the next step for the most iconic cards.
8. Post-game replay of the log; in-game tutorial / tooltips for first-time players; localisation (strings are hard-coded Chinese).
