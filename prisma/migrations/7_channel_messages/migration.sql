-- Mensajes canónicos ligados a una conversación y conexión exactas.
-- Aditiva: no altera ni elimina WhatsAppMessage ni TimelineEvent.
CREATE TABLE "ChannelMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "externalMessageId" TEXT,
  "direction" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelMessage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelMessage_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChannelConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelMessage_connectionId_externalMessageId_key"
  ON "ChannelMessage"("connectionId", "externalMessageId");
CREATE INDEX "ChannelMessage_conversationId_createdAt_idx"
  ON "ChannelMessage"("conversationId", "createdAt");
CREATE INDEX "ChannelMessage_organizationId_createdAt_idx"
  ON "ChannelMessage"("organizationId", "createdAt");
CREATE INDEX "ChannelMessage_connectionId_createdAt_idx"
  ON "ChannelMessage"("connectionId", "createdAt");
