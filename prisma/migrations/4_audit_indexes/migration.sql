-- (auditoría 2026-11-11) Índices y cerraduras de unicidad del ciclo 1.

-- A2-23: lookup del secret de Telegram por HASH (valor cifrado en reposo).
ALTER TABLE "Integration" ADD COLUMN "telegramSecretHash" TEXT;
CREATE UNIQUE INDEX "Integration_telegramSecretHash_key" ON "Integration"("telegramSecretHash");

-- Tablero de pipeline: filtros por organización + etapa.
CREATE INDEX "Opportunity_organizationId_stageId_idx" ON "Opportunity"("organizationId", "stageId");

-- A4-02: dedup durable de mensajes de WhatsApp.
CREATE UNIQUE INDEX "WhatsAppMessage_org_wamid_uidx"
  ON "WhatsAppMessage"("organizationId", "waMessageId") WHERE "waMessageId" IS NOT NULL;

-- A2-21: consolidar clientes repetidos sin borrar relaciones ni historiales.
-- Regla: MIN(id) es el registro canónico por organización + teléfono.
-- Se conserva una copia de auditoría de los clientes y preferencias absorbidos.
DROP TABLE IF EXISTS "Client_dedup_backup_20261111";
CREATE TABLE "Client_dedup_backup_20261111" AS
  SELECT * FROM "Client" WHERE "phone" IS NOT NULL AND "id" NOT IN (
    SELECT MIN("id") FROM "Client" WHERE "phone" IS NOT NULL GROUP BY "organizationId", "phone"
  );

DROP TABLE IF EXISTS "ClientPreferences_dedup_backup_20261111";
CREATE TABLE "ClientPreferences_dedup_backup_20261111" AS
  SELECT p.* FROM "ClientPreferences" p
  JOIN "Client_dedup_backup_20261111" d ON d."id" = p."clientId";

-- Si el canónico ya tiene preferencias, completar únicamente campos vacíos.
UPDATE "ClientPreferences" AS p
SET
  "preferredChannel" = COALESCE(p."preferredChannel", (
    SELECT d."preferredChannel" FROM "ClientPreferences" d
    JOIN "Client_dedup_backup_20261111" c ON c."id" = d."clientId"
    WHERE c."organizationId" = (SELECT c2."organizationId" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND c."phone" = (SELECT c2."phone" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND d."preferredChannel" IS NOT NULL ORDER BY d."clientId" LIMIT 1
  )),
  "preferredTime" = COALESCE(p."preferredTime", (
    SELECT d."preferredTime" FROM "ClientPreferences" d
    JOIN "Client_dedup_backup_20261111" c ON c."id" = d."clientId"
    WHERE c."organizationId" = (SELECT c2."organizationId" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND c."phone" = (SELECT c2."phone" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND d."preferredTime" IS NOT NULL ORDER BY d."clientId" LIMIT 1
  )),
  "interests" = COALESCE(p."interests", (
    SELECT d."interests" FROM "ClientPreferences" d
    JOIN "Client_dedup_backup_20261111" c ON c."id" = d."clientId"
    WHERE c."organizationId" = (SELECT c2."organizationId" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND c."phone" = (SELECT c2."phone" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND d."interests" IS NOT NULL ORDER BY d."clientId" LIMIT 1
  )),
  "notes" = COALESCE(p."notes", (
    SELECT d."notes" FROM "ClientPreferences" d
    JOIN "Client_dedup_backup_20261111" c ON c."id" = d."clientId"
    WHERE c."organizationId" = (SELECT c2."organizationId" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND c."phone" = (SELECT c2."phone" FROM "Client" c2 WHERE c2."id" = p."clientId")
      AND d."notes" IS NOT NULL ORDER BY d."clientId" LIMIT 1
  ))
WHERE p."clientId" IN (
  SELECT MIN("id") FROM "Client" WHERE "phone" IS NOT NULL GROUP BY "organizationId", "phone"
);

-- Cuando el canónico no tiene preferencias, conservar la primera fila absorbida.
INSERT INTO "ClientPreferences" ("id", "organizationId", "clientId", "preferredChannel", "preferredTime", "interests", "notes")
SELECT p."id", p."organizationId", c."id", p."preferredChannel", p."preferredTime", p."interests", p."notes"
FROM "ClientPreferences_dedup_backup_20261111" p
JOIN "Client" d ON d."id" = p."clientId"
JOIN "Client" c ON c."organizationId" = d."organizationId" AND c."phone" = d."phone"
WHERE c."id" = (SELECT MIN("id") FROM "Client" c2 WHERE c2."organizationId" = d."organizationId" AND c2."phone" = d."phone")
  AND NOT EXISTS (SELECT 1 FROM "ClientPreferences" cp WHERE cp."clientId" = c."id")
  AND p."id" = (SELECT MIN(p2."id") FROM "ClientPreferences_dedup_backup_20261111" p2
                JOIN "Client" d2 ON d2."id" = p2."clientId"
                WHERE d2."organizationId" = d."organizationId" AND d2."phone" = d."phone");

-- Reasignar todas las relaciones a la ficha canónica antes de borrar duplicados.
UPDATE "ClientHistory" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="ClientHistory"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "Opportunity" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="Opportunity"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "Reservation" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="Reservation"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "Quote" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="Quote"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "Transaction" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="Transaction"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "AgentMemory" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="AgentMemory"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "AgentSuggestion" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="AgentSuggestion"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "AgentCorrection" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="AgentCorrection"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "ConversationEmbedding" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="ConversationEmbedding"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "WhatsAppConversation" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="WhatsAppConversation"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "TimelineEvent" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="TimelineEvent"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");
UPDATE "AgentLeadEvent" SET "clientId" = (SELECT MIN(c2."id") FROM "Client" c2 JOIN "Client" d ON d."organizationId"=c2."organizationId" AND d."phone"=c2."phone" WHERE d."id"="AgentLeadEvent"."clientId")
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");

-- Eliminar solo las preferencias redundantes (ya respaldadas y consolidadas).
DELETE FROM "ClientPreferences"
WHERE "clientId" IN (SELECT "id" FROM "Client_dedup_backup_20261111");

-- Las demás relaciones ya apuntan al canónico; ya no se disparan cascadas.
DELETE FROM "Client" WHERE "id" IN (SELECT "id" FROM "Client_dedup_backup_20261111");

CREATE UNIQUE INDEX "Client_org_phone_uidx"
  ON "Client"("organizationId", "phone") WHERE "phone" IS NOT NULL;
