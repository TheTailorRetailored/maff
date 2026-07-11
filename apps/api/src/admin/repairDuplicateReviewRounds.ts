import { prisma } from "../db/prisma.js"

const args = process.argv.slice(2)
const value = (flag: string) => args[args.indexOf(flag) + 1]
const canonicalId = value("--canonical")
const duplicateIds = args.filter((arg, index) => args[index - 1] === "--duplicate")
const apply = args.includes("--apply")

if (!canonicalId || !duplicateIds.length) {
  throw new Error("Usage: tsx src/admin/repairDuplicateReviewRounds.ts --canonical <review-id> --duplicate <review-id> [--duplicate <review-id>] [--apply]")
}
if (new Set([canonicalId, ...duplicateIds]).size !== duplicateIds.length + 1) throw new Error("Canonical and duplicate review IDs must be distinct.")

const reviews = await prisma.reviewRound.findMany({ where: { id: { in: [canonicalId, ...duplicateIds] } } })
if (reviews.length !== duplicateIds.length + 1) throw new Error("Every supplied review ID must exist.")
const canonical = reviews.find((review) => review.id === canonicalId)!
const signature = (review: typeof canonical) => JSON.stringify({
  workspaceId: review.workspaceId,
  projectId: review.projectId,
  workstreamId: review.workstreamId,
  reportId: review.reportId,
  reviewerRole: review.reviewerRole,
  verdict: review.verdict,
  reviewType: review.reviewType,
  targetVersion: review.targetVersion,
  bodyMarkdown: review.bodyMarkdown,
  checkedRefs: review.checkedRefs
})
const expected = signature(canonical)
const mismatches = reviews.filter((review) => signature(review) !== expected)
if (mismatches.length) throw new Error(`Refusing repair: supplied rows are not identical review submissions: ${mismatches.map((review) => review.id).join(", ")}`)

const result = { canonical_review_id: canonicalId, duplicate_review_ids: duplicateIds, apply, deleted: 0 }
if (apply) {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.reviewRound.deleteMany({ where: { id: { in: duplicateIds }, workspaceId: canonical.workspaceId } })
    await tx.auditLog.create({ data: { workspaceId: canonical.workspaceId, action: "repair_duplicate_review_rounds", targetType: "ReviewRound", targetId: canonicalId, details: { canonicalReviewId: canonicalId, removedDuplicateReviewIds: duplicateIds } } })
    result.deleted = deleted.count
  })
}
console.log(JSON.stringify(result, null, 2))
await prisma.$disconnect()
