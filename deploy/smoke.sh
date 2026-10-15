#!/usr/bin/env sh
# Smoke test for a running retro stack: health, widget headers, ingest round-trip.
#   BASE_URL=http://localhost:8082 sh deploy/smoke.sh
# Creates a throwaway account + project through the API, so it needs signups ON.
set -eu
BASE_URL="${BASE_URL:-http://localhost:8082}"
API="$BASE_URL/api"

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need curl; need python3

say "health"
curl -fsS "$API/healthz" | grep -q '"ok"' && echo "  api ok"

say "widget headers"
curl -fsSI "$BASE_URL/widget.js" | tr -d '\r' | grep -iE '^(content-type|cache-control|access-control-allow-origin):' | sed 's/^/  /'

say "register + project"
EMAIL="smoke+$(date +%s)@example.com"
TOKEN=$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke-Passw0rd!\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
PROJECT=$(curl -fsS -X POST "$API/projects" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke project"}')
PID=$(printf '%s' "$PROJECT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
PUB=$(printf '%s' "$PROJECT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["public_key"])')
echo "  project $PID ($PUB)"

say "ingest (JSON + header)"
curl -fsS -X POST "$API/ingest/feedback" -H "X-Project-Key: $PUB" -H 'Content-Type: application/json' \
  -d '{"type":"bug","message":"smoke: export button does nothing","app_version":"smoke"}' | sed 's/^/  /'; echo

say "ingest (form body)"
curl -fsS -X POST "$API/ingest/feedback" --data-urlencode "project_key=$PUB" --data-urlencode "type=feedback" \
  --data-urlencode "sentiment=positive" --data-urlencode "message=smoke: love it" | sed 's/^/  /'; echo

say "inbox"
curl -fsS "$API/projects/$PID/feedback" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  %d item(s): %s" % (d["total"], ", ".join("#%d %s" % (i["number"], i["type"]) for i in d["items"])))'

say "cleanup"
curl -fsS -X DELETE "$API/projects/$PID" -H "Authorization: Bearer $TOKEN" && echo "  project deleted"
echo "smoke ok"
