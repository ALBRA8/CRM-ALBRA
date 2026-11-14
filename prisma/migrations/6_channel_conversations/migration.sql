-- Conversaciones canónicas: una identidad de contacto por conexión externa.
-- No se migran conversaciones legacy aquí: su conexión histórica puede ser ambigua.
CREATE TABLE "ChannelConversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "externalContactKey" TEXT NOT NULL,
  "contactName" TEXT,
  "lastMessage" TEXT,
  "lastMessageAt" DATETIME,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChannelConversation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelConversation_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelConversation_connectionId_externalContactKey_key"
  ON "ChannelConversation"("connectionId", "externalContactKey");
CREATE INDEX "ChannelConversation_organizationId_channel_lastMessageAt_idx"
  ON "ChannelConversation"("organizationId", "channel", "lastMessageAt");
CREATE INDEX "ChannelConversation_connectionId_lastMessageAt_idx"
  ON "ChannelConversation"("connectionId", "lastMessageAt");
