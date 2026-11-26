-- Migración destructiva (contract) — UNIFICACIÓN 2026-11-21
-- Backfill de datos + DROP de Integration, WhatsAppConnection(±Event),
-- WhatsAppConversation y WhatsAppMessage. El backfill corre ANTES de los DROP:
-- CERO PÉRDIDA incluso si no se ejecutó el backfill TS.
--
-- v2 (2026-11-26, hallazgo A-010): facebookTokenEnc y tiktokTokenEnc son blobs
-- cifrados "v1:iv:tag:datos" (AES-256-GCM), NO JSON. json_extract sobre ellos
-- abortaba la migración con "malformed JSON". Reglas vigentes:
--   * NINGÚN json_extract sobre columnas cifradas (los únicos usos de JSON en
--     este archivo son json_object, constructor seguro que nunca parsea entrada).
--   * Facebook: identidad SOLO por Integration.facebookPageId (columna plana);
--     si falta, la fila NO se migra y se deja constancia en ChannelConnectionEvent.
--   * Telegram/TikTok: clave estable por organización, blob cifrado copiado tal
--     cual; botId/openId/displayName los rellena el backfill TS descifrando con
--     la clave de la app (scripts/backfill-channel-connections.ts), nunca SQL.
--
-- v3 (2026-11-26, hallazgo Antigravity en Windows — BD creadas con `db push`):
--   * Idempotente-frente-a-esquema-vigente: una base creada con `db push`
--     (sin _prisma_migrations) puede NO tener las tablas legacy (el backfill
--     no tiene nada que migrar) y SÍ tener índices que esta migración creaba
--     a ciegas (Quote_opportunityId_idx). Sentencias endurecidas:
--       - Tablas legacy referenciadas por el backfill → "sombra" con
--         CREATE TABLE IF NOT EXISTS (vacía en BD db push; en BD de la cadena
--         ya existe la real y el IF NOT EXISTS es no-op). Se dropean al final.
--       - DROP INDEX IF EXISTS / DROP TABLE IF EXISTS en todos los drops.
--       - CREATE INDEX IF NOT EXISTS en los 4 índices (Task x3 + Quote).
--       - Task: CREATE TABLE IF NOT EXISTS con la forma histórica (zzzzzz_tareas)
--         antes del redefine → la migración ya NO depende de que Task exista
--         (una db push anterior a `zzzzzzzz_tareas` no la tiene). Si existe
--         (cualquier forma histórica), el IF NOT EXISTS es no-op y el redefine
--         la normaliza a la forma vigente.
--       - new_Task con IF NOT EXISTS y INSERT OR IGNORE → reintento tras abort
--         parcial no duplica filas ni truena por la tabla temporal.


