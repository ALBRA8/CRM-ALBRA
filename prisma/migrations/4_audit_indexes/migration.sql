-- Migración 4 (auditoría 2026-11-11): índices e integridad (A4-02/A4-04/A4-07/A4-08/A2-07)
-- SQLite: ALTER ADD COLUMN y CREATE INDEX son aditivos y seguros.

-- (A2-07) hash de lookup para el secret de Telegram (valor cifrado en telegramSecret)
ALTER TABLE "Integration" ADD COLUMN "telegramSecretHash" TEXT;

-- (A4-08) índices para FKs de negocio filtrables (evita seq-scan al migrar a PostgreSQL)
CREATE INDEX IF NOT EXISTS "Opportunity_stageId_idx" ON "Opportunity"("stageId");
CREATE INDEX IF NOT EXISTS "Quote_opportunityId_idx" ON "Quote"("opportunityId");

-- (A4-04) unicidad del contacto por organización: find-or-create concurrente
-- (dos webhooks del mismo teléfono) jamás crea dos clientes. Parcial: phone
-- NULL se permite repetido (clientes sin teléfono). Verificado: sin duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS "Client_organizationId_phone_key"
  ON "Client"("organizationId", "phone") WHERE "phone" IS NOT NULL;

-- (A4-02) respaldo del dedup de mensajes Cloud: un re-entrego de Meta jamás
-- vuelve a procesar el mismo mensaje.
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_organizationId_waMessageId_key"
  ON "WhatsAppMessage"("organizationId", "waMessageId") WHERE "waMessageId" IS NOT NULL;
