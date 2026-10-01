# Deploying 逐梦东方圈 on your own VPS

This guide takes a fresh Linux VPS (Ubuntu 22.04/24.04 or Debian 12) to a running game that your friends can open in a browser.
Two routes are described. **Route A (Docker + Caddy)** is recommended: automatic HTTPS, one command to update.
**Route B (Node + systemd)** is for people who prefer no Docker.

> The game keeps all rooms and running games **in memory**. Restarting the server ends running games, so update when nobody is playing.

## What you need

| Item | Notes |
|---|---|
| A VPS | 1 vCPU / 1 GB RAM is plenty for a handful of rooms. Docker builds are happier with 2 GB (or add swap). |
| A domain (optional but recommended) | Needed for HTTPS. Without one you can still play over plain HTTP via the server's IP. |
| Ports 80 and 443 open | In the provider's firewall/security group **and** in `ufw` if you use it. |

Browsers only allow some features (clipboard, secure WebSocket upgrades through some proxies) over HTTPS, so use a domain if you can.

---

## 0. Prepare the server

```bash
# connect
ssh root@YOUR_VPS_IP

# update, create a normal user, firewall
apt update && apt upgrade -y
adduser deploy && usermod -aG sudo deploy
apt install -y ufw git curl
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# continue as that user
su - deploy
```

### Point your domain at the VPS

At your DNS provider create an **A record**: `game.example.com → YOUR_VPS_IP` (and an `AAAA` record if you use IPv6).
Check it has propagated before starting Caddy, otherwise certificate issuance fails:

```bash
dig +short game.example.com      # should print your VPS IP
```

---

## Route A — Docker + Caddy (recommended)

### A1. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker --version && docker compose version
```

### A2. Get the code

```bash
git clone https://github.com/YOUR_NAME/YOUR_REPO.git touhou
cd touhou
```

### A3. Build and start

With a domain (Caddy fetches and renews a Let's Encrypt certificate by itself):

```bash
DOMAIN=game.example.com docker compose -f deploy/docker-compose.yml up -d --build
```

Without a domain (plain HTTP on port 80):

```bash
DOMAIN=:80 docker compose -f deploy/docker-compose.yml up -d --build
```

The first build takes a few minutes (it installs dependencies, builds the client and bundles the server).
Then open `https://game.example.com` (or `http://YOUR_VPS_IP`).

To avoid typing `DOMAIN=` each time, create `deploy/.env`:

```bash
echo "DOMAIN=game.example.com" > deploy/.env
docker compose -f deploy/docker-compose.yml up -d --build
```

### A4. Check that it works

```bash
docker compose -f deploy/docker-compose.yml ps            # app and caddy should be "running"
docker compose -f deploy/docker-compose.yml logs -f app   # "逐梦东方圈 server listening on …"
curl -s https://game.example.com/healthz                  # {"ok":true}
```

### A5. Update to a new version

```bash
cd ~/touhou
git pull
docker compose -f deploy/docker-compose.yml up -d --build
docker image prune -f        # optional: remove old images
```

### A6. Everyday commands

```bash
docker compose -f deploy/docker-compose.yml logs --tail 100 app   # recent server log
docker compose -f deploy/docker-compose.yml restart app           # restart (ends running games)
docker compose -f deploy/docker-compose.yml down                  # stop everything
```

Containers have `restart: unless-stopped`, so they come back after a VPS reboot.

---

## Route B — Node.js + systemd (no Docker)

### B1. Install Node.js 20 or newer

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # v22.x
```

### B2. Get the code and build

```bash
sudo mkdir -p /opt/touhou-chasing-dream && sudo chown $USER: /opt/touhou-chasing-dream
git clone https://github.com/YOUR_NAME/YOUR_REPO.git /opt/touhou-chasing-dream
cd /opt/touhou-chasing-dream
npm ci
npm run build
```

`npm run build` produces `packages/client/dist` (the web app, with pre-compressed `.br`/`.gz` files) and `packages/server/dist/index.js`.

Quick test: `PORT=3000 npm start`, then `curl localhost:3000/healthz`. Stop it with Ctrl+C.

### B3. Run it as a service

The unit file in the repo runs the server as `www-data` from `/opt/touhou-chasing-dream` on port 3000:

```bash
sudo chown -R www-data: /opt/touhou-chasing-dream     # or edit User= in the unit to your own user
sudo cp deploy/touhou-chasing-dream.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now touhou-chasing-dream
systemctl status touhou-chasing-dream
journalctl -u touhou-chasing-dream -f                  # live log
```

### B4. Put a reverse proxy in front (HTTPS)

**Caddy** (simplest):

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
game.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

**nginx** (if you already use it) — the WebSocket upgrade headers are essential:

```nginx
server {
    server_name game.example.com;
    listen 80;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

Then get a certificate with `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d game.example.com`.

### B5. Update

```bash
cd /opt/touhou-chasing-dream
git pull
npm ci && npm run build
sudo systemctl restart touhou-chasing-dream
```

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the Node server listens on. |
| `NODE_ENV` | `production` in the image/unit | In production CORS is closed (same-origin only). |
| `CLIENT_DIST` | `../../client/dist` next to the server bundle | Where the built web app is served from. |

Game options (rounds, starting hand, time limit, AI speed, effect pace …) are set per room by the host in the lobby — no server configuration needed.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Page loads but "正在连接服务器…" never ends | The proxy does not forward WebSockets. With nginx add the `Upgrade`/`Connection` headers shown above. With Cloudflare, enable WebSockets and keep the proxy on port 443/80. |
| Caddy cannot get a certificate | DNS A record not pointing at the VPS yet, or ports 80/443 blocked. Check `docker compose … logs caddy`. |
| `docker compose build` is killed / runs out of memory | Add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |
| Port 80/443 already in use | Another web server is running (`sudo ss -ltnp | grep ':80'`). Stop it or use Route B behind it. |
| Players are disconnected after an update | Expected: state is in memory. They reconnect automatically to the lobby; running games are lost. |
| Very slow first load for far-away players | Put a CDN (e.g. Cloudflare) in front. Static files are already pre-compressed and cached for a year (`/assets`, `/fonts`, `/art`), so a CDN works out of the box. |

## Security notes

- Only ports 22, 80 and 443 should be open. Do not expose port 3000 publicly (Route A already keeps it internal).
- Use SSH keys and disable password login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- There are no accounts or databases: players are identified by a random token stored in their browser. Room codes are 4 characters, so treat the game as "friends only" and share codes privately.
- Keep the VPS patched: `sudo apt update && sudo apt upgrade`.

## Playing

Share the site address (or a room link such as `https://game.example.com/r/ABCD`). One player creates a room, others join with the 4-letter code, the host adds AI players if needed and presses **开始游戏**. A guided **新手教学局** is on the title screen.
