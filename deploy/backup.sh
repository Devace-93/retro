#!/usr/bin/env bash
# Nightly Postgres dump for the retro stack. Keeps 14 days.
set -euo pipefail
DIR=/opt/backups/retro
mkdir -p "$DIR"
cd /opt/retro/deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U retro -d retro | gzip > "$DIR/retro-$(date +%F).sql.gz"
find "$DIR" -name 'retro-*.sql.gz' -mtime +14 -delete
