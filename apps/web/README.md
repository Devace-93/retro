# retro — Web (Qwik City)

The marketing site, the dashboard **and** the public boards for
[retro](https://retro.3m4.net), an open-source user-feedback service (widget,
ingest API, inbox, roadmap, changelog, MCP server). One Qwik City app, SSR'd by
a standalone Node-compatible HTTP server on **port 3000** (run with Bun). Same
chrome, toolchain and code style as the sibling [3m4](https://github.com/Devace-93/3m4)
and [exp](https://github.com/Devace-93/exp) apps; brand colour is Tailwind emerald.

- Marketing: `/`, `/info` (+ `/info/pricing`, `/info/docs`), `/blog/*`, `/sponsors`.
- Auth: `/login`, `/signup` (hidden while the `signups` feature is off).
- Dashboard: `/dashboard` (projects), `/dashboard/projects/[id]` (inbox with
  filters + detail drawer), `/dashboard/projects/[id]/roadmap`,
  `/dashboard/projects/[id]/changelog`, `/dashboard/projects/[id]/settings`
  (public key, install snippets, board + widget options, delete),
  `/dashboard/settings` (API keys, audit log), `/dashboard/billing` (hidden in early access).
- Public boards: `/b/[slug]` (roadmap tabs, votes, idea form) and
  `/b/[slug]/changelog`, SSR'd from `GET /api/boards/:slug` over `API_INTERNAL_URL`.
- `/widget.js` is built by `packages/widget` into `public/` (see the widget package).

Vocabulary: **feedback items** are what users send; **features** are retro's own
switches from `packages/shared/feature_flags.json`.

Toolchain: **Bun** (do not use npm/pnpm). Stack: Qwik + Qwik City + Vite +
TypeScript + Tailwind CSS, with the official `@builder.io/qwik-city/adapters/node-server`.

## Develop

```bash
cd apps/web
bun install
bun run dev          # Vite dev server (SSR), http://localhost:5173
```

## Build & serve (production)

```bash
bun install
bun run build        # check:i18n + types + client + SSR server → dist/ + server/entry.node-server.js
bun run serve        # starts the SSR server on 0.0.0.0:3000
```

`bun run check:i18n` verifies that every base-language catalog has every
English key (same placeholders, nothing extra) and that every locale in
`src/i18n/langs.ts` has a base catalog. Catalogs live in `src/i18n/catalog/`:
`en/{chrome,marketing,app}.ts` is the reference; one `<base>.ts` per language,
optional `<base>-<COUNTRY>.ts` overrides.

## Environment (build-time, `VITE_*`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `/api` | API base the browser calls |
| `VITE_APP_URL` | `https://retro.3m4.net` | Public origin used in snippets and docs |
| `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` | — | Analytics (no-op when unset) |
| `VITE_REVENUECAT_PUBLIC_KEY` | — | Billing paywall |
| `VITE_BILLING_ENABLED` | `true` | `false` hides every purchase surface (self-host) |
| `VITE_INFO_URL` | `https://info.3m4.net` | Apps index linked from the footer |

Runtime (SSR only): `API_INTERNAL_URL` (compose: `http://api:5000/api`) is used
by `routeLoader$`s to resolve features and public boards on the server.
