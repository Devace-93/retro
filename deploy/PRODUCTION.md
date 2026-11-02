# Production runbook

retro runs on the same Hetzner box as the 3m4 shortener (`/opt/3m4`) and exp
(`/opt/exp`). The 3m4 stack's Caddy owns ports 80/443, so retro is deployed as a
third docker compose project without its own Caddy, and the 3m4 Caddy routes
`retro.3m4.net` to it over the shared `edge` docker network.

**Already deployed before the accounts migration?** Append these to `.env` and rebuild
(the public accounts URL is baked into the web bundle at build time):

```
ACCOUNTS_URL=https://accounts.3m4.net
ACCOUNTS_INTERNAL_URL=http://accounts-api-1:5000
VITE_ACCOUNTS_URL=https://accounts.3m4.net
PROTOCOL_HEADER=x-forwarded-proto
```
then `docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build web api`
from `deploy/`. Without `ACCOUNTS_URL` the API rejects every session (issuer mismatch);
without `PROTOCOL_HEADER` the login redirect carries an `http://` return address that
accounts refuses, so users land on their profile instead of the dashboard.

## First-time setup

1. **Shared network** (once per server; already there if exp is deployed):
   ```sh
   docker network inspect edge >/dev/null 2>&1 || docker network create edge
   ```
2. **Clone + configure**
   ```sh
   git clone git@github.com:Devace-93/retro.git /opt/retro
   cd /opt/retro && cp .env.example .env && $EDITOR .env
   ```
   Prod `.env` checklist: `APP_BASE_URL=https://retro.3m4.net`,
   `DASHBOARD_URL=https://retro.3m4.net`, `VITE_API_URL=/api`,
   `VITE_APP_URL=https://retro.3m4.net`, fresh `JWT_SECRET_KEY` and
   `IP_HASH_SECRET`, PostHog keys (`POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`,
   `VITE_POSTHOG_KEY`; flags are prefixed `retro-` in the shared PostHog
   project), the payments portal set (see **Billing** below), a fresh Postgres
   password: set `POSTGRES_PASSWORD` (read by the postgres service through
   `--env-file ../.env`) and use the same value in `DATABASE_URL`. Mail: `MAIL_ENABLED=true`, `SMTP_URL`
   (`smtp://user:pass@host:587?starttls=1` or `smtps://…:465`) and `MAIL_FROM`
   (`retro <no-reply@3m4.net>`; the sending domain needs SPF/DKIM for the
   provider you pick). Leave `MAIL_ENABLED=false` to run without mail: replies
   answer 503 and digests are logged, nothing else changes.
