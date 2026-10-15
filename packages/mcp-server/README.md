# retro-feedback-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for
[retro](https://retro.3m4.net), the user-feedback service. Lets an AI agent
(Claude Code, Claude Desktop, Cursor, the MCP Inspector, your own app) triage
bug reports, feedback and feature requests, keep the public roadmap and
changelog up to date, and manage projects — with **role-based tool access**, a
**human approval step** for destructive actions, and an **audit trail**.

```
npx retro-feedback-mcp              # stdio (local hosts)
https://retro.3m4.net/mcp           # Streamable HTTP (remote hosts)
```

## Quick start

1. Create an API key in the dashboard (`/dashboard/settings`) and pick a role.
2. Register the server with your host.

**Claude Code**

```bash
claude mcp add retro --scope user \
  --env RETRO_API_KEY=retro_live_… \
  -- npx -y retro-feedback-mcp
```

**Cursor / Claude Desktop / any JSON config**

```json
{
  "mcpServers": {
    "retro": {
      "command": "npx",
      "args": ["-y", "retro-feedback-mcp"],
      "env": { "RETRO_API_KEY": "retro_live_…" }
    }
  }
}
```

**Remote (Streamable HTTP)** — no install, the key travels as a Bearer token:

```bash
claude mcp add --transport http retro https://retro.3m4.net/mcp \
  --header "Authorization: Bearer retro_live_…"
```

Then ask: *"how is the feedback looking for Kinegram?"*, *"triage the new
items in the Bubbles inbox"*, *"promote #42 to the roadmap"*, *"write a
changelog entry for dark mode and publish it"*, *"who declined #17?"*.

## Configuration

| Variable          | Default                     | Meaning |
|-------------------|-----------------------------|---------|
| `RETRO_API_KEY`   | —                           | Required for stdio. The retro management API key (`retro_live_…`). |
| `RETRO_API_URL`   | `https://retro.3m4.net/api` | API base URL. Self-hosters point this at their instance. |
| `RETRO_AUDIT_LOG` | `stderr`                    | `stderr`, `none`, or a file path (JSON lines). |
| `RETRO_MCP_PORT`  | `3333`                      | HTTP entrypoint only. |

Project public keys (`retro_pub_…`) are **not** accepted: they can only call
the ingest API and carry no role.

## Roles and tools (RBAC)

Each API key has a role. The server asks the API for the key's scopes once
(`GET /apikeys/me`) and **only registers the tools those scopes allow**, so a
read-only key never even lists `delete_feedback`. Every call is re-checked at
call time, and the API enforces the same scopes independently — three layers,
and a bug in the server can hide access but never grant it.

| Tool                     | Scope                            | viewer | editor | admin | Notes |
|--------------------------|----------------------------------|:------:|:------:|:-----:|-------|
| `list_projects`          | `projects:read`                  | ✓ | ✓ | ✓ | search with `q`; counts + board status |
| `get_project`            | `projects:read`                  | ✓ | ✓ | ✓ | public key, board and widget settings |
| `list_feedback`          | `feedback:read`                  | ✓ | ✓ | ✓ | filters: status, type, sentiment, priority, tag, q, since |
| `get_feedback`           | `feedback:read`                  | ✓ | ✓ | ✓ | by id or `#number`, with notes |
| `feedback_summary`       | `feedback:read`                  | ✓ | ✓ | ✓ | counts by status / type / sentiment, top tags |
| `list_tags`              | `feedback:read`                  | ✓ | ✓ | ✓ | |
| `list_roadmap`           | `board:read`                     | ✓ | ✓ | ✓ | includes hidden items |
| `list_changelog`         | `board:read`                     | ✓ | ✓ | ✓ | drafts first |
| `get_usage`              | `usage:read`                     | ✓ | ✓ | ✓ | feedback / storage / counts vs. plan limits |
| `create_project`         | `projects:write`                 |   | ✓ | ✓ | returns the public key + widget snippet |
| `update_project`         | `projects:write`                 |   | ✓ | ✓ | board slug / enabled, types, screenshots, accent… |
| `rotate_project_key`     | `projects:write`                 |   | ✓ | ✓ | old key stops working immediately |
| `update_feedback`        | `feedback:write`                 |   | ✓ | ✓ | status, priority, tags, title, type, sentiment, roadmap link |
| `add_note`               | `feedback:write`                 |   | ✓ | ✓ | internal note |
| `promote_to_roadmap`     | `feedback:write` + `board:write` |   | ✓ | ✓ | idempotent |
| `create_roadmap_item`    | `board:write`                    |   | ✓ | ✓ | |
| `update_roadmap_item`    | `board:write`                    |   | ✓ | ✓ | `done` cascades to linked feedback |
| `create_changelog_entry` | `board:write`                    |   | ✓ | ✓ | draft unless `publish=true` |
| `update_changelog_entry` | `board:write`                    |   | ✓ | ✓ | publish / unpublish |
| `delete_project`         | `projects:delete`                |   |   | ✓ | **confirmation required** |
| `delete_feedback`        | `feedback:delete`                |   |   | ✓ | **confirmation required** |
| `delete_roadmap_item`    | `board:delete`                   |   |   | ✓ | **confirmation required** |
| `delete_changelog_entry` | `board:delete`                   |   |   | ✓ | **confirmation required** |
| `get_audit_log`          | `audit:read`                     |   |   | ✓ | |

Roles are defined once in
[`packages/shared/api_key_roles.json`](../shared/api_key_roles.json) and
shared by the API, the dashboard and this server.

Also exposed: resources `retro://projects` and `retro://projects/{id}/summary`,
and the `triage_inbox` prompt (walks the model through new items: duplicates,
status / priority / tags, roadmap drafts — and makes it ask before applying).

## Human approval for destructive actions

The four `delete_*` tools are irreversible, so they never run on the model's
say-so alone:

- On hosts that support MCP **elicitation** (Claude Code, Inspector) the user
  gets a native confirmation dialog showing exactly what will be deleted.
- On hosts that don't (and always over HTTP, which is stateless), the tool
  refuses with `confirmation_required` until the model calls it again with
  `confirm: true` — which it can only honestly do after asking the user.

`rotate_project_key` is not gated but is marked destructive: every widget
snippet using the previous key stops working the moment it runs. Prefer
`update_feedback` with `status: declined` over `delete_feedback`, and
`public: false` / `published: false` over deleting board items.

## Audit trail

Two complementary logs:

- **Server-side** (`audit_events` table, `GET /account/audit`, tool
  `get_audit_log`): every mutation and every authorization denial, written in
  the same transaction as the change.
- **Agent-side** (`RETRO_AUDIT_LOG`, JSON lines): every tool call the agent
  attempted, including ones refused locally that never reached the API, with
  duration, outcome (`ok|denied|error|cancelled|pending`) and compacted args.

## Design notes

- **Structured outputs.** Every tool declares an `outputSchema` and returns
  `structuredContent`; hosts can validate and chain results without parsing
  prose. Objects mirroring API responses allow extra fields, so an additive
  API change never breaks client-side validation.
- **Errors are results.** API errors come back as `isError` with the stable
  code (`limit_reached` + `which`, `key_taken`, `slug_taken`, `reserved_slug`,
  `insufficient_scope`, `not_found`…) so the model can recover instead of
  crashing.
- **stdio hygiene.** stdout is the protocol channel; all logging goes to stderr.
- **Stateless HTTP.** Each request builds a server bound to the caller's key;
  tenants can never share state. The `/apikeys/me` lookup is cached 60 s per key.

## Development

```bash
bun install
bun test            # in-memory MCP client ↔ server against a fake API
bun run build
RETRO_API_KEY=… RETRO_API_URL=http://localhost:8082/api bun run inspect   # MCP Inspector
RETRO_API_KEY=… RETRO_API_URL=http://localhost:8082/api bun run dev:http  # http://localhost:3333/mcp
```

The Docker image (`packages/mcp-server/Dockerfile`) runs the HTTP flavour and
is wired into `deploy/docker-compose.yml` as the `mcp` service, exposed by
Caddy at `/mcp`.

## License

MIT © Enrique Magallon Alvarez
