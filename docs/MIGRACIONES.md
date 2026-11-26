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
└── migration_lock.toml
```

La secuencia 0–4 es la que debe aplicar `prisma migrate deploy` en una
instalación nueva. El baseline crea el esquema previo; las migraciones 1–4
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
DATABASE_URL="file:../db/custom.db" npx prisma migrate deploy
```

Validado contra una BD sembrada con dos cotizaciones `COT-0001` de la misma
organización: tras migrar, la primera conserva su número y la segunda queda
`COT-0001-5d9716`; `tokenVersion=0` en usuarios existentes; 0 duplicados;
sin filas eliminadas.

### Reiniciar una base local de pruebas desde cero

Si los registros son ficticios y se decidió descartarlos, reconstruir únicamente
la base local de pruebas con la secuencia versionada de Prisma:

```bash
mkdir -p db
DATABASE_URL="file:../db/custom.db" npm run db:reset
npx prisma generate
```

`npm run db:reset` ejecuta `prisma migrate reset`: elimina los datos de la
base indicada y vuelve a aplicar las migraciones 0–4. Usar solo con una URL
local de pruebas cuyo contenido se pueda borrar. Antes de ejecutar, comprobar
que `DATABASE_URL` apunta exactamente al archivo deseado. No usar este
comando para una base compartida o productiva. Este repositorio no ejecuta el
borrado remoto automáticamente; la operación debe hacerse en el entorno que
aloja esa base.

## Rollback

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

### Migración 4: índices y restricciones para una base limpia

La migración 4 crea los índices de consulta y unicidad necesarios:
- Hash único para el secreto de Telegram.
- Índice de oportunidades por organización y etapa.
- Unicidad de mensajes de WhatsApp por organización y `waMessageId`
  (solo cuando el identificador no es nulo).
- Unicidad de teléfono por organización para teléfonos no nulos.

No deduplica, fusiona ni elimina clientes. La base de datos de pruebas se
reconstruye desde cero cuando se necesite limpiar datos ficticios; no se
incluye lógica destructiva de datos de negocio en una migración de esquema.

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
2. Verificar los índices de unicidad de teléfono por organización y de
   `(organizationId, waMessageId)` en una base recién creada.
3. Confirmar que los índices de Telegram y oportunidades se crean correctamente.
5. Para migración 1, probar baseline coincidente, baseline divergente,
   cotizaciones duplicadas y restauración efectiva del backup.
6. Repetir las pruebas de las migraciones 2 y 3 y verificar que la conexión
   WhatsApp legado sigue funcionando y que usuarios existentes mantienen
   `twoFactorEnabled=false`.

No considerar la migración aprobada hasta conservar evidencia de estas
pruebas y del ensayo de restauración.

## Convención de numeración (F2-T01, plan definitivo 2026-11-19)

`prisma migrate deploy` aplica migraciones en ORDEN LEXICOGRÁFICO de nombre de
directorio, no en orden de creación. Por eso:

1. **Migraciones base**: `0_` a `9_` con nombre semántico (una sola vez; los
   números de dos dígitos NUNCA se usan: `11_tareas` se aplicaría entre `1_`
   y `2_`).
2. **Migraciones nuevas**: prefijo `z` creciente (`z_`, `zz_`, `zzz_`, …) con
   nombre semántico. Cada migración nueva añade UNA `z` más que la última
   existente, garantizando orden determinista sin renombrar nada anterior.
3. Antes de crear una migración, verificar la última existente:
   `ls prisma/migrations | sort | tail -2`.
4. Las migraciones son ADITIVAS: nunca borran datos; los backfill usan
   sufijado/renombrado (ver Migración 1) y se reversan con `git revert`.