3. **Start**
   ```sh
   cd /opt/retro/deploy
   docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   Container names are stable (`retro-api-1`, `retro-web-1`, `retro-mcp-1`,
   `retro-worker-1`): compose project `retro`, one replica each. The edge
   Caddy routes by name. The `worker` service (same image as `api`, command
   `python -m dbcore.worker`) delivers the outbox: email digests, replies and
   webhooks. It has no port; it only needs the database and outbound network.
   One replica is enough (jobs are claimed with `FOR UPDATE SKIP LOCKED`, so a
   second replica is safe if ever needed).
4. **Edge routing** — in `/opt/3m4` (branch `deploy/retro-edge-routing` in the
   3m4 repo adds this):
   - `deploy/docker-compose.prod.yml`: the `caddy` service is already attached
     to the external `edge` network (done for exp).
   - `deploy/Caddyfile.prod`: the block
     ```
     retro.3m4.net {
     	handle /api/* { reverse_proxy retro-api-1:5000 }
     	handle /mcp*  { reverse_proxy retro-mcp-1:3333 }
     	@widget path /widget.js /widget/*
     	handle @widget {
     		header Cache-Control "public, max-age=300"
     		header Access-Control-Allow-Origin "*"
     		reverse_proxy retro-web-1:3000
     	}
     	handle        { reverse_proxy retro-web-1:3000 }
     }
     ```
   - `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate caddy`
5. **DNS (Bluehost)**: A record `retro` → the server IP (`46.225.62.18`), same as
   `exp`. Caddy issues the TLS certificate automatically once DNS resolves.
6. **Backups**: add `/opt/retro/deploy/backup.sh` to the same crontab as 3m4
   (nightly, keeps 14 days under `/opt/backups/retro`). Screenshots live in
   Postgres (bytea), so the dump covers them.
7. **Deploy-on-push**: in the GitHub repo set secrets `DEPLOY_HOST` and
   `DEPLOY_SSH_KEY`, and repo variable `DEPLOY_ENABLED=true`. After that every
   push to `main` redeploys via `.github/workflows/deploy.yml`.

## Billing (payments.3m4.net)

Retro never calls Stripe. The portal at `/opt/payments` owns checkout, the
Customer Portal, receipts and donations; retro only sends users there,
receives its signed push webhooks and pulls entitlements with a service key.
Both stacks talk over the shared `edge` network by container name
(`payments-api-1`, `retro-api-1`), so nothing is exposed publicly.

1. **App key on the payments box** (once; prints the two secrets a single
   time — rotate by running it again):
   ```sh
   cd /opt/payments && make app-key SLUG=retro WEBHOOK_URL=http://retro-api-1:5000/api/billing/webhook
   ```
2. **retro `.env`**:
   ```
   BILLING_ENABLED=true
   PAYMENTS_URL=https://payments.3m4.net
   PAYMENTS_INTERNAL_URL=http://payments-api-1:5000
   PAYMENTS_SERVICE_KEY=m4pay_sk_…          # from step 1
   PAYMENTS_WEBHOOK_SECRET=whsec_m4pay_…    # from step 1
   VITE_PAYMENTS_URL=https://payments.3m4.net
   ```
   then rebuild `api`, `worker` and `web` (the public URL is baked into the
   web bundle): `docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build api worker web`.
   `api`, `worker` and `web` are on `edge` already (base compose).
3. **Catalog**: the products live in payments' `packages/shared/catalog.json`
   (app `retro`: `pro_monthly`, `pro_annual`, entitlement `pro`) and in
   retro's `packages/shared/plan_limits.json` → `price_keys`. Keep both in
   sync; `team` has no product yet, so its Upgrade button is disabled.
4. **Verify** (same commands locally with `http://localhost:8082` and the
   `.env` secrets; `early-access` must be OFF for the billing page to show,
   the webhook works regardless):
   ```sh
   # push: a signed subscription.updated for an identity that has signed in to retro
   SECRET=$(grep ^PAYMENTS_WEBHOOK_SECRET .env | cut -d= -f2-)
   IDENTITY=<accounts sub of a user who has opened the dashboard>
   BODY='{"id":"'$(uuidgen)'","type":"subscription.updated","created":"2026-11-01T00:00:00Z","app":"retro","identity_id":"'$IDENTITY'","email":"x@example.com","data":{"entitlements":["pro"],"subscription":{"id":"sub_test","entitlement":"pro","status":"active","current_period_end":"2027-01-01T00:00:00Z","cancel_at_period_end":false,"label":"Pro"},"payment":null,"updated_at":"2026-11-01T00:00:00Z"}}'
   TS=$(date +%s); SIG=v1=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
   curl -s -X POST https://retro.3m4.net/api/billing/webhook -H "Content-Type: application/json" \
     -H "X-M4Pay-Timestamp: $TS" -H "X-M4Pay-Signature: $SIG" -d "$BODY"      # → {"plan":"pro","status":"ok"}
   docker exec retro-postgres-1 psql -U retro -d retro -c "select plan from accounts"   # → pro
   # pull: one reconcile run (lists the app's subscriptions changed in the last 2 days)
   make reconcile-billing                                                               # → reconciled: {'applied': n, ...}
   ```
   The same signed POST with `"entitlements":[],"subscription":null` sets the
   plan back to `free`. Real purchases: `early-access` OFF → `/dashboard/billing`
   → Upgrade opens `https://payments.3m4.net/subscribe?app=retro&price=pro_monthly`.

## Turnstile (per project, no server config)

Cloudflare Turnstile is configured by each project owner in the dashboard
(site key + secret). The API only needs outbound HTTPS to
`challenges.cloudflare.com` (`TURNSTILE_VERIFY_URL`, default set). Nothing to
provision on the server; the widget loads Cloudflare's script from the
visitor's browser.

## Smoke test after a deploy

```sh
curl -fsS https://retro.3m4.net/api/healthz
curl -fsSI https://retro.3m4.net/widget.js | grep -i "access-control-allow-origin"
curl -fsS -X POST https://retro.3m4.net/api/ingest/feedback \
  -H "X-Project-Key: retro_pub_…" -H "Content-Type: application/json" \
  -d '{"type":"feedback","sentiment":"positive","message":"smoke test"}'
docker logs --tail 20 retro-worker-1          # outbox worker alive, no tracebacks
```

Or run the whole scripted walk (health, widget headers, ingest, export, saved
views, cleanup): `BASE_URL=https://retro.3m4.net sh deploy/smoke.sh`.

## Scaling

Same path as 3m4: bigger box → managed Postgres (`DATABASE_URL`) → a second
app node. The ingest endpoints are stateless; rate limits live in Redis. If
screenshot storage grows past what Postgres should hold, move attachments to
object storage behind the same `/screenshot` route.
