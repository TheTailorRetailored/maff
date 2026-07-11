import { runLegacyDistillationApply } from "../apps/api/src/research/runtime.js"
import { prisma } from "../apps/api/src/db/prisma.js"

async function main() {
  const workspaceId = process.argv[2] ?? (await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id
  const result = await runLegacyDistillationApply({ workspaceId })
  console.log(JSON.stringify(result, null, 2))
}

main().finally(async () => prisma.$disconnect())