Ejemplo (integración del PR #6): `11_tareas` → `zzzzzz_tareas`, porque la
última migración previa era `zzzzz_channel_connection_refresh_lease`.

## Adopción de migraciones en una base creada con `db push` (sin `_prisma_migrations`)

Las instalaciones que siempre se gestionaron con `prisma db push` no tienen la
tabla `_prisma_migrations`, así que `prisma migrate deploy` no sabe por dónde
empezar (P3005) y `migrate reset` NO es una opción con datos reales. El
procedimiento correcto es el **baseline**: registrar en `_prisma_migrations`
las migraciones cuyo efecto ya tiene la base (sin ejecutarlas) y dejar que
Prisma aplique de verdad solo las que faltan. La migración destructiva
`zzzzzzzzz_drop_legacy_channel_models` (v3) es tolerante a bases `db push`:
usa sombras `CREATE TABLE IF NOT EXISTS` para las tablas legacy que pueden no
existir, `DROP INDEX/DROP TABLE IF EXISTS` y `CREATE INDEX IF NOT EXISTS` para
los índices que `db push` ya pudo crear (p. ej. `Quote_opportunityId_idx`), y
no depende de que `Task` exista.

### Regla de oro

1. **NUNCA sobre la base real**: primero haz una **copia** y ensaya todo ahí.
2. Respaldar SIEMPRE antes (backup físico con `VACUUM INTO`).
3. Elegir el caso según el estado REAL de la base (punto siguiente).

### ¿Hasta qué migración marco el baseline?

`npx prisma migrate status` tras el primer `resolve` mostrará el estado; para
decidirlo antes, mira QUÉ tiene tu base:

- **Esquema vigente** (sin tablas `Integration`/`WhatsAppConnection`/
  `WhatsAppConversation`/`WhatsAppMessage` y con la estructura actual):
  marca TODAS las migraciones menos la última como aplicadas; el deploy
  aplicará solo `zzzzzzzzz_drop_legacy_channel_models`, que corre como no-op
  limpio (ya no hay nada que backfillar ni índices que dupliquen).
- **Estado intermedio** (todavía tiene tablas legacy, p. ej. se quedó en el
  esquema anterior a la unificación): marca como aplicadas solo las
  migraciones ANTERIORES a `zzzzzzzz_canonical_channel_expand` y deja que el
  deploy aplique `zzzzzzzz_canonical_channel_expand` +
  `zzzzzzzzz_drop_legacy_channel_models` de verdad (el backfill conserva los
  datos en las tablas canónicas antes del DROP).

### Pasos exactos (Windows PowerShell, sobre una copia)

```powershell
# 0) Copia de trabajo + respaldo físico (con la app y el daemon DETENIDOS)
Copy-Item db\custom.db db\custom.db.ENSAYO.db
sqlite3 db\custom.db "VACUUM INTO 'backups/crm-pre-baseline.db'"
sqlite3 backups\crm-pre-baseline.db "PRAGMA integrity_check;"   # debe decir: ok

# 1) Ensayar sobre la COPIA: todas las migraciones menos la última (esquema vigente).
#    La lista se GENERA del disco: exacta y siempre sincronizada con prisma/migrations.
$env:DATABASE_URL = "file:{RUTA-ABSOLUTA}\db\custom.db.ENSAYO.db"   # barras invertidas OK
$mig = Get-ChildItem prisma\migrations -Directory | Sort-Object Name | ForEach-Object { $_.Name }
$chain = $mig | Select-Object -First ($mig.Count - 1)   # 20 de 21 al 2026-11-26; ajusta si tu base está en un estado intermedio
foreach ($m in $chain) { npx prisma migrate resolve --applied $m }

# 2) Aplicar la restante y verificar
npx prisma migrate deploy
npx prisma migrate status          # sin pendientes ni fallos
node scripts/verify-unification.mjs
npm run test:db-push-baseline     # opcional: repite el procedimiento completo en copias efímeras

# 3) Si el ensayo quedó limpio, repetir 1-2 con DATABASE_URL apuntando a la
#    base real (ya con respaldo hecho). Ante cualquier fallo:
npx prisma migrate resolve --rolled-back "<nombre-de-la-migracion>"   # y reintenta
#    o restaura el respaldo (única vía de rollback en SQLite).
```

En Linux/macOS los pasos son idénticos con `export DATABASE_URL=...`, rutas
POSIX y `ls prisma/migrations` en lugar de `Get-ChildItem`. La lista del
baseline se genera del disco, así que siempre coincide con el historial real
de migraciones (20 entradas antes de la última, al 2026-11-26).

### Prueba automatizada del procedimiento (evidencia real)

`npm run test:db-push-baseline` ejecuta `scripts/verify-db-push-baseline.mjs`
con el motor REAL de Prisma CLI sobre bases efímeras y verifica 3 escenarios:
(1) db push al esquema vigente — deploy no-op, filas de `Task` preservadas,
índices sin duplicar; (2) db push sin la tabla `Task` — la destructiva la
recrea con la forma vigente; (3) db push con datos legacy en blobs
`v1:iv:tag:datos` — backfill byte a byte a las tablas canónicas. 20/20
comprobaciones PASS al 2026-11-26.
