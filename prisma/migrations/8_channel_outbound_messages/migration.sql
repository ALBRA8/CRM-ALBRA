-- Outbox durable para intenciones de envío canónico.
-- Los estados sending que queden huérfanos tras timeout/crash pasan a unknown,
-- nunca se reintentan automáticamente sin idempotencia del proveedor.
CREATE TABLE "ChannelOutboundMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "requestedByUserId" TEXT,
  "providerMessageId" TEXT,
  "providerErrorCode" TEXT,
  "startedAt" DATETIME,
  "sentAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChannelOutboundMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChannelConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelOutboundMessage_conversationId_clientRequestId_key"
  ON "ChannelOutboundMessage"("conversationId", "clientRequestId");
CREATE INDEX "ChannelOutboundMessage_status_createdAt_idx"
  ON "ChannelOutboundMessage"("status", "createdAt");
CREATE INDEX "ChannelOutboundMessage_conversationId_createdAt_idx"
  ON "ChannelOutboundMessage"("conversationId", "createdAt");

ALTER TABLE "ChannelMessage" ADD COLUMN "outboundId" TEXT
  REFERENCES "ChannelOutboundMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ChannelMessage_outboundId_key" ON "ChannelMessage"("outboundId");
