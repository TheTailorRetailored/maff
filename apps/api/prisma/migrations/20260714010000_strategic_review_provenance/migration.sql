ALTER TABLE "StrategicReviewRound"
ADD COLUMN "reviewerRunId" UUID;

CREATE INDEX "StrategicReviewRound_reviewerRunId_idx"
ON "StrategicReviewRound"("reviewerRunId");

ALTER TABLE "StrategicReviewRound"
ADD CONSTRAINT "StrategicReviewRound_reviewerRunId_fkey"
FOREIGN KEY ("reviewerRunId") REFERENCES "AgentRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
