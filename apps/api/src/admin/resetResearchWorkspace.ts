import fs from "node:fs/promises"
import path from "node:path"
import { prisma } from "../db/prisma.js"
import { assertInsideRoot, vaultRoot } from "../vault/paths.js"

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const apply = process.argv.includes("--apply")
const keepMarkdown = process.argv.includes("--keep-markdown")
const workspaceRef = argValue("--workspace")

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function findWorkspace() {
  if (!workspaceRef) throw new Error("--workspace <id-or-slug> is required. This command never wipes all workspaces implicitly.")
  const workspace = await prisma.workspace.findFirst({ where: isUuid(workspaceRef) ? { id: workspaceRef } : { slug: workspaceRef } })
  if (!workspace) throw new Error(`No workspace found for ${workspaceRef}`)
  return workspace
}

async function legacyMarkdownFiles(workspace: { id: string; slug: string }) {
  const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId: workspace.id }, select: { path: true } })
  const root = vaultRoot(workspace.slug)
  return nodes.map((node) => assertInsideRoot(root, path.join(root, node.path)))
}

async function counts(workspaceId: string) {
  const [
    projects,
    goals,
    workstreams,
    agentRuns,
    messages,
    reports,
    reviews,
    artifacts,
    claims,
    proofRoutes,
    proofAttempts,
    gaps,
    counterexamples,
    experiments,
    papers,
    knownResults,
    assumptions,
    formalizationTargets,
    leanTheorems,
    graphEdges,
    mathObjects,
    jobs,
    localTheorems,
    nodeIndex,
    edgeIndex,
    taskIndex
  ] = await Promise.all([
    prisma.project.count({ where: { workspaceId } }),
    prisma.projectGoal.count({ where: { workspaceId } }),
    prisma.workstream.count({ where: { workspaceId } }),
    prisma.agentRun.count({ where: { workspaceId } }),
    prisma.agentMessage.count({ where: { workspaceId } }),
    prisma.workstreamReport.count({ where: { workspaceId } }),
    prisma.reviewRound.count({ where: { workspaceId } }),
    prisma.artifact.count({ where: { workspaceId } }),
    prisma.claim.count({ where: { workspaceId } }),
    prisma.proofRoute.count({ where: { workspaceId } }),
    prisma.proofAttempt.count({ where: { workspaceId } }),
    prisma.gap.count({ where: { workspaceId } }),
    prisma.counterexample.count({ where: { workspaceId } }),
    prisma.experiment.count({ where: { workspaceId } }),
    prisma.paper.count({ where: { workspaceId } }),
    prisma.knownResult.count({ where: { workspaceId } }),
    prisma.assumption.count({ where: { workspaceId } }),
    prisma.formalizationTarget.count({ where: { workspaceId } }),
    prisma.leanTheorem.count({ where: { workspaceId } }),
    prisma.graphEdge.count({ where: { workspaceId } }),
    prisma.mathObject.count({ where: { workspaceId } }),
    prisma.job.count({ where: { workspaceId } }),
    prisma.localTheorem.count({ where: { workspaceId } }),
    prisma.nodeIndex.count({ where: { workspaceId } }),
    prisma.edgeIndex.count({ where: { workspaceId } }),
    prisma.taskIndex.count({ where: { workspaceId } })
  ])
  return { projects, goals, workstreams, agentRuns, messages, reports, reviews, artifacts, claims, proofRoutes, proofAttempts, gaps, counterexamples, experiments, papers, knownResults, assumptions, formalizationTargets, leanTheorems, graphEdges, mathObjects, jobs, localTheorems, nodeIndex, edgeIndex, taskIndex }
}

async function wipe(workspaceId: string) {
  const deleted: Record<string, number> = {}
  async function del(name: string, run: Promise<{ count: number }>) {
    deleted[name] = (await run).count
  }

  await prisma.$transaction(async (tx) => {
    await del("reviewRounds", tx.reviewRound.deleteMany({ where: { workspaceId } }))
    await del("artifacts", tx.artifact.deleteMany({ where: { workspaceId } }))
    await del("agentRuns", tx.agentRun.deleteMany({ where: { workspaceId } }))
    await del("reports", tx.workstreamReport.deleteMany({ where: { workspaceId } }))
    await del("messages", tx.agentMessage.deleteMany({ where: { workspaceId } }))
    await del("graphEdges", tx.graphEdge.deleteMany({ where: { workspaceId } }))
    await del("leanTheorems", tx.leanTheorem.deleteMany({ where: { workspaceId } }))
    await del("formalizationTargets", tx.formalizationTarget.deleteMany({ where: { workspaceId } }))
    await del("assumptions", tx.assumption.deleteMany({ where: { workspaceId } }))
    await del("knownResults", tx.knownResult.deleteMany({ where: { workspaceId } }))
    await del("papers", tx.paper.deleteMany({ where: { workspaceId } }))
    await del("experiments", tx.experiment.deleteMany({ where: { workspaceId } }))
    await del("counterexamples", tx.counterexample.deleteMany({ where: { workspaceId } }))
    await del("gaps", tx.gap.deleteMany({ where: { workspaceId } }))
    await del("proofAttempts", tx.proofAttempt.deleteMany({ where: { workspaceId } }))
    await del("proofRoutes", tx.proofRoute.deleteMany({ where: { workspaceId } }))
    await del("claims", tx.claim.deleteMany({ where: { workspaceId } }))
    await del("mathObjects", tx.mathObject.deleteMany({ where: { workspaceId } }))
    await del("workstreams", tx.workstream.deleteMany({ where: { workspaceId } }))
    await del("goals", tx.projectGoal.deleteMany({ where: { workspaceId } }))
    await del("projects", tx.project.deleteMany({ where: { workspaceId } }))
    await del("jobs", tx.job.deleteMany({ where: { workspaceId } }))
    await del("localTheorems", tx.localTheorem.deleteMany({ where: { workspaceId } }))
    await del("taskIndex", tx.taskIndex.deleteMany({ where: { workspaceId } }))
    await del("edgeIndex", tx.edgeIndex.deleteMany({ where: { workspaceId } }))
    await del("nodeIndex", tx.nodeIndex.deleteMany({ where: { workspaceId } }))
  })
  return deleted
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.")
  const workspace = await findWorkspace()
  const before = await counts(workspace.id)
  const markdownFiles = await legacyMarkdownFiles(workspace)
  let deleted: Record<string, number> = {}
  if (apply) {
    deleted = await wipe(workspace.id)
    if (!keepMarkdown) {
      for (const file of markdownFiles) await fs.rm(file, { force: true })
    }
  }
  const after = apply ? await counts(workspace.id) : undefined
  console.log(JSON.stringify({
    apply,
    keepMarkdown,
    workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
    before,
    deleted,
    markdownFilesRemoved: apply && !keepMarkdown ? markdownFiles.length : 0,
    after
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
