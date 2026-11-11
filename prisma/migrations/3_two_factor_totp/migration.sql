-- Migración 3 — OLEADA 2: autenticación de dos factores (TOTP, RFC 6238)
--
-- Decisión de negocio 2026-11-11: multiusuario real por organización con
-- roles/permisos y 2FA. Cada usuario de una organización puede activar un
-- segundo factor TOTP (Google Authenticator, Authy, 1Password, etc.).
--
-- Cambios en la tabla "User" (ADITIVOS PUROS, sin tocar datos existentes):
--   1) twoFactorSecret      — secreto base32 CIFRADO (AES-256-GCM con
--                              APP_ENCRYPTION_KEY/APP_SECRET). NULL = sin 2FA.
--                              El secreto en claro solo se muestra UNA vez en
--                              el enrolamiento; JAMÁS se persiste en claro.
--   2) twoFactorEnabled     — el login exige el segundo factor solo si es 1.
--                              Permite el flujo setup→confirmar sin bloquear.
--   3) twoFactorRecovery    — JSON array de hashes SHA-256 de códigos de
--                              recuperación de un solo uso. En claro NUNCA en BD.
--   4) twoFactorLastCounter — último contador TOTP consumido: un código ya
--                              usado (ventana de 30 s) NO vuelve a servir
--                              (protección anti-replay extremo a extremo).
--
-- Propiedades:
--  - Aditiva pura: 4 columnas nuevas; ninguna fila de negocio se modifica.
--  - Reversible (documentado en docs/MIGRACIONES.md):
--      ALTER TABLE "User" DROP COLUMN "twoFactorLastCounter";
--      ALTER TABLE "User" DROP COLUMN "twoFactorRecovery";
--      ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
--      ALTER TABLE "User" DROP COLUMN "twoFactorSecret";
--    Sin pérdida de datos de negocio: solo se pierde el estado 2FA de los
--    usuarios (que deberán re-enrolar si se revierte).
--  - Portable: solo TEXT/BOOLEAN/INTEGER nulos — compatible SQLite/PostgreSQL.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorRecovery" TEXT;
ALTER TABLE "User" ADD COLUMN "twoFactorLastCounter" INTEGER;
