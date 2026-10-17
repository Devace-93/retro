#!/usr/bin/env bash
# Walk the CONTRACT.md happy path with curl against a RUNNING stack, using a
# session from the accounts service (no passwords live in this app).
#
#   services/api/scripts/smoke.sh                               # http://localhost:8082 + http://localhost:8085
#   BASE=https://retro.3m4.net ACCOUNTS=https://accounts.3m4.net services/api/scripts/smoke.sh
#
# 1. Signs up a throwaway identity at accounts (cookie jar keeps 3m4_session).
# 2. Calls this API with the cookie: /auth/me is reachable unverified,
#    /projects is 403 email_unverified until the mailed link is followed. With
#    Mailpit (local stack) the script consumes the verification token itself.
# 3. Creates a project, posts feedback through the ingest API (JSON with the
#    header, then a form-encoded body with project_key), enables the board,
#    votes, promotes a feedback item to the roadmap and prints the project
#    summary. Needs curl + jq.
set -euo pipefail

BASE="${BASE:-http://localhost:8082}"
ACCOUNTS="${ACCOUNTS:-http://localhost:8085}"
MAILPIT="${MAILPIT:-http://localhost:8025}"
API="$BASE/api"
EMAIL="${SMOKE_EMAIL:-smoke+$(date +%s)@example.com}"
PASSWORD="${SMOKE_PASSWORD:-Smoke-Passw0rd!}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