-- ============================================================
-- SOMBRAS DE TABLAS LEGACY (solo si NO existen): hacen el backfill
-- inofensivo en bases `db push` donde las tablas legacy ya no existen
-- (cero filas → INSERT OR IGNORE sin efecto). En bases de la cadena de
-- migraciones las tablas reales ya existen y estas sentencias son no-op.
-- Columnas: EXACTAMENTE las que usan los SELECT del backfill de abajo.
-- ============================================================
CREATE TABLE IF NOT EXISTS "Integration" (
    "organizationId" TEXT, "googleEmail" TEXT, "googleRefreshTokenEnc" TEXT, "googleClientJsonEnc" TEXT,
    "enableGoogle" BOOLEAN, "agentLeadsSecretEnc" TEXT, "whatsappPhoneId" TEXT, "whatsappCloudTokenEnc" TEXT,
    "enableWhatsApp" BOOLEAN, "telegramBotTokenEnc" TEXT, "enableTelegram" BOOLEAN, "telegramSecretHash" TEXT,
    "instagramAccountId" TEXT, "instagramTokenEnc" TEXT, "enableInstagram" BOOLEAN, "facebookPageId" TEXT,
    "facebookPageName" TEXT, "facebookTokenEnc" TEXT, "facebookUserEmail" TEXT, "enableFacebook" BOOLEAN,
    "tiktokTokenEnc" TEXT, "enableTikTok" BOOLEAN, "updatedAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "WhatsAppConnection" (
    "id" TEXT, "organizationId" TEXT, "wabaId" TEXT, "phoneNumberId" TEXT, "phoneNumber" TEXT,
    "displayName" TEXT, "accessTokenEnc" TEXT, "source" TEXT, "statusDetail" TEXT, "status" TEXT,
    "createdAt" DATETIME, "updatedAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "WhatsAppConversation" (
    "id" TEXT, "organizationId" TEXT, "contactPhone" TEXT, "contactName" TEXT, "lastMessage" TEXT,
    "lastMessageAt" DATETIME, "unreadCount" INTEGER, "status" TEXT, "clientId" TEXT, "isAutoReply" BOOLEAN,
    "transferredTo" TEXT, "lastMessageFrom" TEXT, "createdAt" DATETIME, "updatedAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
    "id" TEXT, "conversationId" TEXT, "waMessageId" TEXT, "direction" TEXT, "senderType" TEXT,
    "text" TEXT, "messageType" TEXT, "fromNumber" TEXT, "toNumber" TEXT, "isRead" BOOLEAN, "createdAt" DATETIME
);
-- Task: sombra con la forma histórica de zzzzzzzz_tareas. El redefine de abajo
-- la lleva a la forma vigente en TODOS los casos; así la migración nunca
-- depende de que Task exista (bases db push anteriores a `zzzzzzzz_tareas`).
CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT, "organizationId" TEXT, "title" TEXT, "notes" TEXT, "dueAt" DATETIME,
    "priority" TEXT DEFAULT 'normal', "status" TEXT DEFAULT 'open', "completedAt" DATETIME,
    "userId" TEXT, "clientId" TEXT, "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME
);

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
--     externalAccountId es NOT NULL y el botId vive DENTRO del blob cifrado
--     (formato "<botId>:<secret>"): SQL no puede descifrarlo, así que se usa el
--     placeholder organizationId (antes NULL violaba el NOT NULL y el INSERT OR
--     IGNORE descartaba la fila en silencio — hallazgo A-010). El backfill TS
--     rellena el botId descifrando con la clave de la app, nunca SQL.
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "webhookSecretHash", "metadata", "createdAt", "updatedAt")
SELECT 'conn_tg_' || i."organizationId", i."organizationId", 'telegram', 'telegram_bot', 'telegram:org:' || i."organizationId", i."organizationId", NULL,
       CASE WHEN i."enableTelegram" = 1 THEN 'connected' ELSE 'pending' END, i."telegramBotTokenEnc", i."telegramSecretHash",
       json_object('legacyBackfill', 'Integration.telegram', 'pendingDecrypt', 'botId'),
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
--     La identidad sale SOLO de Integration.facebookPageId (columna plana).
--     facebookTokenEnc es un blob cifrado (v1:iv:tag:datos): jamás json_extract.
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_fb_' || i."organizationId", i."organizationId", 'messenger', 'meta_graph', 'meta:messenger:' || i."facebookPageId", i."facebookPageId", i."facebookPageName",
       CASE WHEN i."enableFacebook" = 1 THEN 'connected' ELSE 'pending' END, i."facebookTokenEnc",
       json_object('legacyBackfill', 'Integration.facebook', 'userEmail', i."facebookUserEmail"),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP), COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE i."facebookTokenEnc" IS NOT NULL AND i."facebookPageId" IS NOT NULL;

