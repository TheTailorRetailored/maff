import type { NextFunction, Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type KeyLike } from "jose"
import { config } from "../config.js"
import { prisma } from "../db/prisma.js"
import { hasBearerAuthorization, scopes } from "./scopes.js"

export function jwksUriForIssuer(issuer: string) {
  if (!issuer || issuer.endsWith("/")) throw new Error("OIDC issuer must be an exact URL without a trailing slash")
  const parsed = new URL(issuer)
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("OIDC issuer must be a clean HTTPS URL")
  return new URL(`${issuer}/protocol/openid-connect/certs`)
}

const jwks = config.oidc.issuer ? createRemoteJWKSet(jwksUriForIssuer(config.oidc.issuer)) : undefined

export type AuthClaims = JWTPayload & {
  sub: string
  email?: string
  email_verified?: boolean
  scope?: string
  org_id?: string
  resource_access?: Record<string, { roles?: string[] }>
}

declare global {
  namespace Express {
    interface Request {
      auth?: { claims: AuthClaims; user: { id: string; auth0Sub: string | null; email: string | null; displayName: string | null } }
    }
  }
}

export function extractBearerToken(req: Request) {
  const header = req.header("authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function quotedAuthParameter(value: string) {
  // Error messages may originate in token-validation libraries. Never let a
  // control character or a quote turn a 401 response into a process crash.
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\u0000-\u001F\u007F]/g, " ")
}

export function authChallenge(res: Response, message = "Bearer token required", scope: string = scopes.maffRead, error = "invalid_token") {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${quotedAuthParameter(config.publicBaseUrl)}/.well-known/oauth-protected-resource", error="${quotedAuthParameter(error)}", error_description="${quotedAuthParameter(message)}", scope="${quotedAuthParameter(scope)}"`)
}

export function emailMatchesRequiredDomain(email: string | undefined, requiredDomain: string | undefined) {
  if (!requiredDomain) return true
  if (!email) return false
  const normalizedDomain = requiredDomain.trim().toLowerCase().replace(/^@/, "")
  return normalizedDomain.length > 0 && email.trim().toLowerCase().endsWith(`@${normalizedDomain}`)
}

export async function verifyOidcToken(token: string): Promise<AuthClaims> {
  if (!jwks || !config.oidc.issuer || !config.oidc.audience) {
    throw new Error("OIDC is not configured")
  }
  const result = await jwtVerify(token, jwks, { issuer: config.oidc.issuer, audience: config.oidc.audience, algorithms: ["RS256"] })
  const claims = result.payload as AuthClaims
  if (!claims.sub) throw new Error("Token missing subject")
  if (config.oidc.allowedOrganizations.length && (!claims.org_id || !config.oidc.allowedOrganizations.includes(claims.org_id))) {
    throw new Error("Token organization not allowed")
  }
  if (!emailMatchesRequiredDomain(claims.email, config.oidc.requiredEmailDomain)) {
    throw new Error("Email domain not allowed")
  }
  return claims
}

export function verifySignedJwt(token: string, key: KeyLike | Uint8Array, issuer: string, audience: string) {
  return jwtVerify(token, key, { issuer, audience, algorithms: ["RS256"] })
}

export function userEmailUpdateData(email: string | undefined) {
  return email === undefined ? {} : { email, displayName: email }
}

export async function findOrCreateUser(claims: AuthClaims) {
  const issuer = String(claims.iss)
  const identity = await prisma.userIdentity.findUnique({ where: { issuer_subject: { issuer, subject: claims.sub } }, include: { user: true } })
  let existing = identity?.user
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: userEmailUpdateData(claims.email) })
    : await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: claims.email ?? null, displayName: claims.email ?? claims.sub } })
        await tx.userIdentity.create({ data: { userId: created.id, issuer, subject: claims.sub } })
        return created
      })

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
      const claims = await verifyOidcToken(token)
      if (requiredScope && !hasBearerAuthorization({ scopeText: claims.scope, resourceAccess: claims.resource_access, roleClientId: config.oidc.roleClientId, required: requiredScope })) {
        return res.status(403).json({ error: "insufficient_entitlement", requiredScope })
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

export function requirePermission(requiredScope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    if (!hasBearerAuthorization({ scopeText: req.auth.claims.scope, resourceAccess: req.auth.claims.resource_access, roleClientId: config.oidc.roleClientId, required: requiredScope })) {
      authChallenge(res, `Missing required scope ${requiredScope}`, requiredScope, "insufficient_scope")
      return res.status(403).json({ error: "insufficient_entitlement", requiredScope })
    }
    next()
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
