export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir: process.env.DATA_DIR ?? "./data",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3001",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim()).filter(Boolean),
  autoJoinSharedWorkspace: (process.env.AUTO_JOIN_SHARED_WORKSPACE ?? "false").toLowerCase() === "true",
  auth0: {
    domain: process.env.AUTH0_DOMAIN ?? "",
    issuer: process.env.AUTH0_ISSUER ?? "",
    audience: process.env.AUTH0_AUDIENCE ?? "",
    jwksUri: process.env.AUTH0_JWKS_URI ?? "",
    clientId: process.env.AUTH0_CLIENT_ID ?? "",
    allowedOrgs: (process.env.AUTH0_ALLOWED_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    requiredEmailDomain: process.env.AUTH0_REQUIRED_EMAIL_DOMAIN || undefined
  },
  leanWorkerUrl: process.env.LEAN_WORKER_URL ?? "http://localhost:8765",
  quartzDir: process.env.QUARTZ_DIR ?? "./quartz",
  skillsDir: process.env.SKILLS_DIR ?? "./skills",
  promptsDir: process.env.PROMPTS_DIR ?? "./prompts"
}
