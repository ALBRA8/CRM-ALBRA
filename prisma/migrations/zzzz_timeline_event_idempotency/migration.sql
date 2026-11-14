-- Stable provider event key prevents duplicate timeline entries after webhook retries.
ALTER TABLE "TimelineEvent" ADD COLUMN "sourceEventKey" TEXT;
CREATE UNIQUE INDEX "TimelineEvent_organizationId_sourceEventKey_key"
  ON "TimelineEvent"("organizationId", "sourceEventKey");
