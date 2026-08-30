#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--local" && "${1:-}" != "--remote" ]]; then
  echo "usage: scripts/migrate.sh --local|--remote" >&2
  exit 1
fi
MODE="$1"

for f in schema.sql migrations/*.sql; do
  echo "==> applying $f ($MODE)"
  bunx wrangler d1 execute pricewatch "$MODE" --file="$f"
done
