# retro

**Open-source user feedback for your apps, your users and your AI agents.**
Register a project per app, drop one script tag (or one HTTP call) into it, and
every bug report, complaint, compliment and feature request lands in one inbox.
Publish what you plan to build and what you shipped on a public roadmap and
changelog that users can vote on. Triage it all yourself, or let an agent do it
through a role-scoped API and an MCP server. MIT.

> Built by Enrique Magallon Alvarez. Hosted edition runs at `retro.3m4.net`
> (free during early access); the core is free to self-host.

---

## Why retro

- **One widget, any stack.** A zero-dependency web component (`/widget.js`)
  that works in Qwik, Astro, React, jQuery or a Phaser canvas page. Picks up
  the host's language and theme, captures screenshots, never throws into the
  host page.
- **Or no widget at all.** The ingest API takes a public project key and plain
  JSON or form bodies, so `curl`, `fetch` or an HTML `<form>` is enough.
- **Inbox → roadmap → changelog.** Promote a request to the roadmap in one
  click, mark it done, write the changelog entry; linked feedback follows along
  and users see where their idea went on the public board.
- **Agents are users too.** API keys carry a role (viewer / editor / admin),
  every mutation is audited, destructive tools ask for confirmation.
- **Never lose feedback.** The monthly submission limit is soft: the ingest API
  keeps accepting past it. Only creating new projects is blocked.
- **Privacy by default.** Raw IPs are never stored (daily-salted hashes only,
  for rate limits and vote de-duplication).
- **Self-host friendly.** Plain Docker, Postgres as the source of truth
  (screenshots included), no billing provider required.

## Architecture

```
Caddy (reverse proxy)
 ├─ web   Qwik City (Bun)  landing + /info + /blog + dashboard + public boards (/b/<slug>) + /widget.js
 ├─ api   Flask            session check (accounts.3m4.net), projects, ingest, feedback, roadmap, changelog, boards, keys, audit, billing webhooks
 └─ mcp   Node (MCP)       AI-agent access: tools over the API, RBAC, confirmations, audit
      Postgres (source of truth, screenshots as bytea) · Redis (rate limits)
```

```
dbcore/               shared Python core (models, plans, rbac, audit, usage)
services/api/         Flask REST API
apps/web/             Qwik City frontend (Bun): marketing, dashboard, public boards, serves the widget
packages/widget/      the embeddable widget (TypeScript, zero deps) → apps/web/public/widget.js
packages/mcp-server/  MCP server (npm: retro-feedback-mcp) — stdio + Streamable HTTP
packages/shared/      plan_limits.json, api_key_roles.json, feature_flags.json (single source of truth)
deploy/               docker-compose, Caddyfile, production runbook
db/                   Alembic migrations
e2e/                  Playwright end-to-end suite
```

The interface contract is [`CONTRACT.md`](CONTRACT.md); the plan is
[`PROJECT_PLAN.md`](PROJECT_PLAN.md).

## Quick start (Docker)

```bash
cp .env.example .env        # then edit secrets (IP_HASH_SECRET, ...) and point ACCOUNTS_URL at an accounts stack
make up                     # build + start everything; creates the schema
# open http://localhost:8082
```

### Self-host (no billing)

```bash
make up-selfhost            # BILLING_ENABLED=false; paywalls hidden, limits unlimited
```

## Collecting feedback from your app

Create a project in the dashboard and copy its public key (`retro_pub_…`). The
key is public by design: it can only *send* feedback, never read anything.

### 1. The widget (one tag)

```html
<script src="https://retro.3m4.net/widget.js" data-project-key="retro_pub_…" defer></script>
```

A floating button opens a panel with the enabled types (🐞 bug, 💬 feedback
with 👍/👎, 💡 feature), a message, an optional email and a screenshot
(screen capture on desktop, file / paste everywhere). Attributes: `position`,
`lang`, `theme`, `accent`, `hide-launcher`. Headless control:

```js
retro.identify({ id: "user-42", email: "a@b.c" });
retro.setMeta({ plan: "pro", build: "1.4.0" });
retro.open({ type: "bug" });
retro.on("submitted", ({ number }) => console.log(`thanks, #${number}`));
```

Or as an explicit element in any framework:

```html
<script src="https://retro.3m4.net/widget.js" defer></script>
<retro-widget project-key="retro_pub_…" position="bottom-left" theme="auto"></retro-widget>
```

### 2. The ingest API (curl, fetch, forms)

```bash
curl -X POST https://retro.3m4.net/api/ingest/feedback \
  -H "X-Project-Key: retro_pub_…" -H "Content-Type: application/json" \
  -d '{"type":"bug","message":"Export button does nothing","email":"a@b.c","page_url":"https://app.example/editor","app_version":"1.4.0"}'
# {"id":"…","number":123,"status":"new","board_url":"https://retro.3m4.net/b/my-app","screenshot_dropped":false}
```

Fields: `type` (bug | feedback | feature), `message`, optional `title`,
`sentiment` (positive | negative | neutral), `email`, `reporter_id`,
`page_url`, `app_version`, `locale`, `metadata` (JSON ≤ 8 KB) and
`screenshot` (data URL ≤ 1.5 MB). `application/x-www-form-urlencoded` works
too, so a plain `<form method="post">` can post straight to it.

### 3. The public board

Enable the board in project settings and share
`https://retro.3m4.net/b/<slug>`: roadmap (planned / in progress / done) with
votes, the changelog, and a form to submit ideas.

