import { prisma } from "../db/prisma.js"

const apply = process.argv.includes("--apply")
const workspaceArg = process.argv.find((value) => value.startsWith("--workspace="))?.slice("--workspace=".length)
const ephemeralPath = /^(?:\/mnt\/data|\/tmp|\/var\/tmp)(?:\/|$)|^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp(?:\\|$)/i
const physicalClaim = /\b(?:physical (?:file|artifact|output)|generated (?:file|archive|zip|pdf|manuscript)|registered (?:the )?(?:exact )?(?:physical )?artifact|compiled (?:pdf|manuscript))\b/i

const records = await prisma.researchArtifact.findMany({
  where: { workspaceId: workspaceArg, filePath: { not: null } },
  include: { physicalArtifacts: true, manuscriptVersions: true }
})

const diagnostics = []
for (const record of records) {
  if (!record.filePath || !ephemeralPath.test(record.filePath) || record.physicalArtifacts.some((artifact) => artifact.storageKey)) continue
  const dependentReports = await prisma.workstreamReport.findMany({ where: { workspaceId: record.workspaceId, OR: [{ artifactRefs: { array_contains: [record.id] } }, { bodyMarkdown: { contains: record.filePath } }] }, select: { id: true, workstreamId: true, bodyMarkdown: true, status: true } })
  const reportClaimsPhysical = dependentReports.some((report) => physicalClaim.test(report.bodyMarkdown))
  const diagnostic = {
    research_artifact_id: record.id,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    ephemeral_path: record.filePath,
    durable_artifact_count: 0,
    manuscript_version_ids: record.manuscriptVersions.map((version) => version.id),
    dependent_reports: dependentReports.map((report) => ({ id: report.id, workstream_id: report.workstreamId, status: report.status })),
    report_claims_physical_output: reportClaimsPhysical,
    disposition: "requires_regeneration"
  }
  diagnostics.push(diagnostic)
  if (apply) await prisma.$transaction([
    prisma.researchArtifact.update({ where: { id: record.id }, data: { fileStatus: "requires_regeneration", fileDiagnostic: "Ephemeral local path was never ingested; bytes are unavailable and must be regenerated as a new exact artifact/version." } }),
    prisma.manuscriptVersion.updateMany({ where: { workspaceId: record.workspaceId, artifactId: record.id }, data: { verificationState: "unverified_candidate", isCanonical: false } })
  ])
}

console.log(JSON.stringify({ mode: apply ? "apply" : "diagnostic", count: diagnostics.length, records: diagnostics }, null, 2))
await prisma.$disconnect()
