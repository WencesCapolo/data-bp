#!/usr/bin/env bash
# Bootstrap a fresh production DB. Idempotent — safe to re-run.
#
# Order:
#   1. Run Drizzle migrations (creates tables + auth)
#   2. Apply raw SQL views/migrations (0001-0004)
#   3. Initial backfill from sources
#   4. Refresh mat views
#   5. Verify
#
# Requires: DATABASE_URL set (or via .env / EnvironmentFile).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ] && [ -f ".env.production" ]; then
  set -a; . ./.env.production; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  exit 1
fi

echo "→ 1/5  drizzle-kit migrate"
pnpm db:migrate

echo "→ 2/5  apply raw SQL migrations (0001-0005)"
pnpm views:apply
for f in migrations/sql/0002_*.sql migrations/sql/0003_*.sql migrations/sql/0004_*.sql migrations/sql/0005_*.sql; do
  [ -f "$f" ] || continue
  echo "    applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "→ 3/5  initial backfill"
pnpm sync:initial

echo "→ 4/5  refresh mat views"
pnpm views:refresh

echo "→ 5/5  verify"
pnpm tsx --env-file=.env.production scripts/db-verify.ts || \
  pnpm tsx scripts/db-verify.ts

echo "Bootstrap complete."
