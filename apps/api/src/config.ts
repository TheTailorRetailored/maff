export const productionOidc = {
  issuer: "https://auth.lachlanbridges.com/realms/bridges",
  audience: "https://maff.lachlanbridges.com/mcp"
} as const

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir: process.env.DATA_DIR ?? "./data",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3001",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim()).filter(Boolean),
  autoJoinSharedWorkspace: (process.env.AUTO_JOIN_SHARED_WORKSPACE ?? "false").toLowerCase() === "true",
  sharedWorkspaceAutoJoinEmails: (process.env.SHARED_WORKSPACE_AUTO_JOIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  sharedWorkspaceAutoJoinRole: process.env.SHARED_WORKSPACE_AUTO_JOIN_ROLE ?? "viewer",
  oidc: {
    issuer: process.env.OIDC_ISSUER ?? "",
    audience: process.env.OIDC_AUDIENCE ?? "",
    roleClientId: process.env.OIDC_ROLE_CLIENT_ID ?? "",
    allowedOrganizations: (process.env.OIDC_ALLOWED_ORGANIZATIONS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    requiredEmailDomain: process.env.OIDC_REQUIRED_EMAIL_DOMAIN || undefined
  },
  leanWorkerUrl: process.env.LEAN_WORKER_URL ?? "http://localhost:8765",
  quartzDir: process.env.QUARTZ_DIR ?? "./quartz",
  skillsDir: process.env.SKILLS_DIR ?? "./skills",
  promptsDir: process.env.PROMPTS_DIR ?? "./prompts"
}
