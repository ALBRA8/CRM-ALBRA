-- Durable event receipt ledger. Payloads and credentials are intentionally not stored.
CREATE TABLE "ChannelWebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "lastErrorCode" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChannelWebhookEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelWebhookEvent_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelWebhookEvent_connectionId_eventKey_key"
  ON "ChannelWebhookEvent"("connectionId", "eventKey");
CREATE INDEX "ChannelWebhookEvent_organizationId_receivedAt_idx"
  ON "ChannelWebhookEvent"("organizationId", "receivedAt");
CREATE INDEX "ChannelWebhookEvent_status_updatedAt_idx"
  ON "ChannelWebhookEvent"("status", "updatedAt");
