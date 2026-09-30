# 逐梦东方圈 · Touhou Chasing Dream (Online)

An online multiplayer version of the hidden-role card game **逐梦东方圈**: 3–8 players, AI seats, room codes, reconnect, chat,
and an original illustration for every card.

## Play locally

Requires Node.js 20+.

```bash
npm install
npm run dev            # http://localhost:5173
```

Create a room, share the 4-letter code (or the `/r/CODE` link), add AI players if you are short, and press 开始游戏.

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

## Tips for the table

* Hover any card, or any 「卡名」 in the log, for its full text.
* Reactions (挂裱, 墨菲定律, role skills) are offered automatically when they become legal.
* If you disconnect, reopen the site in the same browser to reclaim your seat.
* The host can set the decision time limit, the number of role choices, and the AI speed in the lobby.

## Development

See `CLAUDE.md` for architecture, rule interpretations, the art pipeline and the roadmap.
