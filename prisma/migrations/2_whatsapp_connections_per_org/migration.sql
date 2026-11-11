-- Migración 2 — OLEADA 2 (arquitectura SaaS de credenciales Meta por organización)
--
-- Decisión de negocio 2026-11-11: cada organización conecta sus propios números
-- de WhatsApp con sus credenciales de Meta (flujo oficial Embedded Signup),
-- cifradas y asociadas exclusivamente a su organization_id.
--
-- 1) WhatsAppConnection: una conexión = un número de WhatsApp de una org.
--    phoneNumberId UNIQUE a nivel global: un número pertenece a EXACTAMENTE
--    UNA organización (base de la atribución automática webhook → org).
-- 2) WhatsAppConnectionEvent: auditoría del ciclo de vida por conexión.
--
-- Propiedades:
--  - Aditiva pura: crea dos tablas nuevas, no toca datos existentes.
--  - Reversible: DROP TABLE WhatsAppConnectionEvent; DROP TABLE WhatsAppConnection;
--    (documentado en docs/MIGRACIONES.md). No hay pérdida de datos de negocio:
--    el legado Integration.whatsappCloudTokenEnc sigue intacto y operativo.
--  - El swap a PostgreSQL (OLEADA 1) no altera este DDL: solo tipos TEXT/DATETIME
--    portables, sin columnas JSON.

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "wabaId" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "displayName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "metaAppSecretEnc" TEXT,
    "webhookVerifyToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusDetail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'embedded_signup',
    "tokenExpiresAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "lastErrorAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppConnectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppConnectionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_phoneNumberId_key" ON "WhatsAppConnection"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_organizationId_status_idx" ON "WhatsAppConnection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppConnectionEvent_organizationId_createdAt_idx" ON "WhatsAppConnectionEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppConnectionEvent_connectionId_createdAt_idx" ON "WhatsAppConnectionEvent"("connectionId", "createdAt");