## Beyond the inbox

### Webhooks

Each project can register up to a few HTTPS endpoints (plan limit
`webhooks_per_project`). Events: `feedback.created`,
`feedback.status_changed`, `roadmap.status_changed`, `changelog.published`
and `ping` (from the **Test** button). Deliveries are retried with backoff and
listed per webhook in the dashboard and at
`GET /api/projects/:id/webhooks/:wid/deliveries`.

```json
{
  "id": "delivery uuid",
  "event": "feedback.created",
  "created_at": "2026-10-15T10:00:00Z",
  "project": { "id": "…", "key": "my-app", "name": "My app" },
  "data": { "number": 123, "type": "bug", "status": "new", "title": "…", "previous_status": null }
}
```

Headers: `X-Retro-Event`, `X-Retro-Delivery`, `User-Agent: retro-webhooks/1`
and `X-Retro-Signature: sha256=<hex HMAC-SHA256 of the raw body>` with the
secret shown once when the webhook is created. Verify before trusting:

```js
// Node (Express with `express.raw({ type: "application/json" })`)
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyRetro(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signatureHeader ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

```python
# Python
import hmac, hashlib
def verify_retro(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
```

Answer 2xx quickly; anything else is retried (up to 8 attempts over ~2 h).

### Export

`GET /api/projects/:id/export` returns the whole project as
`retro.project.v1` JSON (feedback with notes, roadmap, changelog; screenshots
are not included), and `?format=csv` downloads the feedback items as a CSV
with the columns `number,type,sentiment,status,priority,tags,title,message,reporter_email,page_url,app_version,source,created_at`.
Both are behind **Export JSON** / **Export CSV** in project settings.

### Saved views

Inbox filters (type, status, sentiment, priority, tag, screenshot, search,
sort) can be saved as named views per project (up to 20). **New**, **Bugs**,
**Features**, **Positive** and **Negative** are always there without being
stored. API: `GET|POST /api/projects/:id/views`, `PATCH|DELETE …/views/:vid`.

### Duplicate detection

Every new item is compared (Postgres `pg_trgm`) with the project's items of
the last 90 days of the same type; matches with similarity ≥ 0.45 appear as
**Possible duplicates** in the inbox drawer and as `similar` on the item.
**Merge into #n** declines the duplicate, sets `duplicate_of`, copies its tags
onto the target, adds a `Merged #n` note there and keeps the reporter as a
watcher of the target. `?duplicates=hide` filters merged items out of the
inbox.

### Spam protection (Cloudflare Turnstile)

Optional, per project: set a Turnstile **site key** and **secret** in project
settings. The widget and the public board then render an invisible challenge
and send `turnstile_token`; the API verifies it with Cloudflare and answers
`400 captcha_failed` when it is missing or invalid. If Cloudflare is
unreachable the item is still stored and tagged `unverified` (feedback is
never lost). Clear both keys to switch it off. The secret is write-only.

### Notifications and replies

The account owner gets an email per project with the new items, batched every
`email_digest_minutes` (0 = one mail per item, 15, 60 (default) or 1440);
switch it off or change the cadence at **Settings → Notifications**
(`GET|PATCH /api/account/notifications`). **Reply** on an item with a
reporter email sends your answer by mail (`POST …/feedback/:item/reply`) and
keeps it as a note of kind `reply`.

Mail is off until you configure it:

```ini
MAIL_ENABLED=true
SMTP_URL=smtp://user:pass@smtp.example.com:587?starttls=1   # or smtps://…:465
MAIL_FROM=retro <no-reply@example.com>
```

With `MAIL_ENABLED=false` (the default, and the local stack) replies answer
`503 mail_disabled` and digests are logged and skipped. Delivery runs in the
`worker` service (outbox table, `SELECT … FOR UPDATE SKIP LOCKED`, retries),
which also delivers webhooks: `make worker-logs` tails it.

## AI agents (MCP)

```bash
# local, from npm
claude mcp add retro --scope user --env RETRO_API_KEY=retro_live_… -- npx -y retro-feedback-mcp
# remote, nothing to install
claude mcp add --transport http retro https://retro.3m4.net/mcp --header "Authorization: Bearer retro_live_…"
```

Claude Desktop / Cursor (JSON config):

```json
{ "mcpServers": { "retro": { "command": "npx", "args": ["-y", "retro-feedback-mcp"], "env": { "RETRO_API_KEY": "retro_live_…" } } } }
```

Then: *"triage the new feedback in Kinegram"*, *"promote #42 to the roadmap"*,
*"write and publish a changelog entry for dark mode"*. See
[`packages/mcp-server`](packages/mcp-server/) for the tool/role table.

## Screenshots

_Coming with the first release: inbox, roadmap board, widget panel._

## Common tasks

| Command | Does |
|---|---|
| `make up` / `make down` | start / stop the full stack |
| `make up-selfhost` | start without billing |
| `make logs` | tail all logs |
| `make worker-logs` | tail the outbox worker (mail + webhook deliveries) |
| `make migrate` | create tables + apply Alembic migrations |
| `make widget` | rebuild the widget bundle into `apps/web/public` |
| `make smoke` | curl health, widget headers and an ingest round-trip |
| `make e2e` | run the Playwright suite against the running stack |

## Languages and theme

Same language picker (34 country locales) and light/dark theme as the other
3m4 apps; the choice is shared across them through `localStorage`. The widget
ships the same locales and follows the host page.

## License

MIT — see [`LICENSE`](LICENSE).
