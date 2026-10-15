# retro e2e

Playwright suite against a running stack (`make up`, then `make e2e`). Each spec
creates its own account through the API; nothing is shared or reused between
runs. Set `E2E_BASE_URL` to point at another host (default `http://localhost:8082`).

| Spec | Covers |
|---|---|
| `auth.spec.ts` | sign up → dashboard, log out, log in, wrong password |
| `project.spec.ts` | create project → settings show the public key → enable the board |
| `ingest.spec.ts` | `POST /api/ingest/feedback` with header and form body, honeypot, bad key, CORS |
| `board.spec.ts` | public board renders roadmap + changelog, vote toggles, submit an idea |
| `widget.spec.ts` | `/widget.js` on a host page: open, pick bug, type, submit, success state |

`bun run test:critical` runs only the `@critical` tests.
