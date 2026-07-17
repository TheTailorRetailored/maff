import { prisma } from "../db/prisma.js"
import { alignProjectReleaseState, assessProjectReleaseAlignment } from "../research/alignment.js"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const workspaceRef = valueAfter("--workspace")
const projectRef = valueAfter("--project")
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

try {
  const workspace = workspaceRef
    ? await prisma.workspace.findFirstOrThrow({ where: isUuid(workspaceRef) ? { id: workspaceRef } : { slug: workspaceRef } })
    : null
  const projects = await prisma.project.findMany({
    where: {
      ...(workspace ? { workspaceId: workspace.id } : {}),
      ...(projectRef ? isUuid(projectRef) ? { id: projectRef } : { slug: projectRef } : {})
    },
    orderBy: [{ workspaceId: "asc" }, { createdAt: "asc" }]
  })
  const results = []
  for (const project of projects) {
    const assessment = await assessProjectReleaseAlignment(project.workspaceId, project.id)
    const alignment = apply && assessment.requires_alignment
      ? await alignProjectReleaseState(project.workspaceId, project.id)
      : null
    results.push({
      workspace_id: project.workspaceId,
      project_id: project.id,
      project_slug: project.slug,
      classification: assessment.classification,
      requires_alignment: assessment.requires_alignment,
      requires_administrator: assessment.requires_administrator,
      action: alignment ? (alignment.idempotent ? "reused_existing_synthesis_workstream" : "created_synthesis_workstream") : apply ? "no_automatic_change" : "assessment_only",
      workstream_id: alignment?.workstream?.id ?? null
    })
  }
  console.log(JSON.stringify({ schema_version: "maff.release-alignment-report.v1", mode: apply ? "apply" : "assessment", project_count: results.length, results }, null, 2))
} finally {
  await prisma.$disconnect()
}
