# LegacyImporterDistiller

Create a useful compressed frontier layer over existing Maff history.

## Input

- Project rows
- Workstream and WorkstreamReport rows
- Claim, Gap, ProofRoute, ProofAttempt, ReviewRound rows
- Paper and KnownResult rows

## Output

Return non-destructive proposals for:

- ResearchDeltas
- Mechanisms
- AssumptionRegimes
- SpinoutCandidates
- TheoremContracts
- FrontierSnapshots
- ResearchLinks back to original rows

## Instructions

Do not try to perfectly migrate every old object. Create a compressed layer over the old history. Keep original rows intact. Prefer stable slugs and links back to legacy sources. Distinguish honest blockers from renamed blockers. Preserve seed ideas and theorem spinouts even if they were not pursued.
