# 逐梦东方圈 · Touhou Chasing Dream (Online)

An online multiplayer version of the hidden-role card game **逐梦东方圈**: 3–8 players, AI seats, room codes, reconnection
(with automatic AI cover for players who drop), spectators, chat, sound, and an original illustration for every card.

## Play

Requires Node.js 20+.

```bash
npm install
npm run dev            # http://localhost:5173
```

New here? Press **🎓 新手教学局** on the title screen: you and two AI play three rounds while on-screen tips explain the goal, the meters, the
four kinds of cards, events, and each decision as it comes up. The **新手指南** (illustrated rules) is one click away everywhere.

Create a room, share the 4-letter code (or the `/r/CODE` link), add AI players if you are short, tune the **房间设置**, and press 开始游戏.

* **Room settings:** game length (rulebook default 12 − players rounds, or any 2–12), starting hand, who goes first, number of role choices,
  balanced factions, decision time limit, AI speed, spectators on/off.
* **Cards:** hover any card (long-press on a phone) for a large view; terms that need explaining (判定 kinds, 拼点, 扣置 …) and other cards it
  mentions get side boxes, like Slay the Spire's keywords. Each kind of card has its own shape: red rounded **行动**, blue arched **事件**,
  gold landscape **官作**, vertical-name **角色**.
* **Effects:** every card slams onto the table with its own effect; an unusual play says where it comes from ("角色技能「传教」: 把「白嫖」当作「传教」打出");
  skills, rule modifiers (煽风点火 +1 …) and every change to 社群规模 or 个人影响力 get an effect that grows with the size of the change. The play menu explains
  why an option exists (hover it to preview the source card), and anything that would flip your role card asks for confirmation first.
* **Leaving a game:** 中止本局 proposes abandoning the game and returning to the room; every online player must agree.
* **Table:** latency bars for every player, emotes (😀), keyboard shortcuts (Space = end action, 1–9 = play card, L = log/chat),
  card-specific effects (switch off with ⚙ → 减少动画), sound with volume.

## Test with several human players on one computer

You do not need several devices or browsers. Start the **multi-seat console**:

```bash
npm run local                  # builds once, starts the server, opens the console
npm run local -- --seats 6     # choose 3–8 seats
```

(or, with `npm run dev` already running, open <http://localhost:5173/local>.)

1. Pick the number of seats and press **创建房间并入座**. Seat 1 (the host) creates a room and the other seats join it automatically.
2. Press **▶ 开始游戏** in the top bar. Each seat is a fully independent player: its own identity, private hand, role and
   reconnect slot — it cannot see what the other seats hold, exactly like separate computers.
3. **Switch seats** by clicking a tab or with <kbd>Alt</kbd>+<kbd>1…8</kbd>. A **red dot** on a tab means that seat has a decision to make;
   a glowing number means it is that seat's turn.
4. **总览 / 聚焦** toggles between one big seat and a grid showing every seat at once (handy to watch what each player sees).
5. **＋AI** adds bots to the lobby, **再来一局** starts a rematch after the final scoring, **重置** gives every seat a brand-new identity.

Other ways to get independent seats:

* **Separate tabs in one browser:** open `http://localhost:5173/?as=alice`, `…/?as=bob`, `…/?as=carol`. The `as` name gives each tab its own
  identity (plain tabs without it share one identity). Add `&name=Alice` to preset the nickname.
* **Different browsers / private windows / your phone** on the same Wi-Fi (`http://<your-pc-ip>:5173`) are separate identities too.

To test reconnection by hand: close a seat's tab (or use DevTools → Network → Offline) and reopen it — you return to the same seat.
If a player is away for ~25 s, an AI covers for them (托管) and hands the seat back the moment they return.

## Automated tests

```bash
npm test                        # ~110 engine/room/glossary tests in ~2 s
npm run e2e -- --players 4      # real browsers: N independent players play complete games (builds first)
npm run e2e -- --players all    # 3, 4, 5, 6, 7 and 8 players, two games each (with rematch)
node e2e/ux.mjs                 # real-mouse UX regression: hover, glossary, settings, latency, emotes, the whole tutorial
node e2e/monkey.mjs --players 5 # chaos: random hovering/clicking/keys/resizing while a full game is played
npm run check                   # typecheck + unit tests + every e2e suite
```

The browser tests start their own server, drive every player only through the UI, and verify: lobby and role choice, full games to the
final scoring screen, rematch, spectators, hidden information on every socket frame, reconnection (reload, real network loss, long absence),
animations that would cause jank, hover-preview behaviour, and zero console errors. Screenshots land in `e2e/out/`. Details are in `CLAUDE.md`.

## Host on your VPS

### Option A — Docker (recommended, HTTPS included)

1. Point a domain's DNS A record at the VPS (e.g. `touhou.example.com`).
2. On the VPS:

```bash
git clone <your repo> touhou && cd touhou
DOMAIN=touhou.example.com docker compose -f deploy/docker-compose.yml up -d --build
```

Caddy fetches a Let's Encrypt certificate automatically. With no domain, run with `DOMAIN=:80` and open `http://<vps-ip>`.
To update: `git pull && docker compose -f deploy/docker-compose.yml up -d --build`.

### Option B — plain Node

```bash
npm ci && npm run build
PORT=3000 npm start
```

Put it behind nginx/Caddy (WebSocket upgrade must be allowed on `/socket.io/`). A systemd unit is in `deploy/`.
Game state lives in memory: restarting the server ends running games.

## Tips for the table

* Reactions (挂裱, 墨菲定律, role skills) are offered automatically when they become legal.
* The host sets the decision time limit, the number of role choices and the AI speed in the lobby.
* A seat that times out twice in a row, or disconnects for a while, is played by an AI until the player acts or presses 取消托管.
* 🔊/🔇 in the top bar mutes sound effects (remembered per browser).

## Development

See `CLAUDE.md` for architecture, rule interpretations, the test matrix, the art pipeline and the roadmap.
