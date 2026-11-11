-- (auditoría 2026-11-11) Índices y cerraduras de unicidad del ciclo 1.

-- A2-23: lookup del secret de Telegram por HASH (valor cifrado en reposo).
ALTER TABLE "Integration" ADD COLUMN "telegramSecretHash" TEXT;
CREATE UNIQUE INDEX "Integration_telegramSecretHash_key" ON "Integration"("telegramSecretHash");

-- Tablero de pipeline: filtros por organización + etapa.
CREATE INDEX "Opportunity_organizationId_stageId_idx" ON "Opportunity"("organizationId", "stageId");

-- A4-02: dedup durable de mensajes de WhatsApp — un (organización, waMessageId)
-- es único. Índice PARCIAL: solo filas con waMessageId.
CREATE UNIQUE INDEX "WhatsAppMessage_org_wamid_uidx"
  ON "WhatsAppMessage"("organizationId", "waMessageId") WHERE "waMessageId" IS NOT NULL;

-- A2-21: cerradura contra contactos duplicados por organización. La limpieza
-- conserva el cliente MÁS ANTIGUO de cada (organizationId, phone): los duplicados
-- de carreras de webhooks son recientes y carecen de historial.
DELETE FROM "Client" WHERE "phone" IS NOT NULL AND "id" NOT IN (
  SELECT MIN("id") FROM "Client" WHERE "phone" IS NOT NULL GROUP BY "organizationId", "phone"
);
CREATE UNIQUE INDEX "Client_org_phone_uidx"
  ON "Client"("organizationId", "phone") WHERE "phone" IS NOT NULL;
