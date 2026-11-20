-- Migración destructiva (contract) — UNIFICACIÓN 2026-11-21
-- Backfill de datos + DROP de Integration, WhatsAppConnection(±Event),
-- WhatsAppConversation y WhatsAppMessage. El backfill corre ANTES de los DROP:
-- CERO PÉRDIDA incluso si no se ejecutó el backfill TS.


-- ============================================================
-- BACKFILL DE DATOS (cero pérdida) — ANTES de los DROP legacy
-- Si el backfill TS ya corrió, los INSERT OR IGNORE no duplican nada.
-- Los IDs canónicos se RESUELVEN por providerAccountKey (no se asumen),
-- así el backfill SQL coexiste con filas creadas por el script TS o el daemon.
-- ============================================================

-- 1) Google: Integration → GoogleIntegration (tokens cifrados se copian tal cual)
INSERT OR IGNORE INTO "GoogleIntegration" ("id", "organizationId", "googleEmail", "googleRefreshTokenEnc", "googleClientJsonEnc", "calendarSyncEnabled", "createdAt", "updatedAt")
SELECT 'google_' || i."organizationId", i."organizationId", i."googleEmail", i."googleRefreshTokenEnc", i."googleClientJsonEnc", i."enableGoogle", COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."googleRefreshTokenEnc" IS NOT NULL OR i."googleClientJsonEnc" IS NOT NULL OR i."googleEmail" IS NOT NULL;

-- 2) AGENTE-LEADS: Integration.agentLeadsSecretEnc → Settings.agentLeadsSecretEnc
UPDATE "Settings"
SET "agentLeadsSecretEnc" = (SELECT i."agentLeadsSecretEnc" FROM "Integration" i WHERE i."organizationId" = "Settings"."organizationId")
WHERE EXISTS (SELECT 1 FROM "Integration" i WHERE i."organizationId" = "Settings"."organizationId" AND i."agentLeadsSecretEnc" IS NOT NULL);

-- 3) WhatsApp Cloud: WhatsAppConnection → ChannelConnection (token = blob copiado)
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_wacloud_' || c."id", c."organizationId", 'whatsapp', 'meta_cloud', 'meta:whatsapp:' || c."phoneNumberId", c."phoneNumberId", COALESCE(c."displayName", c."phoneNumber"), c."status", c."accessTokenEnc",
       json_object('legacyBackfill', 'WhatsAppConnection', 'wabaId', c."wabaId", 'phoneNumber', c."phoneNumber", 'source', c."source", 'statusDetail', c."statusDetail"),
       COALESCE(c."createdAt", CURRENT_TIMESTAMP), COALESCE(c."updatedAt", CURRENT_TIMESTAMP)
FROM "WhatsAppConnection" c;

-- 3b) WhatsApp Cloud legado 1:1: Integration → ChannelConnection
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_wacloud_int_' || i."organizationId", i."organizationId", 'whatsapp', 'meta_cloud', 'meta:whatsapp:' || i."whatsappPhoneId", i."whatsappPhoneId", NULL,
       CASE WHEN i."enableWhatsApp" = 1 THEN 'connected' ELSE 'pending' END, i."whatsappCloudTokenEnc",
       json_object('legacyBackfill', 'Integration.whatsapp'),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."whatsappPhoneId" IS NOT NULL AND i."whatsappCloudTokenEnc" IS NOT NULL;

-- 3c) Telegram: Integration → ChannelConnection (blob + hash del secret del webhook)
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "webhookSecretHash", "metadata", "createdAt", "updatedAt")
SELECT 'conn_tg_' || i."organizationId", i."organizationId", 'telegram', 'telegram_bot', 'telegram:org:' || i."organizationId", NULL, NULL,
       CASE WHEN i."enableTelegram" = 1 THEN 'connected' ELSE 'pending' END, i."telegramBotTokenEnc", i."telegramSecretHash",
       json_object('legacyBackfill', 'Integration.telegram'),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."telegramBotTokenEnc" IS NOT NULL;

-- 3d) Instagram: Integration → ChannelConnection
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_ig_' || i."organizationId", i."organizationId", 'instagram', 'meta_graph', 'meta:instagram:' || i."instagramAccountId", i."instagramAccountId", NULL,
       CASE WHEN i."enableInstagram" = 1 THEN 'connected' ELSE 'pending' END, i."instagramTokenEnc",
       json_object('legacyBackfill', 'Integration.instagram'),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."instagramAccountId" IS NOT NULL AND i."instagramTokenEnc" IS NOT NULL;

-- 3e) Facebook/Messenger: Integration → ChannelConnection
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_fb_' || i."organizationId", i."organizationId", 'messenger', 'meta_graph', 'meta:messenger:' || COALESCE(NULLIF(json_extract(i."facebookTokenEnc", '$.pageId'), ''), i."facebookPageId"), COALESCE(i."facebookPageId", json_extract(i."facebookTokenEnc", '$.pageId')), i."facebookPageName",
       CASE WHEN i."enableFacebook" = 1 THEN 'connected' ELSE 'pending' END, i."facebookTokenEnc",
       json_object('legacyBackfill', 'Integration.facebook', 'userEmail', i."facebookUserEmail"),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."facebookTokenEnc" IS NOT NULL AND (i."facebookPageId" IS NOT NULL OR json_extract(i."facebookTokenEnc", '$.pageId') IS NOT NULL);

