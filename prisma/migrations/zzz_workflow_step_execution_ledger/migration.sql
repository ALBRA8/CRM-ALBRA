-- Durable write-ahead ledger for workflow action execution.
CREATE TABLE "WorkflowStepExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationRunId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "output" TEXT,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "WorkflowStepExecution_automationRunId_fkey"
      FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowStepExecution_automationRunId_stepIndex_key"
  ON "WorkflowStepExecution"("automationRunId", "stepIndex");
CREATE INDEX "WorkflowStepExecution_status_startedAt_idx"
  ON "WorkflowStepExecution"("status", "startedAt");
ALTER TABLE "AutomationRun" ADD COLUMN "stepLedgerVersion" INTEGER NOT NULL DEFAULT 0;
