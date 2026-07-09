# Research Frontier Rollback

Generated before applying the research-frontier database migration.

## Restore Database

Backup created: `/srv/apps/maff/backups/maff-20260709T162501Z.dump`.

```bash
cd /srv/apps/maff
docker compose exec -T db sh -c 'dropdb -U "${POSTGRES_USER:-maff}" --if-exists "${POSTGRES_DB:-maff}" && createdb -U "${POSTGRES_USER:-maff}" "${POSTGRES_DB:-maff}"'
docker compose exec -T db sh -c 'pg_restore -U "${POSTGRES_USER:-maff}" -d "${POSTGRES_DB:-maff}" --clean --if-exists' < /srv/apps/maff/backups/maff-20260709T162501Z.dump
```

## Revert Code

```bash
cd /srv/apps/maff
git switch main
docker compose build api web
docker compose up -d db api web lean-worker
```

If the previous deployment was a specific commit, replace `main` with that commit or branch.

## Verify

```bash
cd /srv/apps/maff
docker compose ps
curl -fsS http://127.0.0.1:3001/api/health || true
```