-- 3f) TikTok: Integration → ChannelConnection
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_tt_' || i."organizationId", i."organizationId", 'tiktok', 'tiktok_business', 'tiktok:business:' || COALESCE(json_extract(i."tiktokTokenEnc", '$.openId'), i."organizationId"), json_extract(i."tiktokTokenEnc", '$.openId'), json_extract(i."tiktokTokenEnc", '$.displayName'),
       CASE WHEN i."enableTikTok" = 1 THEN 'connected' ELSE 'pending' END, i."tiktokTokenEnc",
       json_object('legacyBackfill', 'Integration.tiktok'),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."tiktokTokenEnc" IS NOT NULL;

-- 4) Canal Baileys: una ChannelConnection canónica por organización con historial
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_baileys_' || w."organizationId", w."organizationId", 'whatsapp', 'whatsapp_baileys', 'whatsapp_baileys:' || w."organizationId", w."organizationId", 'WhatsApp QR (Baileys) (migrado)', 'connected', 'legacy-migrated', json_object('source', 'migration_backfill'), COALESCE(MIN(w."createdAt"), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "WhatsAppConversation" w
GROUP BY w."organizationId";

-- 5) Conversaciones Baileys: WhatsAppConversation → ChannelConversation
--    El connectionId SE RESUELVE por providerAccountKey (coexiste con filas del script TS o del daemon).
INSERT OR IGNORE INTO "ChannelConversation" ("id", "organizationId", "connectionId", "channel", "externalContactKey", "contactName", "lastMessage", "lastMessageAt", "unreadCount", "status", "metadata", "createdAt", "updatedAt")
SELECT 'cc_' || w."id", w."organizationId",
       (SELECT c."id" FROM "ChannelConnection" c WHERE c."providerAccountKey" = 'whatsapp_baileys:' || w."organizationId"),
       'whatsapp', w."contactPhone", COALESCE(w."contactName", w."contactPhone"), w."lastMessage", w."lastMessageAt", COALESCE(w."unreadCount", 0), COALESCE(w."status", 'active'),
       json_object('clientId', w."clientId", 'isAutoReply', (w."isAutoReply" != 0), 'transferredTo', w."transferredTo", 'legacy', json_object('lastMessageFrom', w."lastMessageFrom")),
       COALESCE(w."createdAt", CURRENT_TIMESTAMP), COALESCE(w."updatedAt", CURRENT_TIMESTAMP)
FROM "WhatsAppConversation" w
WHERE EXISTS (SELECT 1 FROM "ChannelConnection" c WHERE c."providerAccountKey" = 'whatsapp_baileys:' || w."organizationId");

-- 6) Mensajes Baileys: WhatsAppMessage → ChannelMessage (dedup por externalMessageId;
--    conversationId resuelto por la conversación canónica que corresponda)
INSERT OR IGNORE INTO "ChannelMessage" ("id", "conversationId", "externalMessageId", "direction", "senderType", "body", "messageType", "metadata", "createdAt")
SELECT 'cm_' || m."id", cc."id", m."waMessageId", CASE WHEN m."direction" = 'outbound' THEN 'out' ELSE 'in' END, m."senderType", COALESCE(m."text", ''), COALESCE(m."messageType", 'text'),
       json_object('from', m."fromNumber", 'to', m."toNumber", 'deliveryStatus', CASE WHEN m."direction" = 'outbound' THEN 'sent' ELSE NULL END, 'legacy', json_object('isRead', m."isRead")),
       COALESCE(m."createdAt", CURRENT_TIMESTAMP)
FROM "WhatsAppMessage" m
JOIN "WhatsAppConversation" w ON w."id" = m."conversationId"
JOIN "ChannelConversation" cc ON cc."externalContactKey" = w."contactPhone"
  AND cc."connectionId" = (SELECT c."id" FROM "ChannelConnection" c WHERE c."providerAccountKey" = 'whatsapp_baileys:' || w."organizationId");

-- ============================================================
-- FIN DEL BACKFILL — las tablas legacy se eliminan a continuación
-- ============================================================

-- DropIndex
DROP INDEX "Integration_telegramSecretHash_key";

-- DropIndex
DROP INDEX "Integration_organizationId_key";

-- DropIndex
DROP INDEX "WhatsAppConnection_organizationId_status_idx";

-- DropIndex
DROP INDEX "WhatsAppConnection_phoneNumberId_key";

-- DropIndex
DROP INDEX "WhatsAppConnectionEvent_connectionId_createdAt_idx";

-- DropIndex
DROP INDEX "WhatsAppConnectionEvent_organizationId_createdAt_idx";

-- DropIndex
DROP INDEX "WhatsAppConversation_organizationId_contactPhone_key";

-- DropIndex
DROP INDEX "WhatsAppConversation_organizationId_lastMessageAt_idx";

-- DropIndex
DROP INDEX "WhatsAppMessage_organizationId_createdAt_idx";

-- DropIndex
DROP INDEX "WhatsAppMessage_conversationId_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Integration";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WhatsAppConnection";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WhatsAppConnectionEvent";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WhatsAppConversation";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WhatsAppMessage";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "completedAt" DATETIME,
    "userId" TEXT,
    "clientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("clientId", "completedAt", "createdAt", "dueAt", "id", "notes", "organizationId", "priority", "status", "title", "updatedAt", "userId") SELECT "clientId", "completedAt", "createdAt", "dueAt", "id", "notes", "organizationId", "priority", "status", "title", "updatedAt", "userId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_organizationId_status_idx" ON "Task"("organizationId", "status");
CREATE INDEX "Task_organizationId_dueAt_idx" ON "Task"("organizationId", "dueAt");
CREATE INDEX "Task_clientId_idx" ON "Task"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Quote_opportunityId_idx" ON "Quote"("opportunityId");
