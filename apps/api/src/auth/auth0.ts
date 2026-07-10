import type { NextFunction, Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { config } from "../config.js"
import { prisma } from "../db/prisma.js"
import { hasPermission, scopes } from "./scopes.js"

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

export function authChallenge(res: Response, message = "Bearer token required", scope = scopes.maffAccess, error = "invalid_token") {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource", error="${error}", error_description="${message}", scope="${scope}"`)
}

export function emailMatchesRequiredDomain(email: string | undefined, requiredDomain: string | undefined) {
  if (!requiredDomain) return true
  if (!email) return false
  const normalizedDomain = requiredDomain.trim().toLowerCase().replace(/^@/, "")
  return normalizedDomain.length > 0 && email.trim().toLowerCase().endsWith(`@${normalizedDomain}`)
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
  if (!emailMatchesRequiredDomain(claims.email, config.auth0.requiredEmailDomain)) {
    throw new Error("Email domain not allowed")
  }
  return claims
}

export async function findOrCreateUser(claims: AuthClaims) {
  const existing = await prisma.user.findUnique({ where: { auth0Sub: claims.sub } })
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { email: claims.email ?? null } })
    : await prisma.user.create({ data: { auth0Sub: claims.sub, email: claims.email ?? null, displayName: claims.email ?? claims.sub } })

  if (!existing) {
    const safeName = (claims.email?.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user"
    const shortUserId = user.id.slice(0, 8)
    const privateSlug = `private-${safeName}-${shortUserId}`
    const privateWorkspace = await prisma.workspace.upsert({
      where: { slug: privateSlug },
      update: {},
      create: { slug: privateSlug, name: "Private Research", type: "private", ownerUserId: user.id }
    })
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: privateWorkspace.id, userId: user.id } },
      update: { role: "owner" },
      create: { workspaceId: privateWorkspace.id, userId: user.id, role: "owner" }
    })
  }

  const sharedWorkspace = await prisma.workspace.upsert({
    where: { slug: "shared" },
    update: {},
    create: { slug: "shared", name: "Shared Research", type: "shared", ownerUserId: user.id }
  })
  const sharedMembers = await prisma.workspaceMember.count({ where: { workspaceId: sharedWorkspace.id } })
  const email = user.email?.toLowerCase() ?? ""
  const shouldAutoJoinShared = !existing && (config.autoJoinSharedWorkspace || (email && config.sharedWorkspaceAutoJoinEmails.includes(email)))
  if (sharedMembers === 0 || shouldAutoJoinShared) {
    const configuredRole = ["viewer", "editor", "owner", "admin"].includes(config.sharedWorkspaceAutoJoinRole) ? config.sharedWorkspaceAutoJoinRole as WorkspaceRole : "viewer"
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: sharedWorkspace.id, userId: user.id } },
      update: {},
      create: { workspaceId: sharedWorkspace.id, userId: user.id, role: sharedMembers === 0 ? "owner" : configuredRole }
    })
  }
  return user
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
      if (requiredScope && !hasPermission({ scopeText: claims.scope, permissions: claims.permissions, required: requiredScope })) {
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
