-- Migración 1 — segunda reparación integral (2026-11-06)
-- 1) User.tokenVersion: revocación de sesiones PERSISTENTE (sobrevive
--    reinicios, compartida entre instancias). Aditiva, default 0, sin pérdida.
-- 2) RateLimitBucket: contadores de rate limiting en BD para endpoints
--    sensibles (efectivos entre instancias que comparten la BD).
-- 3) Quote (organizationId, number) UNIQUE: unicidad de número de cotización
--    por organización. ANTES de crear el índice se sufijan los duplicados
--    históricos (sufijo aleatorio corto): preserva todos los registros, no
--    borra ni sobrescribe datos de negocio.
-- Reversible: ver docs/MIGRACIONES.md (down-scripts documentados).

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL
);

-- RedefineTables (reconstrucción estándar de SQLite; los datos se copian)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "avatar" TEXT,
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "lastLeadAt" DATETIME,
    "organizationId" TEXT NOT NULL,
    "resetToken" TEXT,
    "resetTokenExp" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_User" ("avatar", "company", "createdAt", "email", "id", "isActive", "lastLeadAt", "leadCount", "name", "organizationId", "passwordHash", "phone", "resetToken", "resetTokenExp", "role", "updatedAt") SELECT "avatar", "company", "createdAt", "email", "id", "isActive", "lastLeadAt", "leadCount", "name", "organizationId", "passwordHash", "phone", "resetToken", "resetTokenExp", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- Dedup de números de cotización repetidos DENTRO de una misma organización:
-- a cada registro posterior se le añade un sufijo corto aleatorio. No se
-- elimina ni sobrescribe ninguna fila (la orden prohíbe pérdida de datos).
UPDATE "Quote" SET "number" = "number" || '-' || lower(hex(randomblob(3)))
WHERE "id" IN (
  SELECT q."id" FROM "Quote" q
  JOIN "Quote" q2
    ON q."organizationId" = q2."organizationId"
   AND q."number" = q2."number"
   AND q."id" > q2."id"
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_number_key" ON "Quote"("organizationId", "number");
