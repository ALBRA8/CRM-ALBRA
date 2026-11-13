-- Durable, tenant-scoped outbox for workflow-originated external messages.
CREATE TABLE "WorkflowOutboundMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "automationId" TEXT,
  "automationRunId" TEXT NOT NULL,
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
  CONSTRAINT "WorkflowOutboundMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowOutboundMessage_organizationId_idempotencyKey_key" ON "WorkflowOutboundMessage"("organizationId", "idempotencyKey");
CREATE INDEX "WorkflowOutboundMessage_status_createdAt_idx" ON "WorkflowOutboundMessage"("status", "createdAt");
CREATE INDEX "WorkflowOutboundMessage_organizationId_createdAt_idx" ON "WorkflowOutboundMessage"("organizationId", "createdAt");
CREATE INDEX "WorkflowOutboundMessage_automationRunId_stepIndex_idx" ON "WorkflowOutboundMessage"("automationRunId", "stepIndex");
