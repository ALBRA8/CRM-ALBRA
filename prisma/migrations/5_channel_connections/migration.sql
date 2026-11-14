-- Fase 0: modelo canónico aditivo para conexiones multicuenta.
-- No modifica ni elimina Integration, WhatsAppConnection ni datos existentes.

CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountKey" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scopes" TEXT,
    "credentialsEnc" TEXT NOT NULL,
    "metadata" TEXT,
    "tokenExpiresAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelConnection_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChannelConnection_providerAccountKey_key"
  ON "ChannelConnection"("providerAccountKey");
CREATE INDEX "ChannelConnection_organizationId_channel_status_idx"
  ON "ChannelConnection"("organizationId", "channel", "status");
CREATE INDEX "ChannelConnection_organizationId_createdAt_idx"
  ON "ChannelConnection"("organizationId", "createdAt");
CREATE INDEX "ChannelConnection_provider_externalAccountId_idx"
  ON "ChannelConnection"("provider", "externalAccountId");

CREATE TABLE "ChannelConnectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelConnectionEvent_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelConnectionEvent_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ChannelConnectionEvent_organizationId_createdAt_idx"
  ON "ChannelConnectionEvent"("organizationId", "createdAt");
CREATE INDEX "ChannelConnectionEvent_connectionId_createdAt_idx"
  ON "ChannelConnectionEvent"("connectionId", "createdAt");
