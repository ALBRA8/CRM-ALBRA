-- (auditoría 2026-11-11) Índices y cerraduras de unicidad del ciclo 1.

-- A2-23: lookup del secret de Telegram por HASH (valor cifrado en reposo).
ALTER TABLE "Integration" ADD COLUMN "telegramSecretHash" TEXT;
CREATE UNIQUE INDEX "Integration_telegramSecretHash_key" ON "Integration"("telegramSecretHash");

-- Tablero de pipeline: filtros por organización + etapa.
CREATE INDEX "Opportunity_organizationId_stageId_idx" ON "Opportunity"("organizationId", "stageId");

-- A4-02: dedup durable de mensajes de WhatsApp.
CREATE UNIQUE INDEX "WhatsAppMessage_org_wamid_uidx"
  ON "WhatsAppMessage"("organizationId", "waMessageId") WHERE "waMessageId" IS NOT NULL;

-- Unicidad de teléfono por organización. La base se inicializa limpia;
-- no se fusionan ni eliminan clientes durante una migración de esquema.
CREATE UNIQUE INDEX "Client_org_phone_uidx"
  ON "Client"("organizationId", "phone") WHERE "phone" IS NOT NULL;
