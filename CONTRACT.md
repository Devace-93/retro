# retro — Interface Contract

This file is the shared contract between the backend (Flask), the Qwik frontend,
the widget and the MCP server. All of them build against it. Keep it in sync.

retro is a user-feedback service: an **account** registers **projects** (one per
app), each project collects **feedback items** (bug reports, feedback with a
sentiment, feature requests) and publishes a **board** (roadmap + changelog).
Apps send feedback through the **ingest API** with a per-project public key,
directly (curl, fetch) or through the drop-in **widget**; end users can also use
the project's public **board** to submit ideas and vote. People and AI agents
manage everything through the **management API** (dashboard sessions,
role-scoped API keys, MCP server).

Vocabulary:

- **feedback item / item** = one submission (row in `feedback_items`).
- **board** = a project's public pages: roadmap items + changelog entries.
- **features** = retro's *own* switches (`packages/shared/feature_flags.json`,
  resolved from PostHog, exposed as `GET /api/features` and `me.features`).

## Ports (container)

| Service  | Port | Notes |
|----------|------|-------|
| api      | 5000 | Flask JSON API, mounted at `/api` by Caddy |
| web      | 3000 | Qwik City (Bun) SSR server: marketing, dashboard, public boards, `/widget.js` |
| mcp      | 3333 | Streamable HTTP MCP server, mounted at `/mcp` by Caddy |
| postgres | 5432 | |
| redis    | 6379 | db0 rate-limit storage + cache |
| caddy    | 8082 | dev entrypoint (prod: routed by the 3m4 edge Caddy, see deploy/PRODUCTION.md) |

Local dev lives on `http://localhost:8082` (8080 is 3m4, 8081 is exp).
Frontend tooling is **Bun**. Compose project name is `retro`.

## Auth

- Dashboard: JWT bearer, `Authorization: Bearer <access_token>`. Access TTL
  ~30 min; refresh token (opaque, stored hashed) ~30 days.
- Management API: API keys, header `X-API-Key: retro_live_…` (maps to an
  account). The MCP server also accepts the key as `Authorization: Bearer`.
- Ingest API: project **public keys**, header `X-Project-Key: retro_pub_…` or
  body field `project_key` (so a plain HTML form / curl can post). A public key
  identifies exactly one project; it has no role, cannot read anything and
  cannot call the management API. It is *public by design* (it ships in the
  widget snippet); abuse is contained by rate limits, size caps and the
  honeypot, and it can be rotated at any time.
- Board API: no key. Boards are addressed by the project's globally unique
  `board_slug`, and only answer while `board_enabled` is true.

Keys are stored as sha256 hashes plus a non-sensitive prefix (`retro_live_AbCd`,
`retro_pub_AbCd`); the full secret is returned exactly once (creation /
rotation). Exception: the public key is also shown in the project settings
(it is not a secret), so `Project.public_key` is always present for the owner.

### Authorization (RBAC)

- Every API key has a **role** (`viewer` | `editor` | `admin`). Roles → scopes
  live in `packages/shared/api_key_roles.json` (shared by API, dashboard, MCP).
- Scopes: `projects:read|write|delete`, `feedback:read|write|delete`,
  `board:read|write|delete`, `usage:read`, `audit:read`. Dashboard JWT
  sessions hold every scope.
- Each endpoint names its scope. Missing scope → **403**
  `{ "error": { "code": "insufficient_scope", "message", "required_scope", "role" } }`
  plus an `auth.denied` audit event.
- Audit: every mutation and every denial is appended to `audit_events` in the
  same transaction. Actions: `project.create|update|delete|rotate_key`,
  `feedback.update|delete|promote|note`, `roadmap.create|update|delete|reorder`,
  `changelog.create|update|delete|publish`, `apikey.create|revoke`,
  `auth.denied`. Ingest and votes are **not** audited (they are end-user
  traffic, metered instead).

## Limits and metering

Plan limits come from `packages/shared/plan_limits.json`. While the
`early-access` feature is ON every account gets the `enterprise` limits.

