# Security

Maff is an experimental self-hosted research system, not a managed multi-tenant service. Only the latest revision is supported.

The API verifies Auth0 JWTs and applies workspace roles. The MCP surface deliberately omits arbitrary shell execution, arbitrary file writes, and deletion tools. Lean runs in a separate worker, but generated Lean source and dependencies should still be treated as untrusted code and isolated from sensitive host paths.

For deployment:

- keep PostgreSQL and the Lean worker bound to private interfaces;
- terminate TLS at a maintained reverse proxy;
- use unique production secrets and restrict allowed origins;
- back up vaults and the database independently;
- review Auth0 audience, scopes, and workspace membership settings;
- do not mount personal vaults into a public demo instance.

Please report vulnerabilities privately to the repository owner. Do not include credentials, private research notes, or exploit details in a public issue.
