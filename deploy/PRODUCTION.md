# Production runbook

retro runs on the same Hetzner box as the 3m4 shortener (`/opt/3m4`). That stack's
Caddy owns ports 80/443, so retro is deployed as a second docker compose project
without its own Caddy, and the 3m4 Caddy routes `retro.3m4.net` to it.

## First-time setup

1. **Shared network** (once per server):
   ```sh
   docker network create edge
   ```
2. **Clone + configure**
   ```sh
   git clone git@github.com:Devace-93/retro.git /opt/retro
   cd /opt/retro && cp .env.example .env && $EDITOR .env
   ```
   Prod `.env` checklist: `APP_BASE_URL=https://retro.3m4.net`,
   `DASHBOARD_URL=https://retro.3m4.net`, `VITE_API_URL=/api`,
   `VITE_APP_URL=https://retro.3m4.net`, fresh `JWT_SECRET_KEY`, PostHog keys
   (`POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `VITE_POSTHOG_KEY`; flags are
   prefixed `retro-` in the shared PostHog project), RevenueCat keys when billing
   is switched on, a fresh Postgres password (also in `DATABASE_URL`).
3. **Start**
   ```sh
   cd /opt/retro/deploy
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
4. **Edge routing** — in `/opt/3m4`:
   - `deploy/docker-compose.prod.yml`: attach the `caddy` service to the external
     `edge` network.
   - `deploy/Caddyfile.prod`: add
     ```
     retro.3m4.net {
     	handle /api/* { reverse_proxy retro-api-1:5000 }
     	handle /mcp*  { reverse_proxy retro-feedback-mcp-1:3333 }
     	handle        { reverse_proxy retro-web-1:3000 }
     }
     ```
   - `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate caddy`
5. **DNS (Bluehost)**: A record `retro.3m4.net` → server IP. Caddy issues TLS
   automatically once DNS resolves.
6. **Backups**: add `/opt/retro/deploy/backup.sh` to the same crontab as 3m4.
7. **Deploy-on-push**: in the GitHub repo set secrets `DEPLOY_HOST` and
   `DEPLOY_SSH_KEY`, and repo variable `DEPLOY_ENABLED=true`. After that every
   push to master redeploys via `.github/workflows/deploy.yml`.

## Scaling

Same path as 3m4: bigger box → managed Postgres (`DATABASE_URL`) → a second
app node. The evaluation endpoints are stateless and cache-friendly; put a
short-TTL cache in front of `/api/eval/*` before anything else.
