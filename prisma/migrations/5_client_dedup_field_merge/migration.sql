-- Migración 5: completar la ficha canónica con datos de clientes absorbidos.
-- No modifica la migración 4 ni sus checksums. La migración 4 conserva las
-- fichas duplicadas en Client_dedup_backup_20261111 antes de eliminarlas.
-- Regla: nunca reemplazar un dato canónico no vacío; si está vacío, tomar el
-- primer dato no vacío de los duplicados, ordenados por id.
-- La tabla de respaldo es parte del contrato de la migración 4.

UPDATE "Client" AS c
SET
  "name" = CASE
    WHEN trim(c."name") = '' THEN COALESCE((
      SELECT NULLIF(trim(b."name"), '') FROM "Client_dedup_backup_20261111" b
      WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      ORDER BY b."id" LIMIT 1
    ), c."name") ELSE c."name" END,
  "email" = COALESCE(NULLIF(trim(c."email"), ''), (
    SELECT NULLIF(trim(b."email"), '') FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND NULLIF(trim(b."email"), '') IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "cedula" = COALESCE(NULLIF(trim(c."cedula"), ''), (
    SELECT NULLIF(trim(b."cedula"), '') FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND NULLIF(trim(b."cedula"), '') IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "address" = COALESCE(NULLIF(trim(c."address"), ''), (
    SELECT NULLIF(trim(b."address"), '') FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND NULLIF(trim(b."address"), '') IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "notes" = COALESCE(NULLIF(trim(c."notes"), ''), (
    SELECT NULLIF(trim(b."notes"), '') FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND NULLIF(trim(b."notes"), '') IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "source" = COALESCE(NULLIF(trim(c."source"), ''), (
    SELECT NULLIF(trim(b."source"), '') FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND NULLIF(trim(b."source"), '') IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "assignedToId" = COALESCE(c."assignedToId", (
    SELECT b."assignedToId" FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND b."assignedToId" IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "createdById" = COALESCE(c."createdById", (
    SELECT b."createdById" FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND b."createdById" IS NOT NULL
    ORDER BY b."id" LIMIT 1
  )),
  "lastContactAt" = COALESCE(c."lastContactAt", (
    SELECT b."lastContactAt" FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND b."lastContactAt" IS NOT NULL
    ORDER BY datetime(b."lastContactAt") DESC, b."id" LIMIT 1
  )),
  "status" = CASE
    WHEN c."status" = 'prospect' AND EXISTS (
      SELECT 1 FROM "Client_dedup_backup_20261111" b
      WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
        AND b."status" <> 'prospect'
    ) THEN (
      SELECT b."status" FROM "Client_dedup_backup_20261111" b
      WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
        AND b."status" <> 'prospect'
      ORDER BY b."id" LIMIT 1
    ) ELSE c."status" END,
  "createdAt" = COALESCE((
    SELECT b."createdAt" FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND b."createdAt" IS NOT NULL
    ORDER BY datetime(b."createdAt"), b."id" LIMIT 1
  ), c."createdAt"),
  "updatedAt" = COALESCE((
    SELECT b."updatedAt" FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
      AND b."updatedAt" IS NOT NULL
    ORDER BY datetime(b."updatedAt") DESC, b."id" LIMIT 1
  ), c."updatedAt")
WHERE c."phone" IS NOT NULL
  AND c."id" = (
    SELECT MIN(c2."id") FROM "Client" c2
    WHERE c2."organizationId" = c."organizationId"
      AND c2."phone" = c."phone"
  )
  AND EXISTS (
    SELECT 1 FROM "Client_dedup_backup_20261111" b
    WHERE b."organizationId" = c."organizationId" AND b."phone" = c."phone"
  );

-- La migración correctiva no elimina ni modifica la tabla de respaldo:
-- se conserva para auditoría y recuperación manual.
