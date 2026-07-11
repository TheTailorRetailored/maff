import { prisma } from "../apps/api/src/db/prisma.js"

async function main() {
  const required = ["ResearchDelta", "Mechanism", "SpinoutCandidate", "AssumptionRegime", "TheoremContract", "ResearchFrontierSnapshot", "ResearchArtifact", "ResearchLink"]
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `
  const existing = new Set(rows.map((row) => row.table_name))
  const missing = required.filter((table) => !existing.has(table))
  if (missing.length) {
    throw new Error(`Research frontier migration is not fully applied. Missing tables: ${missing.join(", ")}`)
  }
  console.log(`Research frontier migration verified: ${required.length} tables present.`)
}

main().finally(async () => prisma.$disconnect())