-- 3e-bis) Constancia de filas Facebook con datos parciales NO migradas:
--     el blob cifrado no se puede leer en SQL (no es JSON) y ChannelConnection
--     exige credentialsEnc NOT NULL, así que una fila sin token, o sin pageId,
--     no puede migrarse. Se registra en ChannelConnectionEvent (connectionId
--     NULL, sin secretos en el detalle) para que el operador la rescatase con
--     el backfill TS ANTES del DROP o la reconstruya después por OAuth.
INSERT OR IGNORE INTO "ChannelConnectionEvent" ("id", "organizationId", "connectionId", "type", "detail", "createdAt")
SELECT 'cce_fb_skip_' || i."organizationId", i."organizationId", NULL, 'migration_backfill_skipped',
       json_object('legacyTable', 'Integration', 'channel', 'messenger',
                   'reason', CASE WHEN i."facebookPageId" IS NULL THEN 'missing_facebookPageId' ELSE 'missing_facebookTokenEnc' END,
                   'note', 'fila legacy no migrada; sin secretos en este detalle'),
       COALESCE(i."updatedAt", CURRENT_TIMESTAMP)
FROM "Integration" i
WHERE (i."facebookTokenEnc" IS NOT NULL OR i."facebookPageId" IS NOT NULL)
  AND (i."facebookTokenEnc" IS NULL OR i."facebookPageId" IS NULL);

-- 3f) TikTok: Integration → ChannelConnection
--     Clave estable que NO depende del blob: tiktok:business:<organizationId>.
--     El blob cifrado se copia tal cual a credentialsEnc; openId/displayName los
--     rellena el backfill TS (descifra con la clave de la app), nunca SQL.
INSERT OR IGNORE INTO "ChannelConnection" ("id", "organizationId", "channel", "provider", "providerAccountKey", "externalAccountId", "displayName", "status", "credentialsEnc", "metadata", "createdAt", "updatedAt")
SELECT 'conn_tt_' || i."organizationId", i."organizationId", 'tiktok', 'tiktok_business', 'tiktok:business:' || i."organizationId", i."organizationId", NULL,
       CASE WHEN i."enableTikTok" = 1 THEN 'connected' ELSE 'pending' END, i."tiktokTokenEnc",
       json_object('legacyBackfill', 'Integration.tiktok', 'pendingDecrypt', 'openId,displayName'),
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

-- DropIndex (IF EXISTS: una base db push puede no tenerlos)
DROP INDEX IF EXISTS "Integration_telegramSecretHash_key";

-- DropIndex
DROP INDEX IF EXISTS "Integration_organizationId_key";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConnection_organizationId_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConnection_phoneNumberId_key";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConnectionEvent_connectionId_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConnectionEvent_organizationId_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConversation_organizationId_contactPhone_key";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppConversation_organizationId_lastMessageAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppMessage_organizationId_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "WhatsAppMessage_conversationId_createdAt_idx";

-- DropTable (IF EXISTS: dropea la tabla real en la cadena, la sombra en db push)
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "Integration";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "WhatsAppConnection";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "WhatsAppConnectionEvent";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "WhatsAppConversation";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "WhatsAppMessage";
PRAGMA foreign_keys=on;

-- RedefineTables (tolerante a reintento: IF NOT EXISTS + INSERT OR IGNORE)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS "new_Task" (
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
INSERT OR IGNORE INTO "new_Task" ("clientId", "completedAt", "createdAt", "dueAt", "id", "notes", "organizationId", "priority", "status", "title", "updatedAt", "userId") SELECT "clientId", "completedAt", "createdAt", "dueAt", "id", "notes", "organizationId", "priority", "status", "title", "updatedAt", "userId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX IF NOT EXISTS "Task_organizationId_status_idx" ON "Task"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Task_organizationId_dueAt_idx" ON "Task"("organizationId", "dueAt");
CREATE INDEX IF NOT EXISTS "Task_clientId_idx" ON "Task"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex (IF NOT EXISTS: una base db push ya lo tiene)
CREATE INDEX IF NOT EXISTS "Quote_opportunityId_idx" ON "Quote"("opportunityId");
