# Maff bearer authorization matrix

This matrix is enforced from the same definitions used by REST middleware and MCP discovery. `apps/api/src/smoke.ts` snapshots all 81 authenticated REST registrations and all 89 MCP tool definitions so additions or disappearances require an intentional review.

| Operation class | OAuth scope | Accepted roles from `OIDC_ROLE_CLIENT_ID` only | Workspace layer |
| --- | --- | --- | --- |
| Read | `maff:read` | `reader`, `contributor`, `reviewer`, `service-admin` | viewer or route-specific membership |
| Write | `maff:write` | `contributor`, `service-admin` | editor (owner/admin also satisfy the workspace rank) |
| Review/gate | `maff:review` | `reviewer`, `service-admin` | the tool/route's editor-or-higher requirement |
| Service administration | `maff:admin` | `service-admin` | the tool/route's independent workspace requirement, including workspace admin where declared |

Every row is an intersection: possessing only the scope, only the client role, or both without the required workspace membership is insufficient. Realm roles and roles beneath any other Keycloak client are ignored. `maff:access` is neither advertised nor accepted.

REST uses `restAuthorizationRequirement(method, path)`. Safe methods require read. Ordinary mutations require write. Review claiming, review creation, manuscript promotion/freezing, external-review import, and strategic-review creation require review. Each handler then performs its own workspace membership, minimum-role, ownership, or record lookup before accessing data.

MCP uses each `toolDefinitions` entry as its matrix row: `name`, `scope`, and minimum workspace `role`. Discovery publishes the same scope in each tool's OAuth security scheme. `mcpAuthorizationMatrix()` exposes the complete checked matrix without maintaining a second registry.
