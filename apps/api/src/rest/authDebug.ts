import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { prisma } from "../db/prisma.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerAuthDebugRoutes(router: Router) {
  router.get("/me", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    res.json({ user, workspaces: await prisma.workspace.findMany({ where: { members: { some: { userId: user.id } } } }) })
  }))
  router.get("/auth/debug-token", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const claims = req.auth!.claims
    res.json({
      valid_signature: true,
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      email: claims.email,
      scope: claims.scope,
      permissions: claims.permissions ?? [],
      expires_at: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      internal_user_id: user.id,
      workspaces: await prisma.workspace.findMany({ where: { members: { some: { userId: user.id } } } })
    })
  }))
}
