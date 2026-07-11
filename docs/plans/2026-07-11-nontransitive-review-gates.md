# Non-Transitive Research Review Gates Implementation Plan

> **For Hermes:** Implement this plan with test-first vertical slices.

**Goal:** Make mathematical approval scoped, version-aware, non-transitive, and centrally enforced for canonical working papers.

**Architecture:** Add a small durable manuscript/review layer beside existing `ResearchArtifact`, `ReviewRound`, `Gap`, `ResearchLink`, and `Workstream`. `ManuscriptVersion` owns canonical paper state; `ProofObligation` and `ReviewObligationCheck` provide integration coverage; `ReviewRound` gets typed/versioned scope; `computeSubmissionReadiness` is the single authoritative gate and dependency-closure calculation. Existing generic links express source artifacts, claims, physical derivatives, and gap relevance.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, MCP server, existing API runtime smoke harness.

---

### Task 1: Persist scoped review and manuscript state

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260711000000_nontransitive_review_gates/migration.sql`

Add review type/independence/scope/version fields with conservative legacy defaults; add `ManuscriptVersion`, `ProofObligation`, `ReviewObligationCheck`, and `WorkstreamDependency`. Keep old records readable.

### Task 2: Centralize policy and readiness computation

**Files:**
- Create: `apps/api/src/research/readiness.ts`
- Modify: `apps/api/src/research/runtime.ts`

Compute required version-specific gates, clause-level novelty coverage, obligation coverage, relevant graph-gap closure, staleness, dependencies, and suggested ready work. Do not infer approval from parent artifacts or workstream counts.

### Task 3: Add version-aware runtime operations

**Files:**
- Modify: `apps/api/src/research/runtime.ts`

Create/update canonical manuscript versions, proof obligations, scoped reviews, dependencies, and revision propagation transactionally. Any substantive manuscript update supersedes current version and leaves old reviews historical.

### Task 4: Expose generic MCP operations and richer control room

**Files:**
- Modify: `apps/api/src/mcp/server.ts`
- Modify: `apps/api/src/rest/research.ts`
- Modify: `apps/web/src/api/client.ts`

Extend `record_review_round`; expose manuscript, obligation, dependency, and readiness reads/writes; return gate matrices and blocking paths in the control room while preserving existing calls.

### Task 5: Fix mathematical briefing scope

**Files:**
- Modify: `apps/api/prompts/roles/hostile_reviewer.md`
- Modify: `apps/api/prompts/roles/paper_writer.md`
- Modify: `apps/api/src/research/runtime.ts`

Require integration and end-to-end reviewers to reopen mathematics and inspect complete sources. Mechanical compile/fidelity reviews explicitly state their limited scope.

### Task 6: Add regression/integration coverage and documentation

**Files:**
- Create: `apps/api/src/nontransitiveReviewGates.test.ts`
- Modify: `apps/api/src/smokeRuntimeDb.ts`
- Create: `docs/architecture/nontransitive-review-gates.md`
- Create: `docs/verification/mmrw-nontransitive-gate-verification.md`

Use a miniature pipeline plus MMRW-style fixture to prove source approvals and compile cleanliness cannot approve an integrated manuscript; inspect live MMRW via control-room computation.
