# Maff

Maff is a private, self-hosted math research system built around an Obsidian-compatible Markdown vault, a typed research graph, a safe MCP endpoint, Quartz publishing, and an isolated Lean worker.

## Services

- `api`: TypeScript REST and MCP server with Auth0 JWT verification through JWKS.
- `web`: React/Vite authenticated workbench for workspaces, nodes, graph, tasks, skills, and Lean jobs.
- `db`: PostgreSQL index/cache and permission store.
- `lean-worker`: internal Lean 4 worker with persistent Elan, cache, Lake, and workspace volumes.
- `quartz`: self-hosted Quartz renderer for workspace vaults.
- `caddy`: reverse proxy for `/app`, `/api`, `/mcp`, and `/sites`.

Markdown files remain the source of truth. The database stores users, permissions, indexes, jobs, and audit logs.

## Local Dev

```bash
cp .env.example .env
# fill Auth0 and Postgres values
docker compose up --build
```

Local ports are bound to localhost:

- Web: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:3001`
- Lean worker: `http://127.0.0.1:8765`
- Postgres: `127.0.0.1:5432`

For Auth0 local development, add local callback, logout, and web origins for `http://localhost:3000` and `http://127.0.0.1:3000`.

## VPS With Repo-Managed Caddy

```bash
git clone <private-repo-url> maff
cd maff
cp .env.example .env
# fill Auth0 variables and POSTGRES_PASSWORD
docker compose --profile proxy up -d --build
```

Set `PUBLIC_BASE_URL_HOSTNAME=research.example.com` in `.env`. The bundled Caddyfile preserves `/api`, `/mcp`, `/.well-known/oauth-protected-resource`, and `/sites` prefixes when proxying to the API.

## VPS With Existing Caddy/Nginx

If your VPS already runs Caddy, nginx, Traefik, or another proxy, do not start the repo-managed Caddy service:

```bash
docker compose up -d --build db api web lean-worker
```

Configure the external proxy with prefix-preserving routes:

| Route | Upstream | Prefix behavior |
| --- | --- | --- |
| `/api/*` | `127.0.0.1:3001` | Preserve `/api` |
| `/mcp` | `127.0.0.1:3001` | Preserve `/mcp` |
| `/.well-known/oauth-protected-resource*` | `127.0.0.1:3001` | Preserve full path |
| `/sites/*` | `127.0.0.1:3001` | Preserve `/sites` |
| `/` or `/app/*` | `127.0.0.1:3000` | Serve the web app |

Do not use `handle_path /api*`, `rewrite`, or equivalent prefix stripping unless the Express routes are changed to match.

## Auth0 Setup Checklist

1. Create an Auth0 API with Identifier equal to `AUTH0_AUDIENCE`.
2. Create a SPA app for the web UI.
3. Configure allowed callback, logout, and web origins.
4. Ensure the SPA requests `audience = AUTH0_AUDIENCE`.
5. Ensure access tokens are RS256 JWTs.
6. Add scopes: `graph:read graph:write node:create node:update attempt:write experiment:write formalization:run publish:run workspace:admin`.
7. For MCP clients, ensure OAuth requests include the same audience/resource.
8. Confirm `/api/auth/debug-token` shows the expected `aud`, `iss`, scopes, and internal user id.

The API verifies JWTs locally via JWKS and does not use `/userinfo` for authorization.

Later users always receive their own private workspace. Shared workspace membership is explicit by default; set `AUTO_JOIN_SHARED_WORKSPACE=true` only if you want new users to be added automatically as viewers.

## MCP

Remote MCP endpoint:

```text
POST /mcp
```

Protected resource metadata:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

MCP exposes structured research tools such as `start_research_session`, `create_conjecture`, `log_proof_attempt`, `create_gap`, `get_skill_pack`, `rebuild_quartz_site`, and Lean formalization tools. It intentionally does not expose arbitrary file writes, shell execution, or deletion tools.

## Vaults

Workspace vaults live under:

```text
/data/workspaces/{workspaceSlug}/vault
```

Each node is one Markdown file with YAML frontmatter and Obsidian-style `[[wikilinks]]`.

## Lean

Lean workspaces live under:

```text
/data/lean-workspaces/{workspaceSlug}
```

The worker supports project creation, theorem stub creation, and `lake env lean path/to/file.lean` checks. Goal extraction and tactic search are MVP stubs.

Lean checks report `hasSorry` and `hasAxiom` by reading the source file directly. Maff will conservatively mark a theorem `lean_checked`, not `lean_verified`, when the latest check is missing, failed, or contains `sorry`/`axiom`.

## Smoke Checks

```bash
cd apps/api
npm run typecheck
npm run test:smoke
```

The smoke script verifies path traversal rejection, wikilink parsing, and MCP tool discovery. Full deployment validation still requires Docker and real Auth0 tokens.

## Future Work

Planned extensions include Git-backed vault mutations, semantic search, citation import, Loogle/LeanSearch integration, Lean LSP goals, websocket job updates, and LaTeX paper export.
