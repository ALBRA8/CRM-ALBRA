-- Migración aditiva (expand) — UNIFICACIÓN 2026-11-21
-- Columnas canónicas nuevas + tabla GoogleIntegration. NO destructiva.
-- Orden seguro en producción: aplicar esta, correr el backfill TS
-- (scripts/backfill-whatsapp-history-to-channel.mjs) y por último la
-- migración destructiva zzzzzzzz_drop_legacy_channel_models.

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN "webhookSecretHash" TEXT;

-- AlterTable
ALTER TABLE "ChannelConversation" ADD COLUMN "metadata" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "agentLeadsSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "GoogleIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "googleRefreshTokenEnc" TEXT,
    "googleClientJsonEnc" TEXT,
    "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleIntegration_organizationId_key" ON "GoogleIntegration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_webhookSecretHash_key" ON "ChannelConnection"("webhookSecretHash");