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

## VPS

```bash
git clone <private-repo-url> maff
cd maff/research-graph
cp .env.example .env
# fill Auth0 variables and POSTGRES_PASSWORD
docker compose up -d --build
```

Point DNS at the VPS and adjust `deploy/Caddyfile` for your domain and TLS email as needed.

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

## Future Work

Planned extensions include Git-backed vault mutations, semantic search, citation import, Loogle/LeanSearch integration, Lean LSP goals, websocket job updates, and LaTeX paper export.
