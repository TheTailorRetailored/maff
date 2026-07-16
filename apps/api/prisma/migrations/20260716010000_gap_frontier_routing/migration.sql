ALTER TABLE "Gap"
ADD COLUMN "resolutionKind" "WorkstreamKind",
ADD COLUMN "resolutionRole" "AgentRole",
ADD COLUMN "frontierEligible" BOOLEAN NOT NULL DEFAULT true;