- **Hard limits** (creation blocked with **402** `limit_reached`, `error.which`
  = `projects` | `api_keys` | `roadmap_items`).
- **Soft limit**: `feedback_per_month`. Each accepted ingest/board submission
  counts +1 on the account's calendar-month counter. Past the limit the API
  keeps accepting (never lose a user's feedback); the dashboard shows the
  overage and one PostHog `limit_reached {which: "feedback"}` event fires per
  period.
- **Storage cap**: `attachment_storage_mb` (sum of attachment bytes per
  account). Past it, submissions are stored **without** the screenshot and the
  ingest response has `screenshot_dropped: true`.

## Privacy

- Raw IPs are never stored. `ip_hash = sha256(ip + ":" + daily_salt)` where
  `daily_salt = sha256(IP_HASH_SECRET + ":" + YYYY-MM-DD)`. Used for ingest
  rate limits and vote de-duplication only.
- `user_agent` is truncated to 255 chars. `metadata` is capped at 8 KB JSON.
- Reporter `email` is optional and only used to show it in the inbox (Phase 2:
  replies). `reporter_id` is an opaque string the host app chooses.

## REST API (all under `/api`)

Responses are JSON. Errors: `{ "error": { "code": "string", "message": "string" } }`.
Rate limits: default `RATE_LIMIT_DEFAULT` per IP; management routes called with
an API key add `RATE_LIMIT_PUBLIC_API` per key; ingest routes add
`RATE_LIMIT_INGEST` per (project, ip_hash); board routes add `RATE_LIMIT_BOARD`
per ip_hash.

CORS: management routes allow the dashboard origin only. **Ingest, board and
widget-config routes allow any origin** (no credentials; the API echoes the
caller's `Origin`) because they are called from third-party apps. Preflight
allows the `Content-Type`, `X-Project-Key` and `X-Retro-Source` headers.

Request bodies are capped at 3 MB (413); that is a 1.5 MB screenshot as base64
plus the rest of the submission. `MAX_SCREENSHOT_BYTES` (default 1500000)
tunes the decoded-image cap.

### Auth

- `POST /auth/register` `{email, password, account_name?}` → `{user, account, access_token, refresh_token}` (201). Gated by feature `signups`.
- `POST /auth/login` `{email, password}` → `{user, account, access_token, refresh_token}`
- `POST /auth/refresh` `{refresh_token}` → `{access_token}`
- `POST /auth/logout` `{refresh_token}` → 204
- `GET  /auth/me` → `{user, account, plan, limits, usage, counts:{projects}, features}`

### Projects

- `GET    /projects?q=` → `{items:[Project], total}` — `projects:read`. Newest first.
- `POST   /projects` `{name, key?, description?, url?}` → Project (201) — `projects:write`.
  `key` defaults to a slug of `name`; must match `^[a-z0-9][a-z0-9-]{0,62}$`
  and be unique per account (409 `key_taken`). Generates the public key and a
  `board_slug` (= `key` when globally free, otherwise `key-xxxx`). The board
  starts **disabled**. 402 `limit_reached` (`which: "projects"`).
- `GET    /projects/:id` → Project — `projects:read`
- `PATCH  /projects/:id` `{name?, description?, url?, board_slug?, board_enabled?, board_title?, board_intro?, allow_votes?, allow_board_submissions?, types_enabled?, allow_screenshots?, allow_email?, widget_accent?}` → Project — `projects:write`.
  `board_slug` must match `^[a-z0-9][a-z0-9-]{1,62}$`, be globally unique
  (409 `slug_taken`) and not reserved (`api`, `b`, `widget`, `dashboard`,
  `login`, `signup`, `info`, `blog`, `sponsors`, `mcp` → 400 `reserved_slug`).
  `types_enabled` is a non-empty subset of `["bug","feedback","feature"]`.
- `DELETE /projects/:id` → 204 — `projects:delete` (cascades items, notes, attachments, roadmap, changelog, votes)
- `POST   /projects/:id/rotate-key` → `{public_key, public_key_prefix}` — `projects:write`. The old key stops working immediately. Audit `project.rotate_key`.
- `GET    /projects/:id/summary` → Summary — `feedback:read`. Counts for the inbox header and the MCP `feedback_summary` tool.

`:id` is the project UUID. Every project endpoint is scoped to `g.account_id`;
a project of another account is a 404, never a 403.

### Feedback (management)

- `GET    /projects/:id/feedback?q=&type=&status=&sentiment=&priority=&tag=&has_screenshot=&since=&page=1&per_page=50&sort=newest|oldest|votes` → `{items:[FeedbackItem], page, per_page, total}` — `feedback:read`.
  `status` and `type` accept comma-separated lists. `q` searches `title`,
  `message`, `reporter_email`, `page_url`. Items in the list omit `notes`.
- `GET    /projects/:id/feedback/:item` → FeedbackItem (with `notes`) — `feedback:read`. `:item` is the UUID **or** the per-project `number`.
- `PATCH  /projects/:id/feedback/:item` `{status?, priority?, tags?, title?, type?, sentiment?, roadmap_item_id?}` → FeedbackItem — `feedback:write`. Audit `feedback.update` with `meta.fields` and, when status changed, `meta.from`/`meta.to`. `roadmap_item_id: null` unlinks.
- `DELETE /projects/:id/feedback/:item` → 204 — `feedback:delete`
- `POST   /projects/:id/feedback/:item/notes` `{body}` → Note (201) — `feedback:write`. Audit `feedback.note`.
- `DELETE /projects/:id/feedback/:item/notes/:noteId` → 204 — `feedback:write`. API keys may delete only their own notes (403 `forbidden`); dashboard sessions (account owners) may delete any.
- `POST   /projects/:id/feedback/:item/promote` `{title?, description?, status?}` → `{item: FeedbackItem, roadmap_item: RoadmapItem}` (201) — `feedback:write` + `board:write`.
  Creates a roadmap item (default `status: planned`, `title` = item title,
  `description` = item message), links the item (`roadmap_item_id`) and sets
  the item's status to `planned` unless it is already `in_progress`/`done`.
  Idempotent: if the item is already linked, returns 200 with the existing
  roadmap item. 402 (`which: "roadmap_items"`). Audit `feedback.promote`.
- `GET    /projects/:id/feedback/:item/screenshot` → the image bytes (`Content-Type` from the attachment, `Cache-Control: private, max-age=3600`) — `feedback:read`. 404 if none. The dashboard loads it with `fetch` + bearer and an object URL (img tags cannot send auth).
- `GET    /projects/:id/tags` → `{tags:[{tag, count}]}` — `feedback:read`.

### Roadmap (management)

- `GET    /projects/:id/roadmap?status=&include_hidden=true` → `{items:[RoadmapItem]}` — `board:read`. Ordered by `status` column order then `position`.
- `POST   /projects/:id/roadmap` `{title, description?, status?, public?}` → RoadmapItem (201) — `board:write`. `status` ∈ `planned` (default) | `in_progress` | `done`. New items go last in their column. 402 (`which: "roadmap_items"`).
- `PATCH  /projects/:id/roadmap/:rid` `{title?, description?, status?, public?}` → RoadmapItem — `board:write`. Moving to `done` sets `completed_at`; linked feedback items move to the same status (`planned`→`planned`, `in_progress`→`in_progress`, `done`→`done`).
- `PUT    /projects/:id/roadmap/reorder` `{status, ids:[uuid]}` → `{items:[RoadmapItem]}` — `board:write`. Rewrites `position` for that column (ids must be exactly that column's items, else 400 `invalid_order`).
- `DELETE /projects/:id/roadmap/:rid` → 204 — `board:delete`. Linked feedback items are unlinked (not deleted).

### Changelog (management)

- `GET    /projects/:id/changelog?include_drafts=true` → `{items:[ChangelogEntry]}` — `board:read`. Newest `published_at` first, drafts first.
- `POST   /projects/:id/changelog` `{title, body, version?, publish?}` → ChangelogEntry (201) — `board:write`. `body` is Markdown (rendered client-side with a safe subset: headings, lists, links, bold, italic, code). `publish: true` sets `published_at = now`.
- `PATCH  /projects/:id/changelog/:cid` `{title?, body?, version?, published?, roadmap_item_ids?}` → ChangelogEntry — `board:write`. `published: true` sets `published_at` (first time only), `false` clears it. Audit `changelog.publish` when it flips.
- `DELETE /projects/:id/changelog/:cid` → 204 — `board:delete`

### Ingest (end users; project public key)

Feature `ingest-api` OFF → 503 `feature_disabled`. Unknown/rotated key → 401
`invalid_project_key`. Rate limited per (project, ip_hash).

- `GET  /ingest/config` → WidgetConfig. Header `X-Project-Key` (or `?project_key=`). Cacheable 60 s. What the widget fetches on boot.
- `POST /ingest/feedback` → `{id, number, status, board_url, screenshot_dropped}` (201).
  Body (JSON; `application/x-www-form-urlencoded` also accepted so a plain
  `<form>` works):

  | field | rules |
  |---|---|
  | `project_key` | required if no header |
  | `type` | required, one of the project's `types_enabled` (400 `invalid_type`) |
  | `message` | required, 1–5000 chars after trim (400 `missing_message` / `too_long`) |
  | `title` | optional ≤ 140; default = first line of `message` truncated to 80 |
  | `sentiment` | `positive` \| `negative` \| `neutral`; only meaningful for `type=feedback`, otherwise ignored |
  | `email` | optional, validated loosely, ≤ 255; ignored when `allow_email` is false |
  | `reporter_id` | optional opaque string ≤ 120 |
  | `page_url` | optional ≤ 2048 |
  | `app_version` | optional ≤ 60 |
  | `locale` | optional ≤ 16 |
  | `metadata` | optional JSON object ≤ 8 KB (400 `metadata_too_large`); form posts may send it as a JSON string |
  | `screenshot` | optional data URL `data:image/(png\|jpeg\|webp);base64,…` ≤ 1.5 MB decoded (400 `screenshot_too_large` / `invalid_screenshot`); ignored when feature `screenshots` is OFF or the project disables screenshots; dropped (not rejected) past the storage cap |
  | `website` | **honeypot**: must be empty. If filled, answer 201 with a fake id and store nothing |

  `user_agent` and `ip_hash` are taken from the request. Each accepted item is
  metered (+1 `feedback`) and fires PostHog `feedback_received {type, sentiment, has_screenshot, source: "api"|"widget"|"board"}` (source from header `X-Retro-Source`, default `api`).
  `board_url` is the project's public board URL or `null` when the board is disabled.

### Boards (public; no key)

Feature `public-boards` OFF or `board_enabled` false → 404 `not_found`.

- `GET  /boards/:slug` → Board: project public info, roadmap items (public only, grouped by status), published changelog entries (latest 10), `can_submit`, `can_vote`.
- `GET  /boards/:slug/changelog?page=&per_page=20` → `{items:[PublicChangelogEntry], page, per_page, total}`
- `POST /boards/:slug/items/:rid/vote` `{voter_id}` → `{votes, voted: true}`. `voter_id` is a UUID the browser generates once and keeps in localStorage (`retro.voter`); the API accepts any 8–64 URL-safe characters (400 `invalid_voter_id`). One vote per (roadmap item, voter_id) and per (roadmap item, ip_hash) per day: a repeat is idempotent (200, `voted: true`). 403 `votes_disabled` when `allow_votes` is false.
- `DELETE /boards/:slug/items/:rid/vote` `{voter_id}` → `{votes, voted: false}`
- `POST /boards/:slug/feedback` → same body/response as `POST /ingest/feedback` minus `project_key`; `type` defaults to `feature`. 403 `submissions_disabled` when `allow_board_submissions` is false. Source `board`.

### Account / keys

- `GET /account/usage` → Usage — JWT or key, `usage:read`
- `GET /account/audit?limit=50&action=` → `{items:[AuditEvent], limit}` newest first — JWT or key, `audit:read`
- `GET /apikeys` → `[{id, name, prefix, role, last_used_at, created_at}]` (JWT)
- `GET /apikeys/roles` → `{default_role, roles:{viewer|editor|admin: {label, description, scopes}}}` (public)
- `POST /apikeys` `{name, role?}` → `{id, key, prefix, name, role}` (201; full key shown once; 400 `invalid_role`; 402 `which: "api_keys"`) (JWT)
- `GET /apikeys/me` → `{account, key:{id, prefix, role}, scopes:[...]}` (API key only; what the MCP server calls at startup)
- `DELETE /apikeys/:id` → 204 (JWT)

### Features (retro's own switches)

- `GET /features` → `{features:{<key>: bool}}`. Public; an optional bearer token upgrades resolution to the account's targeting bucket.

### MCP (AI agents)

- Streamable HTTP endpoint `POST /mcp` (Caddy → `mcp:3333`), auth `Authorization: Bearer retro_live_…` (or `X-API-Key`). Stateless; one server per request bound to the caller's key.
- stdio flavour published to npm as `retro-feedback-mcp`. Tools/roles table in `packages/mcp-server/README.md`.
- Tools (scope in parentheses): `list_projects` `get_project` (projects:read) ·
  `create_project` `update_project` `rotate_project_key` (projects:write) ·
  `delete_project` (projects:delete, needs confirmation) ·
  `list_feedback` `get_feedback` `feedback_summary` `list_tags` (feedback:read) ·
  `update_feedback` `add_note` `promote_to_roadmap` (feedback:write; promote also needs board:write) ·
  `delete_feedback` (feedback:delete, needs confirmation) ·
  `list_roadmap` `list_changelog` (board:read) ·
  `create_roadmap_item` `update_roadmap_item` `create_changelog_entry` `update_changelog_entry` (board:write) ·
  `delete_roadmap_item` `delete_changelog_entry` (board:delete, needs confirmation) ·
  `get_usage` (usage:read) · `get_audit_log` (audit:read).
- Prompt `triage_inbox` (project) guides a model through new items: group duplicates, propose status/priority/tags, draft roadmap items.
- Destructive tools ask the user through MCP elicitation when the client
  supports it, otherwise refuse until called with `confirm: true`.

### Billing (only when BILLING_ENABLED=true)

- `GET  /billing/offerings` → offerings/packages for the paywall
- `POST /billing/webhook` ← RevenueCat (server-to-server; verifies `Authorization` header)

### Health

- `GET /healthz` → `{status:"ok"}` (also `/api/healthz` behind Caddy)

## Objects

### Project
```json
{
  "id": "uuid",
  "key": "kinegram",
  "name": "Kinegram Generator",
  "description": "optional",
  "url": "https://kinegram.3m4.net",
  "public_key": "retro_pub_…   (always, owner-only object)",
  "public_key_prefix": "retro_pub_AbCd",
  "board_slug": "kinegram",
  "board_enabled": false,
  "board_url": "https://retro.3m4.net/b/kinegram   (null when disabled)",
  "board_title": "optional, default = name",
  "board_intro": "optional markdown",
  "allow_votes": true,
  "allow_board_submissions": true,
  "types_enabled": ["bug", "feedback", "feature"],
  "allow_screenshots": true,
  "allow_email": true,
  "widget_accent": "#10b981   (optional hex)",
  "counts": { "feedback": 42, "new": 5, "roadmap": 7 },
  "created_at": "2026-10-15T10:00:00Z",
  "updated_at": "2026-10-15T10:00:00Z"
}
```

### FeedbackItem
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "number": 123,
  "type": "bug",
  "sentiment": null,
  "title": "Export button does nothing",   // ≤ 140 chars; derived from the first line of message when omitted
  "message": "Full text…",
  "status": "new",
  "priority": "none",
  "tags": ["export"],
  "reporter_email": "a@b.c",
  "reporter_id": "user-42",
  "page_url": "https://kinegram.3m4.net/editor",
  "app_version": "1.4.0",
  "locale": "es-MX",
  "user_agent": "…",
  "metadata": { "browser": "Firefox 131" },
  "source": "widget",
  "has_screenshot": true,
  "screenshot": { "content_type": "image/jpeg", "size": 183221, "width": 1600, "height": 900 },
  "roadmap_item_id": null,
  "notes": [ { "id", "body", "author": { "id", "email" }, "created_at" } ],
  // author is { "id": null, "email": null, "label": "retro_live_AbCd" } for notes added with an API key
  "created_at": "…",
  "updated_at": "…"
}
```
`type` ∈ `bug` | `feedback` | `feature`. `sentiment` ∈ `positive` | `negative`
| `neutral` | `null`. `status` ∈ `new` | `triaged` | `planned` | `in_progress`
| `done` | `declined`. `priority` ∈ `none` | `low` | `medium` | `high`.
`source` ∈ `api` | `widget` | `board`.

### RoadmapItem
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "Dark mode",
  "description": "markdown",
  "status": "planned",
  "position": 0,
  "public": true,
  "votes": 12,
  "feedback_count": 3,
  "completed_at": null,
  "created_at": "…",
  "updated_at": "…"
}
```

### ChangelogEntry
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "Dark mode is here",
  "body": "markdown",
  "version": "1.5.0",
  "published_at": null,
  "roadmap_item_ids": ["uuid"],
  "created_at": "…",
  "updated_at": "…"
}
```

### Summary
```json
{
  "project_id": "uuid",
  "total": 42,
  "by_status": { "new": 5, "triaged": 10, "planned": 4, "in_progress": 2, "done": 20, "declined": 1 },
  "by_type": { "bug": 12, "feedback": 20, "feature": 10 },
  "by_sentiment": { "positive": 14, "negative": 5, "neutral": 1 },
  "last_7_days": 9,
  "last_30_days": 31,
  "top_tags": [ { "tag": "export", "count": 4 } ]
}
```

### WidgetConfig
```json
{
  "project": { "name": "Kinegram Generator", "url": "https://kinegram.3m4.net" },
  "types_enabled": ["bug", "feedback", "feature"],
  "allow_screenshots": true,
  "allow_email": true,
  "accent": "#10b981",
  "board_url": "https://retro.3m4.net/b/kinegram",
  "features": { "screenshots": true, "public_boards": true }
}
```

### Board (public)
```json
{
  "project": { "name", "url", "board_title", "board_intro" },
  "roadmap": { "planned": [PublicRoadmapItem], "in_progress": [...], "done": [...] },
  "changelog": [PublicChangelogEntry],
  "can_submit": true,
  "can_vote": true,
  "types_enabled": ["bug", "feedback", "feature"]
}
```
`PublicRoadmapItem` = `{ id, title, description, status, votes, completed_at }`.
`PublicChangelogEntry` = `{ id, title, body, version, published_at }`.

### Usage
```json
{
  "period_start": "2026-10-01",
  "period_end": "2026-11-01",
  "feedback": 1234,
  "attachment_bytes": 52428800,
  "counts": { "projects": 2, "api_keys": 1 },
  "limits": { "...plan_limits.json entry..." }
}
```

### AuditEvent
```json
{ "id", "ts", "actor_type": "user|api_key|system", "actor_id", "actor_label", "action", "target_type", "target_id", "outcome": "ok|denied|error", "meta": {} }
```

## Widget contract (`/widget.js`)

Built from `packages/widget` (TypeScript, zero dependencies, Shadow DOM) into
`apps/web/public/widget.js` (IIFE, ES2019, target ≤ 25 KB gzipped) so the web
service serves it at `https://retro.3m4.net/widget.js`. Versioned copy at
`/widget/v1.js` (same file).

Install options (documented on `/info/docs` and in project settings):

```html
<!-- 1. One tag, auto-mount -->
<script src="https://retro.3m4.net/widget.js" data-project-key="retro_pub_…" defer></script>

<!-- 2. Explicit element (any framework, incl. Qwik/Astro/jQuery/Phaser pages) -->
<script src="https://retro.3m4.net/widget.js" defer></script>
<retro-widget project-key="retro_pub_…" position="bottom-right" lang="auto" theme="auto"></retro-widget>

<!-- 3. Headless: your own button -->
<script>retro.open({ type: "bug" })</script>
```

- Attributes / `data-*` on the script tag: `project-key` (required),
  `position` (`bottom-right` default | `bottom-left`), `lang` (`auto` =
  localStorage `3m4.lang` → `<html lang>` → `navigator.language`), `theme`
  (`auto` = localStorage `3m4.theme` → `prefers-color-scheme`; `light` |
  `dark`), `accent` (hex; overrides the project's `widget_accent`),
  `api` (base URL, default derived from the script `src` origin + `/api`),
  `hide-launcher` (headless).
- Global `window.retro`: `open({type?, message?})`, `close()`,
  `identify({id?, email?})`, `setMeta(object)` (merged into `metadata`),
  `setLang(lang)`, `setTheme(theme)`, `on(event, cb)` with events `open`,
  `close`, `submitted {id, number}`, `error`.
- Flow: launcher button → panel with the enabled types as big choices (bug 🐞,
  feedback 💬 with 👍/👎, feature 💡) → textarea (required), email (optional,
  prefilled by `identify`), **Attach screenshot** (desktop:
  `getDisplayMedia` one frame; everywhere: file picker + paste; preview and
  remove) → submit → success state showing `#number` and, when the board is
  enabled, a "See the roadmap" link. Screenshots are downscaled to ≤ 1600 px
  on the long side and encoded as JPEG q0.82 (PNG when transparent) before
  upload; the panel is hidden while `getDisplayMedia` runs so it is not in the
  capture.
- Auto-collected: `page_url` (location without hash), `locale`, `metadata.viewport`,
  `metadata.screen`, `metadata.referrer`. Header `X-Retro-Source: widget`.
- Honeypot: hidden `website` field, always sent empty by the widget.
- i18n: bundled strings for the same 34 locales as the app (`packages/widget/src/i18n.ts`), fallback English. RTL for `ar`.
- Accessibility: launcher has `aria-label`, panel is `role="dialog"` with focus trap and Escape to close; respects `prefers-reduced-motion`.
- Never throws into the host page: every failure is caught and surfaced in the
  panel (`error` event).

## Frontend contract

- Same chrome as the other 3m4 apps: footer (author → Source → info.3m4.net,
  then pricing/blog/sponsors), language picker (34 locales, `3m4.lang`),
  theme toggle (`3m4.theme`). Tokens in localStorage `retro_access_token` /
  `retro_refresh_token`.
- Routes: `/` landing · `/info` + `/info/pricing` + `/info/docs` (install
  guide: script tag, web component, curl, fetch, MCP) · `/blog` · `/sponsors` ·
  `/login` · `/signup` · `/dashboard` (projects) ·
  `/dashboard/projects/[id]` (inbox: filters, list, detail drawer with notes,
  status/priority/tags, screenshot, promote) ·
  `/dashboard/projects/[id]/roadmap` (three columns, drag or arrows to reorder, public toggle, votes) ·
  `/dashboard/projects/[id]/changelog` (entries, draft/publish, markdown preview) ·
  `/dashboard/projects/[id]/settings` (public key + rotate, install snippets with the real key, board settings, types, screenshots/email toggles, accent, delete) ·
  `/dashboard/settings` (API keys, audit) · `/dashboard/billing` (hidden in early access) ·
  `/b/[slug]` (public board: roadmap tabs, vote, submit idea) · `/b/[slug]/changelog`.
- Public board pages are SSR'd from `GET /api/boards/:slug` (API_INTERNAL_URL),
  carry OpenGraph tags and follow the viewer's theme/lang like the rest.
- Brand colour: Tailwind **emerald** scale as `primary` (3m4 blue, exp violet, bubbles orange).
