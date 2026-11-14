-- Allow durable outbox intents originating from provider webhooks, not only automation runs.
-- SQLite table rebuild keeps existing workflow-originated rows and indexes intact.
CREATE TABLE "new_WorkflowOutboundMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "automationId" TEXT,
  "automationRunId" TEXT,
  "stepIndex" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "payloadEnc" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimToken" TEXT,
  "providerMessageId" TEXT,
  "providerErrorCode" TEXT,
  "startedAt" DATETIME,
  "sentAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WorkflowOutboundMessage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_WorkflowOutboundMessage" (
  "id", "organizationId", "automationId", "automationRunId", "stepIndex",
  "idempotencyKey", "channel", "payloadEnc", "status", "attemptCount",
  "claimToken", "providerMessageId", "providerErrorCode", "startedAt",
  "sentAt", "finishedAt", "createdAt", "updatedAt"
)
SELECT
  "id", "organizationId", "automationId", "automationRunId", "stepIndex",
  "idempotencyKey", "channel", "payloadEnc", "status", "attemptCount",
  "claimToken", "providerMessageId", "providerErrorCode", "startedAt",
  "sentAt", "finishedAt", "createdAt", "updatedAt"
FROM "WorkflowOutboundMessage";

DROP TABLE "WorkflowOutboundMessage";
ALTER TABLE "new_WorkflowOutboundMessage" RENAME TO "WorkflowOutboundMessage";

CREATE UNIQUE INDEX "WorkflowOutboundMessage_organizationId_idempotencyKey_key"
  ON "WorkflowOutboundMessage"("organizationId", "idempotencyKey");
CREATE INDEX "WorkflowOutboundMessage_status_createdAt_idx"
  ON "WorkflowOutboundMessage"("status", "createdAt");
CREATE INDEX "WorkflowOutboundMessage_organizationId_createdAt_idx"
  ON "WorkflowOutboundMessage"("organizationId", "createdAt");
CREATE INDEX "WorkflowOutboundMessage_automationRunId_stepIndex_idx"
  ON "WorkflowOutboundMessage"("automationRunId", "stepIndex");
