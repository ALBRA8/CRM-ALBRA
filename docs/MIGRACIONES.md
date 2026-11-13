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
├── 0_baseline/migration.sql
├── 1_session_revocation_quote_uniqueness_ratelimit/migration.sql
├── 2_whatsapp_connections_per_org/migration.sql
├── 3_two_factor_totp/migration.sql
├── 4_audit_indexes/migration.sql
├── 5_client_dedup_field_merge/migration.sql
└── migration_lock.toml
```

La secuencia 0–5 es la que debe aplicar `prisma migrate deploy` en una
instalación nueva. El baseline crea el esquema previo; las migraciones 1–5
añaden cambios posteriores. No se debe marcar el baseline como aplicado en
una base existente sin comparar antes su esquema real con el baseline.

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

## Migración 3 — 2FA TOTP para usuarios (OLEADA 2, 2026-11-11)

**Qué añade:** 4 columnas en `User` para autenticación de dos factores TOTP
(RFC 6238, sin dependencias externas): `twoFactorSecret` (secreto base32
CIFRADO con AES-256-GCM — en claro solo se muestra UNA vez en el
enrolamiento), `twoFactorEnabled` (el login exige el segundo factor solo
si es 1), `twoFactorRecovery` (JSON de hashes SHA-256 de 8 códigos de
recuperación de un solo uso) y `twoFactorLastCounter` (anti-replay: un
código TOTP consumido no vuelve a servir, ni siquiera en su ventana de 30 s).

**Flujo:** `POST /api/auth/2fa/setup` (QR + secreto) → `POST /api/auth/2fa/enable`
(código TOTP + 8 códigos de recuperación mostrados una vez) → el login pasa a
devolver `mfaRequired + mfaToken` (ticket provisional de 5 min que NO es una
sesión) → `POST /api/auth/2fa/verify` canjea el ticket por la sesión real con
el TOTP o un código de recuperación. Desactivación: `POST /api/auth/2fa/disable`
exige contraseña + código vigente.

**Propiedades:**

- Aditiva pura: 4 columnas nuevas; ninguna fila de negocio se modifica.
- Segura por defecto: el secreto JAMÁS se persiste en claro; los códigos de
  recuperación solo como hash; ticket MFA rechazado por getAuth() en todas
  las APIs de negocio.
- Portable a PostgreSQL (OLEADA 1): TEXT/BOOLEAN/INTEGER nulos.

**Aplicación (con respaldo previo — regla 3):**

```bash
cp db/custom.db "db/custom.db.bak-mig3-$(date +%Y%m%dT%H%M%SZ)"   # respaldo físico
npx prisma migrate deploy                                          # aplica migración 3
```

**Rollback:** restaurar el backup físico (`cp db/custom.db.bak-mig3-<ts>
db/custom.db`) y volver el código a la revisión anterior. O solo revertir el
esquema (sin pérdida de datos de negocio; los usuarios re-enrolan):

```sql
ALTER TABLE "User" DROP COLUMN "twoFactorLastCounter";
ALTER TABLE "User" DROP COLUMN "twoFactorRecovery";
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
ALTER TABLE "User" DROP COLUMN "twoFactorSecret";
```


## Auditoría de seguridad — migración 4 y ejecución

### Migración 4: deduplicación sin cascadas destructivas

La deduplicación usa el cliente con menor `id` como ficha canónica por
(`organizationId`, `phone`). Antes de borrar fichas duplicadas, la migración
respalda las filas duplicadas de `Client` y `ClientPreferences`, consolida
campos vacíos de preferencias y reasigna a la ficha canónica las relaciones
de historial, oportunidades, reservas, cotizaciones, transacciones, memoria,
sugerencias, correcciones, embeddings y conversaciones. También actualiza
los `clientId` de `TimelineEvent` y `AgentLeadEvent`.

**Importante:** la modificación de una migración ya publicada solo es válida
si se confirma que la migración 4 NO fue aplicada en ninguna base de datos
compartida o productiva. Prisma valida checksums; si ya fue aplicada, no se
debe editar ni volver a ejecutar esta versión. En ese caso hay que restaurar
desde backup si hubo pérdida y preparar una migración correctiva nueva basada
en el estado real de esa base. No ejecutar hasta verificar
`_prisma_migrations` y el checksum en cada entorno.


### Migración 5 — completar datos de clientes consolidados

La migración 4 conserva las fichas absorbidas en
`Client_dedup_backup_20261111`, pero no fusionaba todos sus campos en la ficha
canónica. La migración 5 corrige ese faltante sin editar la migración 4 ni
alterar sus checksums: completa únicamente campos vacíos de la ficha canónica
con valores no vacíos de los duplicados (correo, cédula, dirección, notas,
fuente, asignación y creador). Si hay varios valores, elige el primero por
orden de id. Si el cliente canónico está en estado `prospect`, promueve su
estado al primer estado no prospect de los duplicados. Conserva la fecha de
creación más antigua y las fechas de último contacto/actualización más
recientes. No elimina ni modifica la tabla de respaldo.

**Límite conocido:** esta migración recupera datos de duplicados que la
migración 4 ya respaldó; no vuelve a deduplicar teléfonos con formatos
alternativos ni altera números de teléfono. La normalización de teléfonos
requiere una regla de negocio y una migración separada, porque una
normalización agresiva podría fusionar personas distintas.

**Compatibilidad:** la migración 5 presupone que la migración 4 se ejecutó y
creó `Client_dedup_backup_20261111`. Antes de desplegarla en cualquier base,
verificar `_prisma_migrations`, el estado de la migración 4 y la existencia y
estructura de esa tabla. Si la migración 4 no se aplicó o la tabla de respaldo
no existe, detenerse: no marcar migraciones como aplicadas ni crear una tabla
vacía para saltar el paso.

### Migración 1 y baseline en bases existentes

Antes de usar `migrate resolve --applied 0_baseline`, comparar el esquema real
de la base objetivo con el SQL de `0_baseline/migration.sql` (tablas,
columnas, índices y claves foráneas). El comando solo registra el baseline;
no crea ni adapta tablas. Si la base no coincide exactamente con el baseline,
detenerse y preparar una migración de reconciliación. Hacer backup físico,
probar restauración y validar conteos/duplicados antes de aplicar
`migrate deploy`. La deduplicación de cotizaciones de la migración 1 renombra
números repetidos; guardar un reporte previo de los valores que cambiarán.

### Comando de migración

`npm run db:migrate` ejecuta `prisma migrate deploy`, que aplica migraciones
pendientes sin crear migraciones de desarrollo. No usar `prisma migrate dev`
contra producción. El guard sigue exigiendo autorización explícita en
entornos identificados como protegidos. La detección por URL es heurística:
configurar siempre `NODE_ENV=production` correctamente y no tratar el guard
como sustituto de backups, revisión del SQL o aprobación operativa.

### Pruebas obligatorias antes de integrar

1. Ejecutar la secuencia completa en SQLite temporal y en una copia saneada de
   cada esquema real soportado.
2. Sembrar dos clientes de la misma organización y teléfono, cada uno con
   historial, preferencias, oportunidad, reserva, cotización, transacción,
   memoria y conversación; comprobar que todos los registros quedan asociados
   al cliente canónico y que no hay filas hijas perdidas.
3. Probar preferencias en los dos escenarios: solo el duplicado tiene
   preferencias y ambos tienen preferencias.
4. Verificar unicidad de teléfono por organización y de
   `(organizationId, waMessageId)` sin alterar mensajes preexistentes.
5. Para migración 1, probar baseline coincidente, baseline divergente,
   cotizaciones duplicadas y restauración efectiva del backup.
6. Repetir las pruebas de las migraciones 2 y 3 y verificar que la conexión
   WhatsApp legado sigue funcionando y que usuarios existentes mantienen
   `twoFactorEnabled=false`.

No considerar la migración aprobada hasta conservar evidencia de estas
pruebas y del ensayo de restauración.
