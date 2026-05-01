import { prisma } from "../db/prisma.js"
import { loadSkill } from "./skillLoader.js"

const workflowSkill: Record<string, string[]> = {
  literature_check: ["core", "literature_check.md"],
  capture_new_problem: ["core", "proof_route_generation.md"],
  capture_from_chat: ["core", "weekly_digest.md"],
  novelty_check: ["core", "novelty_check.md"],
  generate_routes: ["core", "proof_route_generation.md"],
  attack_route: ["core", "proof_route_generation.md"],
  gap_analysis: ["core", "gap_analysis.md"],
  hostile_review: ["core", "hostile_referee.md"],
  counterexample_hunt: ["core", "counterexample_search.md"],
  experiment_design: ["core", "experiment_design.md"],
  paper_outline: ["core", "paper_outline.md"],
  weekly_digest: ["core", "weekly_digest.md"],
  lean_handoff: ["formalization", "lean_handoff.md"],
  lean_stub_generation: ["formalization", "lean_theorem_stub.md"],
  lean_proof_repair: ["formalization", "lean_proof_repair.md"],
  formalization_gap_analysis: ["formalization", "formalization_gap_analysis.md"]
}

const domainMap: Record<string, string[]> = {
  queueing: ["domains", "stochastic_processes", "queueing_theory.md"],
  martingales: ["domains", "stochastic_processes", "martingales.md"],
  branching: ["domains", "stochastic_processes", "branching_processes.md"],
  combinatorics: ["domains", "combinatorics", "extremal_graph_theory.md"],
  ramsey: ["domains", "combinatorics", "ramsey_theory.md"],
  additive_combinatorics: ["domains", "combinatorics", "additive_combinatorics.md"],
  number_theory: ["domains", "number_theory", "elementary_number_theory.md"]
}

export async function getSkillPack(workspaceId: string, nodeId: string | undefined, workflowType: string) {
  const node = nodeId ? await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId, nodeId } } }) : null
  const paths: string[][] = []
  if (workflowSkill[workflowType]) paths.push(workflowSkill[workflowType])
  if (workflowType === "literature_check") paths.push(["core", "novelty_check.md"])
  if (workflowType === "attack_route") paths.push(["core", "gap_analysis.md"], ["core", "counterexample_search.md"])
  if (["gap_analysis", "hostile_review"].includes(workflowType)) paths.push(["core", "gap_analysis.md"])
  if (node && ["proof_candidate", "informally_proved"].includes(node.status)) paths.push(["core", "hostile_referee.md"])
  if (node?.area && domainMap[node.area]) paths.push(domainMap[node.area])
  if (workflowType === "lean_proof_repair") paths.push(["formalization", "mathlib_search.md"], ["formalization", "axiom_hygiene.md"], ["formalization", "sorry_elimination.md"])
  if (workflowType.startsWith("lean") || workflowType.startsWith("formalization")) {
    paths.push(["formalization", "axiom_hygiene.md"], ["formalization", "sorry_elimination.md"])
  }

  const unique = [...new Map(paths.map((p) => [p.join("/"), p])).values()].slice(0, 4)
  const skills = []
  for (const p of unique) {
    const text = await loadSkill(p)
    if (text) skills.push({ path: p.join("/"), text: text.slice(0, 2500) })
  }
  return skills
}
