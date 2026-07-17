import { prisma } from "../db/prisma.js"
import { assessLegacyManuscriptLineageQuarantine, quarantineLegacyManuscriptLineage } from "../research/legacyLineage.js"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")
const args = process.argv.slice(2)
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const workspaceRef = valueAfter("--workspace")
const projectRef = valueAfter("--project")
const apply = args.includes("--apply")
if (!workspaceRef || !projectRef) throw new Error("Both --workspace and --project are required; fleet-wide quarantine is intentionally unsupported.")
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

try {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: isUuid(workspaceRef) ? { id: workspaceRef } : { slug: workspaceRef } })
  const project = await prisma.project.findFirstOrThrow({ where: { workspaceId: workspace.id, ...(isUuid(projectRef) ? { id: projectRef } : { slug: projectRef }) } })
  const result = apply
    ? await quarantineLegacyManuscriptLineage(workspace.id, project.id)
    : await assessLegacyManuscriptLineageQuarantine(workspace.id, project.id)
  console.log(JSON.stringify({
    schema_version: "maff.legacy-manuscript-lineage-quarantine-report.v1",
    mode: apply ? "apply" : "assessment",
    workspace_id: workspace.id,
    project_id: project.id,
    project_slug: project.slug,
    result
  }, null, 2))
} finally {
  await prisma.$disconnect()
}

