import path from "node:path"
import { buildLegacyDistillationPreview, runLegacyDistillationPreview } from "../apps/api/src/research/runtime.js"
import { prisma } from "../apps/api/src/db/prisma.js"

async function main() {
  const workspaceId = process.argv[2] ?? (await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outputPath = process.argv[3] ?? path.resolve("artifacts", `legacy-distill-preview-${stamp}.md`)
  const result = await runLegacyDistillationPreview({ workspaceId, outputPath })
  const preview = await buildLegacyDistillationPreview(workspaceId)
  console.log(JSON.stringify({ outputPath: result.outputPath, projects: preview.proposals.length, writes: 0 }, null, 2))
}

main().finally(async () => prisma.$disconnect())
