# Maff

Maff is an experimental, self-hosted mathematics research workbench built around an Obsidian-compatible Markdown vault, a typed research graph, a constrained MCP endpoint, Quartz publishing, and an isolated Lean worker.

> **Private alpha:** the architecture is functional and used for personal research, but installation is still involved and the project has not received an independent security audit. Keep real research vaults and credentials out of public demo environments.

![Maff research workbench](docs/images/maff-workbench.png)

The repository ships only synthetic demo notes under `examples/demo-vault`; personal vaults, database contents, generated Lean workspaces, and environment files are excluded.

## Services

- `api`: TypeScript REST and MCP server with Auth0 JWT verification through JWKS.
- `web`: React/Vite authenticated workbench for workspaces, nodes, graph, tasks, skills, and Lean jobs.
- `db`: PostgreSQL index/cache and permission store.
- `lean-worker`: internal Lean 4 worker with persistent Elan, cache, Lake, and workspace volumes.
- `quartz`: self-hosted Quartz renderer for workspace vaults.
- `caddy`: reverse proxy for `/app`, `/api`, `/mcp`, and `/sites`.

Markdown files remain the source of truth. The database stores users, permissions, indexes, jobs, and audit logs.

## Graph Model

Maff's default graph is mathematical, not operational. Primary graph nodes are `Problem`, `Claim`, `Definition`, `Paper`/`KnownResult`, and substantial `Experiment` or `Draft` notes.

A `Claim` represents theorem-like mathematical content: conjectures, theorems, lemmas, propositions, corollaries, reductions, counterexample claims, and technical statements. Claim notes include sections for statement, status, role in project, dependencies, proof routes, informal proof, Lean formalization, attempts and notes, tasks, and decision log.

Routes, proof attempts, minor gaps, informal proof updates, Lean status, and routine notes usually live inside the relevant Claim note. They are promoted to standalone graph nodes only when they become substantial, reusable, independently documentable, or explicitly requested.

Tasks are operational queue records stored in PostgreSQL and attached to a target node/section. They appear in the queue and node detail views, but they do not appear in the default graph.

Graph views are problem-scoped by default. A workspace can contain many Problems, and each Problem is the root of its own claim graph. Use `GET /api/workspaces/:workspaceId/problems` for the workspace overview and `GET /api/workspaces/:workspaceId/problems/:problemId/graph` for the default Problem -> Claim dependency graph. The MCP equivalents are `list_problem_graphs` and `get_problem_graph`.

The claim-centric model replaced an earlier star-shaped Conjecture/ProofRoute/Gap/Task design. Migration helpers remain for existing private workspaces, while new work should use Claim nodes.

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

To preview the synthetic, read-only portfolio view without Auth0 or an API:

```powershell
cd apps/web
$env:VITE_DEMO_MODE = "true"
npm run dev -- --host 127.0.0.1
```

Demo mode is selected at build time and exposes no authenticated application data or write paths.

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
6. Set `AUTH0_AUDIENCE` to the MCP protected resource, for example `https://maff.lachlanbridges.com/mcp`.
7. Add API permissions: `maff:access` and `maff:admin`.
8. Enable Auth0 OIDC Dynamic Application Registration if ChatGPT should self-register as an MCP OAuth client.
9. The Maff Web SPA uses `AUTH0_CLIENT_ID`, but MCP clients use their own dynamically registered client ids. Maff does not require `azp` or `client_id` to match the SPA client id.
10. For MCP clients, ensure OAuth requests include the same audience/resource.
11. For initial ChatGPT connector setup, use advanced OAuth base scopes: `openid profile email offline_access maff:access`.
12. Confirm `/api/auth/debug-token` shows `has_maff_access: true`, the expected `aud`, `iss`, and internal user id.

The API verifies JWTs locally via JWKS and does not use `/userinfo` for authorization.

Maff only acts as an MCP protected resource. It does not implement OAuth registration, authorization, or token endpoints; Auth0 handles those pieces.

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

Both endpoints publish `resource: AUTH0_AUDIENCE`, `authorization_servers: [AUTH0_ISSUER]`, supported scopes (`maff:access`, `maff:admin`), and `resource_documentation: PUBLIC_BASE_URL`.

MCP exposes structured research tools such as `maff_bootstrap`, `create_claim`, `add_route_to_claim`, `log_proof_attempt`, `create_task`, `get_skill_pack`, `rebuild_quartz_site`, and Lean formalization tools. It intentionally does not expose arbitrary file writes, shell execution, or deletion tools.

Maff is tool-first and resource-supported. ChatGPT should normally call `maff_bootstrap` first whenever the user wants to create, save, resume, or work on anything in Maff. `maff_bootstrap` returns the selected workflow prompt, compact skills, graph context, queue decision, suggested tools, writeback plan, and user-facing response contract inline. MCP resources such as `workspace://...`, `node://...`, `graph://...`, `skill://...`, and `prompt://...` are stable read-only references for browsing and linking; do not rely on clients automatically fetching them for orchestration.

Prompt tools are also available:

- `list_prompts`
- `get_prompt`

The prompt catalog includes capture, triage, route generation, proof attack, gap analysis, literature, experiment, paper, weekly digest, and Lean formalization workflows.

Task queue policy: use queued tasks only when resuming an existing problem with no specific user idea and no explicit workflow. Claimed tasks use leases: normal workflows default to 20 minutes, Lean/formalization workflows default to 60 minutes. The graph is the durable memory, so long sessions should checkpoint by appending attempts/gaps/routes to Claim notes, creating attached tasks, and completing workflows.

Compatibility aliases remain available: `create_conjecture` creates a `Claim` with `claim_kind=conjecture`; `create_theorem_candidate` creates a theorem Claim; `create_lemma_candidate` creates a lemma Claim. Legacy route/gap/attempt tools append to Claim sections by default instead of creating graph nodes.

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

The smoke script verifies path traversal rejection, YAML frontmatter round-tripping, wikilink and typed-edge parsing, and MCP tool discovery. Full deployment validation still requires Docker and real Auth0 tokens.

## Public-release boundary

- Markdown files remain authoritative; PostgreSQL is an index, queue, permission store, and audit log.
- The included example is synthetic and safe to publish.
- Authentication and workspace roles are implemented, but operators remain responsible for TLS, backups, network isolation, and tenant configuration.
- Lean jobs execute separately from the API; production deployments should apply container and host-level resource limits.
- No claims are made that agent-produced mathematics is correct until reviewed and, where applicable, checked by Lean.

See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Maff is licensed under the [MIT License](LICENSE).

## Future Work

Planned extensions include Git-backed vault mutations, semantic search, citation import, Loogle/LeanSearch integration, Lean LSP goals, websocket job updates, and LaTeX paper export.
