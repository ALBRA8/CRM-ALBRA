-- Mensajes canónicos ligados a una conversación exacta.
-- La organización y la conexión se derivan de ChannelConversation, evitando
-- duplicar tenant/connection IDs que podrían quedar inconsistentes.
-- Aditiva: no altera ni elimina WhatsAppMessage ni TimelineEvent.
CREATE TABLE "ChannelMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "externalMessageId" TEXT,
  "direction" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChannelConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelMessage_conversationId_externalMessageId_key"
  ON "ChannelMessage"("conversationId", "externalMessageId");
CREATE INDEX "ChannelMessage_conversationId_createdAt_idx"
  ON "ChannelMessage"("conversationId", "createdAt");
