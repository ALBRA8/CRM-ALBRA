-- Durable scheduler lease/fencing metadata.
-- The monotonic fencingVersion is incremented on every successful claim.
ALTER TABLE "AutomationRun" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "AutomationRun" ADD COLUMN "fencingVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AutomationRun_status_leaseExpiresAt_idx"
  ON "AutomationRun"("status", "leaseExpiresAt");
