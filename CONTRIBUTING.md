# Contributing

Maff is a pre-release research system. Keep changes focused, preserve Markdown vaults as the source of truth, and add synthetic fixtures rather than personal research data.

Before opening a change, run the API typecheck and smoke suite, build the web app, and build the Lean worker. Changes to permissions, paths, MCP mutations, or Lean execution need an explicit security review in the pull request description.

Do not commit `.env` files, OIDC identifiers from live accounts, database dumps, real workspace vaults, or generated Lean workspaces.
