import fs from "node:fs/promises"
import path from "node:path"
import { prisma } from "../db/prisma.js"
import { parseMarkdownFile } from "../vault/parser.js"
import { assertInsideRoot, vaultRoot } from "../vault/paths.js"
import * as runtime from "../research/runtime.js"

const seedProblemIds = new Set([
  "problem-product-condition-cutoff",
  "problem-galton-watson-conductance-regularity",
  "problem-distributional-predictions-in-queues"
])

const seedProblemTitles = [
  "product condition cutoff",
  "absolute continuity of effective conductance on supercritical galton-watson trees",
  "robust posterior-gittins scheduling with distributional service-time predictions"
]

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const apply = process.argv.includes("--apply")
const includeSeeds = process.argv.includes("--include-seeds")
const includeTestData = process.argv.includes("--include-test-data")
const keepMarkdown = process.argv.includes("--keep-markdown")
const workspaceRef = argValue("--workspace")

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `legacy-${Date.now()}`
}

function section(body: string, name: string) {
  const pattern = new RegExp(`(^|\\n)##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i")
  return body.match(pattern)?.[2]?.trim()
}

function cleanTitle(title: string) {
  return title.replace(/^Problem\s*-\s*/i, "").trim() || title
}

function isDisposableLegacyProblem(title: string, body: string) {
  return /\b(TEST|SMOKE|DISPOSABLE)\b/i.test(`${title}\n${body}`)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isSeedProblem(node: { nodeId: string; title: string; path: string; bodyPreview: string; metadata: unknown }, parsedTitle: string, body: string) {
  const metadata = node.metadata as Record<string, unknown>
  const metadataId = String(metadata.id ?? metadata.node_id ?? "")
  const title = cleanTitle(parsedTitle || node.title).toLowerCase()
  return seedProblemIds.has(node.nodeId)
    || seedProblemIds.has(metadataId)
    || seedProblemIds.has(path.basename(node.path, ".md"))
    || seedProblemTitles.some((seedTitle) => title.includes(seedTitle))
    || /Seeded by Maff first-run initialization/i.test(body)
}

async function findWorkspaces() {
  if (!workspaceRef) return prisma.workspace.findMany({ orderBy: { createdAt: "asc" } })
  const workspace = await prisma.workspace.findFirst({
    where: isUuid(workspaceRef) ? { id: workspaceRef } : { slug: workspaceRef }
  })
  return workspace ? [workspace] : []
}

async function readLegacyProblem(workspaceSlug: string, node: { nodeId: string; title: string; path: string; bodyPreview: string; area: string | null; metadata: unknown }) {
  const root = vaultRoot(workspaceSlug)
  const file = assertInsideRoot(root, path.join(root, node.path))
  try {
    const parsed = await parseMarkdownFile(file)
    return {
      file,
      title: cleanTitle(parsed.title),
      area: String(parsed.metadata.area ?? node.area ?? "general"),
      statement: section(parsed.body, "Statement") ?? parsed.body.trim() ?? node.bodyPreview,
      motivation: section(parsed.body, "Motivation") ?? "",
      seeded: isSeedProblem(node, parsed.title, parsed.body),
      disposable: isDisposableLegacyProblem(parsed.title, parsed.body)
    }
  } catch {
    return {
      file,
      title: cleanTitle(node.title),
      area: node.area ?? "general",
      statement: node.bodyPreview || node.title,
      motivation: "",
      seeded: isSeedProblem(node, node.title, node.bodyPreview),
      disposable: isDisposableLegacyProblem(node.title, node.bodyPreview)
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.")

  const workspaces = await findWorkspaces()
  if (!workspaces.length) throw new Error(workspaceRef ? `No workspace found for ${workspaceRef}` : "No workspaces found.")

  const summary = []
  for (const workspace of workspaces) {
    const legacyProblems = await prisma.nodeIndex.findMany({
      where: { workspaceId: workspace.id, type: "Problem", stale: false },
      orderBy: { createdAtFromFrontmatter: "asc" }
    })
    const candidates = []
    const skipped = []
    for (const node of legacyProblems) {
      const problem = await readLegacyProblem(workspace.slug, node)
      if (problem.seeded && !includeSeeds) {
        skipped.push({ nodeId: node.nodeId, title: problem.title, reason: "seed" })
        continue
      }
      if (problem.disposable && !includeTestData) {
        skipped.push({ nodeId: node.nodeId, title: problem.title, reason: "test_data" })
        continue
      }
      candidates.push({ node, problem })
    }

    const legacyNodes = await prisma.nodeIndex.findMany({ where: { workspaceId: workspace.id } })
    const markdownFiles = legacyNodes.map((node) => {
      const root = vaultRoot(workspace.slug)
      return assertInsideRoot(root, path.join(root, node.path))
    })

    const created = []
    if (apply) {
      for (const { node, problem } of candidates) {
        const slug = `legacy-${slugify(node.nodeId)}`
        const existing = await prisma.project.findUnique({ where: { workspaceId_slug: { workspaceId: workspace.id, slug } } })
        if (existing) {
          created.push({ projectId: existing.id, title: existing.title, skipped: "already_exists" })
          continue
        }
        const project = await runtime.createProject({
          workspaceId: workspace.id,
          slug,
          title: problem.title,
          area: problem.area,
          statement: problem.statement
        })
        await runtime.updateProjectSummary({
          workspaceId: workspace.id,
          projectId: project.id,
          coordinatorSummary: `Recreated from a pre-v2 problem note. Original motivation: ${problem.motivation || "not recorded"}`
        })
        const proposedGoal = await runtime.proposeProjectGoal({
          workspaceId: workspace.id,
          projectId: project.id,
          title: "Clarify and attack the question",
          statement: problem.statement,
          priority: 10,
          successCriteria: ["Precise statement captured", "Initial literature check completed", "At least two proof or disproof routes reviewed"]
        })
        const goal = await runtime.approveProjectGoal({ workspaceId: workspace.id, goalId: proposedGoal.id })
        await runtime.createArtifact({
          workspaceId: workspace.id,
          projectId: project.id,
          kind: "markdown",
          title: `Original note: ${node.title}`,
          path: problem.file,
          metadata: { legacyNodeId: node.nodeId, legacyPath: node.path }
        })
        await runtime.createWorkstream({
          workspaceId: workspace.id,
          projectId: project.id,
          goalId: goal.id,
          title: "Literature review",
          kind: "literature_review",
          priority: 3,
          instructions: "Translate the question into alternate terminology, create Paper and KnownResult objects, and report novelty evidence without marking novelty settled."
        })
        await runtime.createWorkstream({
          workspaceId: workspace.id,
          projectId: project.id,
          goalId: goal.id,
          title: "Generate proof and disproof routes",
          kind: "proof_route_generation",
          priority: 2,
          instructions: "Create a precise Claim and at least two ProofRoute objects, including one counterexample/disproof route, then submit a report for review."
        })
        await runtime.createWorkstream({
          workspaceId: workspace.id,
          projectId: project.id,
          goalId: goal.id,
          title: "Gap analysis",
          kind: "gap_analysis",
          priority: 1,
          instructions: "Turn any vague blockers in the original note into explicit Gap objects with severity and smallest next steps."
        })
        created.push({ projectId: project.id, title: project.title })
      }

      await prisma.taskIndex.deleteMany({ where: { workspaceId: workspace.id } })
      await prisma.edgeIndex.deleteMany({ where: { workspaceId: workspace.id } })
      await prisma.nodeIndex.deleteMany({ where: { workspaceId: workspace.id } })
      if (!keepMarkdown) {
        for (const file of markdownFiles) {
          await fs.rm(file, { force: true })
        }
      }
    }

    summary.push({
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      legacyProblemsFound: legacyProblems.length,
      recreatedProblemCount: candidates.length,
      skippedProblemCount: skipped.length,
      skippedProblems: skipped,
      recreatedProjects: created,
      markdownFilesRemoved: apply && !keepMarkdown ? markdownFiles.length : 0,
      oldNodeIndexRecordsRemoved: apply ? legacyNodes.length : 0,
      mode: apply ? "applied" : "preview"
    })
  }

  console.log(JSON.stringify({ apply, includeSeeds, includeTestData, keepMarkdown, summary }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
