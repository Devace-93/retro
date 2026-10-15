# retro — User feedback — Project Plan

> Status: Phase 1 (MVP) in progress. Last updated: 2026-10-15.

Owner: Enrique Magallon Alvarez. License: **MIT** (open-source core, self-hostable).

retro collects user feedback (bug reports, praise/complaints, feature requests)
from any app through a drop-in widget, a public ingest API or plain curl, and
gives each project an inbox, a public roadmap and a changelog.

## 1. Locked decisions

| Topic | Decision |
|---|---|
| Stack | Same as exp/3m4: Flask API + PostgreSQL + Redis, Qwik City frontend (Bun), MCP server (TS), Caddy, Docker |
| Domain | `retro.3m4.net`, single host: web + `/api` + `/mcp` + `/widget.js` |
| Brand | Tailwind **emerald** |
| Auth | Roll-your-own JWT + refresh tokens; management API keys `retro_live_…` with roles; per-project **public keys** `retro_pub_…` for the ingest API and the widget |
| Tenancy | Account is the billing unit; users join via memberships |
| Model | account → projects → feedback items (+ notes, one screenshot) · roadmap items · changelog entries |
| Feedback types | `bug`, `feedback` (with sentiment positive/negative/neutral), `feature` |
| Statuses | `new` → `triaged` → `planned` → `in_progress` → `done` \| `declined` |
| Integration surfaces | (1) `POST /api/ingest/feedback` with the public key (CORS `*`), (2) `/widget.js` web component `<retro-widget>`, (3) public board `/b/<slug>` (roadmap + changelog + submit idea + vote), (4) management API + MCP server for triage |
| Screenshots | Captured in the widget (screen capture on desktop, file/paste fallback), downscaled client-side, stored in Postgres (bytea), 1 per item, ≤ 1.5 MB |
| Privacy | Never store raw IPs: sha256(ip + daily salt) only, used for rate limits and vote de-duplication |
| Limits | Hard: projects, API keys (402). Soft: submissions/month (never drop a user's feedback). Attachment storage per account is capped: past it feedback is saved without the screenshot |
| Early access | Feature `early-access` ON ⇒ enterprise limits for everyone, billing hidden |
| Own feature switches | Called **features**; PostHog keys prefixed `retro-` (one PostHog project shared with 3m4/exp) |
| i18n / theme | Same 34 locales and `3m4.lang` / `3m4.theme` storage keys as the other apps; the widget bundles its own strings for the same locales |
| Production | Third compose project on the 3m4 Hetzner box; routed by the 3m4 edge Caddy over the `edge` network |
| MCP npm name | `retro-feedback-mcp` (`retro-mcp` is taken) |

## 2. Phases

- **Phase 1 — MVP (now):** auth, projects + public keys, ingest API, feedback
  inbox (filters, status, priority, tags, notes, screenshot), roadmap +
  changelog with a public board (votes), widget (`/widget.js`, screenshot
  capture), API keys + RBAC + audit, MCP server, dashboard, marketing pages,
  i18n, theme, e2e suite, deploy.
- **Phase 2:** email notifications (new feedback digest), reply to reporter,
  Cloudflare Turnstile option, webhooks on new feedback / status change, export
  (`retro.project.v1`), saved views, duplicate detection.
- **Phase 3:** billing on (RevenueCat), team members and invitations,
  dogfooding (retro's own widget on every 3m4 app, including retro).

## 3. Open questions

- npm publish of `retro-feedback-mcp`.
- Whether `info.3m4.net` lists retro as `building` or `live` at first deploy.
