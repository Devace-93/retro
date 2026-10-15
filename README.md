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
 ├─ api   Flask            auth, projects, ingest, feedback, roadmap, changelog, boards, keys, audit, billing webhooks
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
cp .env.example .env        # then edit secrets (JWT_SECRET_KEY, IP_HASH_SECRET, ...)
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
