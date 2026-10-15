# retro — API service (Flask)

JSON REST API for retro, the user-feedback service. Auth, projects (one per
host app) with their public keys, the feedback inbox, roadmap and changelog,
the public ingest API (widget / curl), the public boards, account usage, API
keys, and (optionally) RevenueCat billing. Mounted at `/api` behind Caddy.
The spec is the repo-root `CONTRACT.md`.

## Layout

```
services/api/
├── api/
│   ├── app.py              # create_app() factory + error handlers + health
│   ├── extensions.py       # Flask-Limiter (Redis-backed); per-key, per-project and per-IP buckets
│   ├── auth_utils.py       # passwords, JWT, @require_auth / @require_api_key / @require_project_key, @require_scope
│   ├── features.py         # retro's own switches: @require_feature + GET /api/features
│   ├── serializers.py      # ORM -> JSON (CONTRACT.md shapes)
│   ├── errors.py           # ApiError -> {"error": {...}}
│   └── blueprints/         # auth, projects, feedback, roadmap, changelog, ingest, boards, account, apikeys, billing
├── scripts/smoke.sh        # curl walk through the contract against a running stack
├── requirements.txt
└── Dockerfile
```

Shared logic (config, models, plans, RBAC, key/slug validation, feedback
validation and numbering, screenshot decoding, IP hashing, usage, audit, PostHog) lives in the repo-root `dbcore/` package and
is imported, never re-implemented.

## Auth

- **Dashboard:** `Authorization: Bearer <JWT>` (HS256, TTL `ACCESS_TOKEN_TTL_MIN`).
  Refresh tokens are opaque and stored **hashed** (sha256). Passwords: argon2.
- **Management API:** `X-API-Key: retro_live_...` (or as a bearer token); the
  key's role decides its scopes (`packages/shared/api_key_roles.json`).
- **Ingest API:** `X-Project-Key: retro_pub_...` (or bearer token, or the
  `project_key` body/query field). Identifies one project; no role, ingest
  routes only. Public by design (it ships in the widget snippet).
- **Boards:** no key; addressed by the project's `board_slug`.

## Endpoints (all under `/api`)

- `auth`: `register`, `login`, `refresh`, `logout`, `me`
- `projects`: list/create/get/patch/delete, `:id/rotate-key`, `:id/summary`, `:id/tags`
- `projects/:id/feedback`: list/get/patch/delete, `:item/notes`, `:item/promote`, `:item/screenshot`
- `projects/:id/roadmap`: list/create/patch/delete, `reorder`
- `projects/:id/changelog`: list/create/patch/delete
- `ingest/config`, `ingest/feedback` (metered, project public key, CORS `*`)
- `boards/:slug`, `boards/:slug/changelog`, `boards/:slug/items/:rid/vote`, `boards/:slug/feedback` (public, CORS `*`)
- `account/usage`, `account/audit`
- `apikeys`: list/create/delete, `roles`, `me`
- `features`
- `billing` (only if `BILLING_ENABLED=true`): `offerings`, `webhook`
- `healthz` (also at the bare path for container health checks)

## Run

```bash
# From the repo root, via docker compose (recommended):
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build postgres redis migrate api

# Locally (needs Postgres + Redis reachable, deps installed):
pip install -r services/api/requirements.txt
gunicorn -b 0.0.0.0:5000 -w 2 'api.app:create_app()'
```

Configuration is entirely env-driven (`dbcore.config`); see the repo `.env.example`.

## Limits

- Hard (402 `limit_reached`, `which`): projects, roadmap items per project,
  active API keys.
- Soft: feedback submissions per month. The ingest API never blocks; the
  overage is reported by `GET /account/usage` and one PostHog event fires per
  period.
- Storage: `attachment_storage_mb` per account. Past it, feedback is stored
  without its screenshot (`screenshot_dropped: true`).

## Privacy

Raw IPs are never stored. `dbcore.privacy.ip_hash` keeps a daily-salted
sha256 (`IP_HASH_SECRET`) used only for ingest rate limits and vote
de-duplication.
