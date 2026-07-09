#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT}/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/maff-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
cd "${ROOT}"

docker compose exec -T db sh -c 'pg_dump -U "${POSTGRES_USER:-maff}" -d "${POSTGRES_DB:-maff}" -Fc' > "${OUT}"
chmod 600 "${OUT}"

echo "Backup written: ${OUT}"
echo
echo "Rollback restore command:"
echo "  docker compose exec -T db sh -c 'dropdb -U \"\${POSTGRES_USER:-maff}\" --if-exists \"\${POSTGRES_DB:-maff}\" && createdb -U \"\${POSTGRES_USER:-maff}\" \"\${POSTGRES_DB:-maff}\"'"
echo "  docker compose exec -T db sh -c 'pg_restore -U \"\${POSTGRES_USER:-maff}\" -d \"\${POSTGRES_DB:-maff}\" --clean --if-exists' < '${OUT}'"
