#!/usr/bin/env bash
# Manual logical backup of the Postgres DB. NOT automated.
# Run on demand before risky migrations / schema changes.
#
# Writes pg_dump custom-format to /var/backups/data-bp/ and prunes >14 days.
#
# Usage:
#   pnpm db:backup
#   # or directly:  bash scripts/db-backup.sh
#
# Env required: DATABASE_URL. Loaded from /etc/data-bp/env if not in shell.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/data-bp}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ] && [ -f /etc/data-bp/env ]; then
  set -a; . /etc/data-bp/env; set +a
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/basket_analytics_${STAMP}.dump"

echo "→ dumping to $OUT"
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --dbname="$DATABASE_URL" --file="$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "→ done ($SIZE)"

echo "→ pruning backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -name 'basket_analytics_*.dump' -mtime +"$RETENTION_DAYS" -print -delete

# Optional: copy off-box. Configure one of these via env:
#   BACKUP_RSYNC_DEST=user@backup-host:/path/
#   BACKUP_S3_BUCKET=s3://bucket/data-bp/
if [ -n "${BACKUP_RSYNC_DEST:-}" ]; then
  echo "→ rsync to $BACKUP_RSYNC_DEST"
  rsync -az --delete-after "$BACKUP_DIR/" "$BACKUP_RSYNC_DEST"
fi
if [ -n "${BACKUP_S3_BUCKET:-}" ] && command -v aws >/dev/null; then
  echo "→ aws s3 sync to $BACKUP_S3_BUCKET"
  aws s3 sync "$BACKUP_DIR/" "$BACKUP_S3_BUCKET" --delete
fi
