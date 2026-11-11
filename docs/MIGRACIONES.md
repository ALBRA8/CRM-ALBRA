# Migraciones Prisma — CRM ALBRA (segunda reparación integral)

## Estado anterior

El proyecto gestionaba el esquema con `prisma db push` (sin historial de
migraciones): no había forma reproducible de llevar una BD de producción de
v1 a v2 sin destruir/recrear. A partir de esta reparación, `prisma/migrations/`
es la fuente de verdad del esquema y `db push` queda relegado a borradores
locales de desarrollo.

## Estructura

```
prisma/migrations/
├── 0_baseline/migration.sql                                    (esquema completo previo a la 2ª reparación)
├── 1_session_revocation_quote_uniqueness_ratelimit/migration.sql (aditiva, no destructiva)
└── migration_lock.toml
```

### Migración 1 — contenido y garantías

1. `User.tokenVersion INTEGER NOT NULL DEFAULT 0` — revocación persistente de
   sesiones (aditiva; los usuarios existentes arrancan en 0 y sus JWT siguen
   siendo válidos hasta la primera revocación).
2. Tabla `RateLimitBucket` — límites anti-fuerza-bruta persistentes en BD.
3. Tabla `OrgCounter` — asignación atómica de números de cotización.
4. `Quote (organizationId, number) UNIQUE` — unicidad por organización.
   ANTES de crear el índice, la migración SUFIJA los duplicados históricos
   (`number || '-' || hex(randomblob(3))`): **no borra ni sobrescribe datos de
   negocio**; solo renombra el número de las filas repetidas posteriores.

## Procedimiento validado (con evidencia)

### A) Instalación limpia

```bash
DATABASE_URL="file:./db/nueva.db" npx prisma migrate deploy
```
Validado 2026-11-06: `All migrations have been successfully applied.`

### B) BD existente (producción con datos, incluidos duplicados históricos)

Las BD existentes NO tienen la tabla `_prisma_migrations` → `migrate deploy`
falla con **P3005**. El procedimiento correcto (validado, sin pérdida):

```bash
# 1. Backup físico previo (obligatorio):
cp db/custom.db "db/custom.db.bak-$(date +%Y%m%d-%H%M%S)"

# 2. Marcar el baseline como aplicado (no ejecuta SQL, solo registra):
DATABASE_URL="file:./db/custom.db" npx prisma migrate resolve --applied 0_baseline

# 3. Aplicar la migración 1 (aditiva + dedup):
DATABASE_URL="file:./db/custom.db" npx prisma migrate deploy
```

Validado contra una BD sembrada con dos cotizaciones `COT-0001` de la misma
organización: tras migrar, la primera conserva su número y la segunda queda
`COT-0001-5d9716`; `tokenVersion=0` en usuarios existentes; 0 duplicados;
sin filas eliminadas.

### Rollback

La migración 1 es aditiva. Rollback = restaurar el backup físico del paso 1
(única vía segura en SQLite; no se escriben down-migrations automáticas).
`User.tokenVersion` y las tablas nuevas pueden quedarse sin efecto si se
vuelve al código anterior (los JWT antiguos sin `tv` se tratan como versión 0).

## Producción (documentado — NO ejecutado)

1. Ventana de mantenimiento breve (el rebuild de `User` bloquea escrituras unos
   segundos con tablas grandes).
2. Ejecutar A) o B) según el estado de la BD objetivo.
3. `npx prisma generate` y reiniciar la aplicación (el cliente Prisma debe
   conocer `tokenVersion`, `RateLimitBucket` y `OrgCounter`).
4. Verificación post-migración:
   `SELECT count(*) FROM (SELECT organizationId, number FROM Quote GROUP BY 1,2 HAVING count(*)>1)` → 0
   y `SELECT tokenVersion FROM User LIMIT 1` → columna existente.
5. Si el proveedor pasa a PostgreSQL: regenerar el SQL con
   `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-empty --script`
   como referencia y re-emitir el baseline en dialecto PG; los procedimientos
   A/B son idénticos.

## Migración 2 — conexiones WhatsApp por organización (OLEADA 2, 2026-11-11)

**Qué añade:** `WhatsAppConnection` (una conexión = un número de WhatsApp de
una organización; `phoneNumberId` UNIQUE global) y
`WhatsAppConnectionEvent` (auditoría del ciclo de vida). Decisión de negocio:
cada organización conecta sus propios números con sus credenciales de Meta
(Embedded Signup oficial), cifradas y asociadas exclusivamente a su
`organization_id`.

**Propiedades:**

- Aditiva pura: crea dos tablas nuevas, no toca datos ni tablas existentes.
- Compatible: el legado `Integration.whatsappCloudTokenEnc` (un número por
  org) sigue operativo; el webhook resuelve primero por `WhatsAppConnection`
  y solo cae al legado si no hay conexión nueva con ese `phone_number_id`.
- Portable a PostgreSQL (OLEADA 1): solo TEXT/DATETIME, sin columnas JSON.

**Aplicación (con respaldo previo — regla 3):**

```bash
cp db/custom.db "db/custom.db.bak-mig2-$(date +%Y%m%dT%H%M%SZ)"   # respaldo físico
npx prisma migrate deploy                                          # aplica migración 2
```

**Rollback:** restaurar el backup físico (`cp db/custom.db.bak-mig2-<ts>
db/custom.db`) y volver el código a la revisión anterior. Las dos tablas
nuevas no contienen datos de negocio: puede quedar sin efecto con el código
anterior sin pérdida.
