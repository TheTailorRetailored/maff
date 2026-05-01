import type { NextFunction, Request, Response } from "express"
import fs from "node:fs/promises"
import path from "node:path"
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { config } from "../config.js"
import { prisma } from "../db/prisma.js"
import { hasScope } from "./scopes.js"

const jwks = config.auth0.jwksUri ? createRemoteJWKSet(new URL(config.auth0.jwksUri)) : undefined

export type AuthClaims = JWTPayload & {
  sub: string
  email?: string
  scope?: string
  permissions?: string[]
  org_id?: string
}

declare global {
  namespace Express {
    interface Request {
      auth?: { claims: AuthClaims; user: { id: string; auth0Sub: string; email: string | null; displayName: string | null } }
    }
  }
}

export function extractBearerToken(req: Request) {
  const header = req.header("authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function authChallenge(res: Response, message = "Bearer token required") {
  res.setHeader("WWW-Authenticate", `Bearer realm="maff", resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${message}"`)
}

export async function verifyAuth0Token(token: string): Promise<AuthClaims> {
  if (!jwks || !config.auth0.issuer || !config.auth0.audience) {
    throw new Error("Auth0 is not configured")
  }
  const result = await jwtVerify(token, jwks, {
    issuer: config.auth0.issuer,
    audience: config.auth0.audience,
    algorithms: ["RS256"]
  })
  const claims = result.payload as AuthClaims
  if (!claims.sub) throw new Error("Token missing subject")
  if (config.auth0.allowedOrgs.length && (!claims.org_id || !config.auth0.allowedOrgs.includes(claims.org_id))) {
    throw new Error("Token organization not allowed")
  }
  if (config.auth0.requiredEmailDomain && claims.email && !claims.email.endsWith(`@${config.auth0.requiredEmailDomain}`)) {
    throw new Error("Email domain not allowed")
  }
  return claims
}

export async function findOrCreateUser(claims: AuthClaims) {
  const user = await prisma.user.upsert({
    where: { auth0Sub: claims.sub },
    update: { email: claims.email ?? null },
    create: { auth0Sub: claims.sub, email: claims.email ?? null, displayName: claims.email ?? claims.sub }
  })

  const count = await prisma.workspace.count()
  if (count === 0) {
    const safeName = (claims.email?.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user"
    const privateWorkspace = await prisma.workspace.create({ data: { slug: `private-${safeName}`, name: "Private Research", type: "private", ownerUserId: user.id } })
    const sharedWorkspace = await prisma.workspace.create({ data: { slug: "shared", name: "Shared Research", type: "shared", ownerUserId: user.id } })
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: privateWorkspace.id, userId: user.id, role: "owner" },
        { workspaceId: sharedWorkspace.id, userId: user.id, role: "owner" }
      ],
      skipDuplicates: true
    })
    await seedWorkspaceVault(sharedWorkspace.slug)
  }

  return user
}

async function seedWorkspaceVault(workspaceSlug: string) {
  const root = path.join(config.dataDir, "workspaces", workspaceSlug, "vault", "Problems")
  await fs.mkdir(root, { recursive: true })
  const seeds = [
    ["Problem - Product condition cutoff", "markov_chains_cutoff", "Understand when product conditions force cutoff in structured Markov chains."],
    ["Problem - Galton Watson conductance regularity", "branching", "Find conductance regularity principles for Galton-Watson process state spaces."],
    ["Problem - Distributional predictions in queues", "queueing", "Use calibrated service-time distributions to improve queue scheduling policies."]
  ]
  for (const [title, area, statement] of seeds) {
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const file = path.join(root, `${title}.md`)
    await fs.writeFile(file, `---\nid: ${id}\ntype: Problem\nstatus: seed\nworkspace: ${workspaceSlug}\narea: ${area}\ncreated: ${new Date().toISOString().slice(0, 10)}\nupdated: ${new Date().toISOString().slice(0, 10)}\ntitle: ${title}\n---\n\n# ${title}\n\n## Statement\n\n${statement}\n\n## Motivation\n\nSeeded by Maff first-run initialization.\n\n## Decision log\n\n`)
  }
}

export function requireAuth(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractBearerToken(req)
      if (!token) {
        authChallenge(res)
        return res.status(401).json({ error: "missing_token" })
      }
      const claims = await verifyAuth0Token(token)
      if (requiredScope && !hasScope(claims.scope, requiredScope) && !(claims.permissions ?? []).includes(requiredScope)) {
        return res.status(403).json({ error: "missing_scope", requiredScope })
      }
      const user = await findOrCreateUser(claims)
      req.auth = { claims, user }
      next()
    } catch (error) {
      authChallenge(res, error instanceof Error ? error.message : "Invalid token")
      res.status(401).json({ error: "invalid_token", message: error instanceof Error ? error.message : "Invalid token" })
    }
  }
}

export function requireUser(req: Request) {
  if (!req.auth) {
    const err = new Error("Authentication required")
    ;(err as Error & { status?: number }).status = 401
    throw err
  }
  return req.auth.user
}
