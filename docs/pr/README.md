# PR demos

Every UI-changing pull request carries a demo GIF **and** a webm in its
description. Record them against the local stack (`make up`, http://localhost:8082)
and drop the files here, named after the branch (`feat-inbox-drawer.gif`,
`feat-inbox-drawer.webm`). Keep GIFs under ~5 MB; the webm is the full-quality copy.

## Phase 2 e2e (branch `phase-2/e2e`)

New specs under `e2e/tests/`: `webhooks`, `export`, `views`, `duplicates`,
`notifications`, `turnstile`. They are written against CONTRACT.md's Phase 2
addendum before the implementation landed, so the UI locators listed at the
top of each file are assumptions to adjust once the dashboard exists. The
webhook sink needs `E2E_WEBHOOK_SINK_HOST` to be reachable from the api
container (default `172.17.0.1`).