step() { printf '\n\033[36m▶ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need curl; need jq

step "health"
curl -fsS "$API/healthz" | jq -c .

step "sign up at accounts as $EMAIL"
curl -fsS -c "$JAR" -b "$JAR" -X POST "$ACCOUNTS/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -c '{handle: .user.handle, verified: .user.email_verified}'

step "GET /auth/me with the session cookie (allowed while unverified)"
curl -fsS -b "$JAR" "$API/auth/me" | jq -c '{handle: .user.handle, verified: .user.email_verified, account: .account.name, plan}'

step "POST /projects is refused until the e-mail is verified"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke (unverified)"}')
echo "  $CODE (expected 403)"

step "verify the e-mail through Mailpit"
TOKEN=""
for _ in $(seq 1 20); do
  TOKEN=$(curl -sS "$MAILPIT/api/v1/search?query=to:$EMAIL" | jq -r '.messages[0].ID // empty' | \
    xargs -r -I{} curl -sS "$MAILPIT/api/v1/message/{}" | jq -r '.Text // ""' | grep -oE 'verify\?token=[A-Za-z0-9_-]+' | head -1 | cut -d= -f2 || true)
  [ -n "$TOKEN" ] && break
  sleep 1
done
if [ -z "$TOKEN" ]; then
  echo "  no verification mail found at $MAILPIT (production? verify manually, then re-run with SMOKE_EMAIL)"; exit 1
fi
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/auth/verify/consume" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" | jq -c '{verified: .user.email_verified}'
# A fresh access cookie carries email_verified=true.
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/session/refresh" -H 'Content-Type: application/json' -d '{}' >/dev/null
echo "  session refreshed"
H=(-b "$JAR" -H 'Content-Type: application/json')

step "create project"
PROJECT=$(curl -sS -X POST "$API/projects" "${H[@]}" \
  -d "{\"name\":\"Smoke app $(date +%H%M%S)\",\"url\":\"https://example.com\"}")
jq -c '{id,key,board_slug,public_key_prefix,board_enabled}' <<<"$PROJECT"
PID=$(jq -r .id <<<"$PROJECT"); PK=$(jq -r .public_key <<<"$PROJECT"); SLUG=$(jq -r .board_slug <<<"$PROJECT")

step "widget config (public key header)"
curl -fsS "$API/ingest/config" -H "X-Project-Key: $PK" | jq -c .

step "ingest #1: JSON + X-Project-Key header (+ tiny PNG screenshot)"
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
curl -fsS -X POST "$API/ingest/feedback" -H "X-Project-Key: $PK" -H 'X-Retro-Source: widget' \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"bug\",\"message\":\"Export button does nothing\\nSteps: click export\",\"email\":\"user@example.com\",\"page_url\":\"https://example.com/editor\",\"metadata\":{\"browser\":\"Firefox 131\"},\"screenshot\":\"data:image/png;base64,$PNG\"}" | jq -c .

step "ingest #2: form-encoded with project_key in the body (plain <form> / curl -d)"
curl -fsS -X POST "$API/ingest/feedback" \
  -d "project_key=$PK" -d "type=feedback" -d "sentiment=positive" -d "message=Love the new editor" | jq -c .

step "ingest honeypot (website filled): fake 201, nothing stored"
curl -fsS -X POST "$API/ingest/feedback" -H "X-Project-Key: $PK" -H 'Content-Type: application/json' \
  -d '{"type":"feature","message":"buy stuff","website":"http://spam"}' | jq -c .

step "inbox list"
curl -fsS "$API/projects/$PID/feedback" "${H[@]}" | jq -c '{total, items: [.items[] | {number,type,status,title,has_screenshot}]}'

step "triage #1 (status/priority/tags) + note"
curl -fsS -X PATCH "$API/projects/$PID/feedback/1" "${H[@]}" \
  -d '{"status":"triaged","priority":"high","tags":["export","ui"]}' | jq -c '{number,status,priority,tags}'
curl -fsS -X POST "$API/projects/$PID/feedback/1/notes" "${H[@]}" -d '{"body":"Reproduced on Firefox"}' | jq -c .

step "promote #1 to the roadmap"
PROMOTED=$(curl -fsS -X POST "$API/projects/$PID/feedback/1/promote" "${H[@]}" -d '{}')
jq -c '{item: {number: .item.number, status: .item.status}, roadmap_item: {id: .roadmap_item.id, status: .roadmap_item.status}}' <<<"$PROMOTED"
RID=$(jq -r .roadmap_item.id <<<"$PROMOTED")

step "enable the public board"
curl -fsS -X PATCH "$API/projects/$PID" "${H[@]}" -d '{"board_enabled":true,"board_intro":"Vote for what matters to you."}' | jq -c '{board_enabled,board_url}'

step "public board (no key)"
curl -fsS "$API/boards/$SLUG" | jq -c '{project: .project.board_title, planned: (.roadmap.planned|length), can_vote, can_submit}'

step "vote (idempotent per voter_id) + board submission"
curl -fsS -X POST "$API/boards/$SLUG/items/$RID/vote" -H 'Content-Type: application/json' -d '{"voter_id":"smoke-voter-0001"}' | jq -c .
curl -fsS -X POST "$API/boards/$SLUG/items/$RID/vote" -H 'Content-Type: application/json' -d '{"voter_id":"smoke-voter-0001"}' | jq -c .
curl -fsS -X POST "$API/boards/$SLUG/feedback" -H 'Content-Type: application/json' -d '{"message":"Please add PDF export"}' | jq -c .

step "changelog: draft then publish"
ENTRY=$(curl -fsS -X POST "$API/projects/$PID/changelog" "${H[@]}" -d '{"title":"Export fixed","body":"- Export works again","version":"1.0.1"}')
CID=$(jq -r .id <<<"$ENTRY")
curl -fsS -X PATCH "$API/projects/$PID/changelog/$CID" "${H[@]}" -d '{"published":true}' | jq -c '{title,version,published_at}'
curl -fsS "$API/boards/$SLUG/changelog" | jq -c '{total}'

step "summary + usage"
curl -fsS "$API/projects/$PID/summary" "${H[@]}" | jq -c .
curl -fsS "$API/account/usage" "${H[@]}" | jq -c '{feedback, attachment_bytes, counts}'

step "create an API key (editor) and read the project back with it"
KEY=$(curl -fsS -X POST "$API/apikeys" "${H[@]}" -d '{"name":"smoke","role":"editor"}' | jq -r .key)
curl -fsS -H "X-API-Key: $KEY" "$API/projects/$PID" | jq -c '{id, name}'

step "rotate public key: old key must die"
NEWKEY=$(curl -fsS -X POST "$API/projects/$PID/rotate-key" "${H[@]}" -d '{}' | jq -r .public_key)
curl -sS -o /dev/null -w 'old key -> HTTP %{http_code} (expect 401)\n' "$API/ingest/config" -H "X-Project-Key: $PK"
curl -sS -o /dev/null -w 'new key -> HTTP %{http_code} (expect 200)\n' "$API/ingest/config" -H "X-Project-Key: $NEWKEY"

step "audit (last actions)"
curl -fsS "$API/account/audit?limit=20" "${H[@]}" | jq -c '[.items[].action] | unique'

step "no session, no key"
curl -sS -o /dev/null -w '  %{http_code} (expected 401)\n' "$API/projects"

if [ "${KEEP:-0}" != 1 ]; then
  step "cleanup (KEEP=1 to skip)"
  curl -fsS -X DELETE "$API/projects/$PID" "${H[@]}" -o /dev/null -w 'delete project -> HTTP %{http_code}\n'
fi

step "log out at accounts; the cookie is gone"
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/session/logout" -H 'Content-Type: application/json' -d '{}' -o /dev/null
curl -sS -o /dev/null -w '  %{http_code} (expected 401)\n' -b "$JAR" "$API/auth/me"
printf '\n\033[32m✓ smoke complete\033[0m\n'
