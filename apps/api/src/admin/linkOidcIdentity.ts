import { prisma } from "../db/prisma.js"

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const userId = argument("user-id")
const approvedByUserId = argument("approved-by-user-id")
const issuer = argument("issuer")
const subject = argument("subject")

if (!userId || !approvedByUserId || !issuer || !subject) {
  throw new Error("Usage: --user-id <uuid> --approved-by-user-id <uuid> --issuer <exact issuer> --subject <exact subject>")
}
if (issuer.endsWith("/") || new URL(issuer).protocol !== "https:") throw new Error("Issuer must be an exact HTTPS issuer without a trailing slash")

await prisma.$transaction(async (tx) => {
  await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } })
  await tx.user.findUniqueOrThrow({ where: { id: approvedByUserId }, select: { id: true } })
  const existing = await tx.userIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } })
  if (existing && existing.userId !== userId) throw new Error("External identity is already linked to another internal user")
  const identity = existing ?? await tx.userIdentity.create({ data: { userId, issuer, subject } })
  await tx.auditLog.create({
    data: {
      userId: approvedByUserId,
      action: "identity.oidc.link",
      targetType: "UserIdentity",
      targetId: identity.id,
      details: { linkedUserId: userId, issuer, procedure: "explicit-approved-link" }
    }
  })
})

console.log("OIDC identity link completed and audited")
await prisma.$disconnect()
