# INFORME DE TERCERA REPARACIÓN INTEGRAL — CRM-ALBRA

**Repositorio:** `ALBRA8/CRM-ALBRA` · **Rama:** `fix/tercera-reparacion-integral`
**Base commit:** `50a5839` (fix/segunda-reparacion-integral) · **Commit final:** `3be9bff`
**Fecha:** 2026-11-06/07 · **Ejecutado en sala limpia (sandbox), sin despliegues.**

---

## 1. Alcance ejecutado (orden §6.A–§6.E)

### 6.A — BACKUP/RESTORE (causa raíz corregida)
- **Tope EFECTIVO de 25 MB sobre el stream leído:** el límite ya NO depende de
  `Content-Length` (una petición `Transfer-Encoding: chunked` o SIN cabecera lo
  evadía y `req.json()` cargaba el cuerpo COMPLETO en memoria). El body se lee
  por chunks y se DESCARTA al superar el tope → 413 sin agotar memoria; sin
  stream legible → rechazo fail-closed.
- **Validación de estructura y versión ANTES de restaurar:** exige
  `app === 'CRM ALBRA'`, `version ∈ [1..3]` y colecciones arreglo; JSON
  corrupto → 400 SIN iniciar restauración parcial (la transacción
  todo-o-nada de fase 2 se conserva).
- **FIX de deadlock (defecto de fase 2, detectado por la nueva batería):**
  `auditAndTimeline` escribía por la conexión global DENTRO de la transacción
  interactiva que retenía el lock de escritura de SQLite → bloqueo hasta el
  timeout (la ruta POST nunca había tenido prueba). La auditoría del operador
  ahora se registra FUERA y solo si la restauración existió.
- **Operador auditado** (`userId`+`orgId` en `ActivityLog`/Timeline, ya
  existente) y errores con `HttpError` (413/400 mapeados, sin fuga de detalles).

### 6.B — SESIÓN Y AUTENTICACIÓN (tokenVersion) — VERIFICADO, sin regresiones
`assertSessionState` consulta BD en cada petición protegida: usuario existe +
activo + `tv` del JWT == `tokenVersion` vigente + org del token == org del
usuario (fail-closed ante fallo de BD). Autoridad compartida entre instancias
(la BD es la única fuente). Batería: `tests/unit/auth.test.ts`,
`rbac.test.ts`, `superadmin-rbac.test.ts`, `auth-guard.test.ts` — todas verdes
en la ejecución real (503/503). Sin rutas protegidas dependiendo de estado
local de proceso.

### 6.C — AISLAMIENTO MULTIEMPRESA — VERIFICADO
- Esquema: todo modelo de negocio lleva `organizationId` con `onDelete:
  Cascade` e índices `(organizationId, ...)`; unicidad `Quote (organizationId,
  number)`; `ApiKey` resuelve la organización desde la clave (jamás del body).
- Batería `multitenant-p0` + `multitenancy` + `tenant-scope-scheduler` +
`nicho-isolation`: cross-org GET/PUT/DELETE por id → 404/400; asignación de
`assignedToId` y `clientId` validan pertenencia a la organización (400 en
caso contrario) — re-verificado en la auditoría de rutas (`grep` de
`findUnique({ where: { id` sin org: solo lecturas de la propia org o del
`organizationId` de la sesión).
- Residual documentado: datos históricos inconsistentes (no producibles por
  API) podrían referenciar un `clientId` de otra org en lectura auxiliar de
  nombre/teléfono de la oportunidad propia.

### 6.D — OPERACIONES CRÍTICAS — VERIFICADO + endurecimiento del backup
- Rate limiting: capa PERSISTENTE en BD (`dbRateLimit`, `RateLimitBucket`,
  upsert atómico con RETURNING) para login/forgot/reset; capa en memoria solo
  para lectura pública. `clientIp()` con política `TRUST_PROXY`/`TRUST_PROXY_HOPS`
  (sin confianza ciega en `X-Forwarded-For`).
- Restablecimiento de contraseña y revocación: atómicos vía tokenVersion
  (persistente) — cubierto por pruebas unitarias/de integración existentes.
- Migraciones: `prisma/migrations/0_baseline` + `1_session_revocation...`
  (aditivas, documentadas en `docs/MIGRACIONES.md`); los scripts `db:push
  --accept-data-loss`/`db:reset` NO se ejecutaron contra datos reales (solo
  contra la BD efímera de pruebas `db/test-vitest.db` que la batería recrea).
- Backup/restore: ver 6.A (límite efectivo, validación, todo-o-nada,
  interrupciones → rollback de transacción).

### 6.E — LINT RATCHET — VERIFICADO
`node scripts/lint-baseline.mjs` → **328 errores ≤ baseline 328 (ratchet
activo)**: los errores NUEVOS bloquean CI; no se suprimió ninguna regla ni se
aflojó ninguna aserción para poner CI verde; el único cambio de baseline
permitido sería reducir (no aplica).

## 2. Hallazgos PENDIENTES / decisiones de producto
- El ratchet permanece en 328 errores heredados: reducirlos es trabajo de
  fondo recomendado (no bloquea; nada nuevo entra).
- `DATABASE_URL` SQLite para preview con swap a PostgreSQL documentado en
  schema: la migración de proveedor sigue siendo una decisión de despliegue.
- Contrato WHATSPOWER↔CRM: el CRM ya confirma `orgId` en
  `/api/crm/actions` (fase 2); con la fase 3 el cliente (2A) ahora EXIGE esa
  confirmación — sin cambios requeridos en el CRM.

## 3. Pruebas REALES ejecutadas (como CI)
| Comando | Resultado |
|---|---|
| `npm install --legacy-peer-deps` | OK |
| `npm run security:scan` | OK (CI success; sin secretos en fuente) |
| `npm run db:generate` | OK |
| `npx tsc --noEmit` | OK |
| `node scripts/lint-baseline.mjs` | **328 ≤ 328 (ratchet OK)** |
| `npx vitest run` | **503/503 pass** (499 previos + 4 nuevas backup-hardening) |
| `npm run build` (NODE_OPTIONS heap acotado en sandbox; en CI sin cap) | OK (standalone generado) |
| CI GitHub Actions (`CI CRM-ALBRA`) | **success** en `3be9bff` |

Pruebas nuevas (reproducen el fallo antes del fix): 413 con body chunked >25MB
SIN Content-Length; restore válido chunked atribuido a la org del operador;
JSON corrupto → 400 y CERO filas creadas; app/versión/colección inválida y
no-JSON → 400.

## 4. Migraciones y resultados
Sin migraciones nuevas (las de fase 2 siguen presentes y verificadas por la
batería: revocación persistente, unicidad por org, rate limit persistente).
El restore integración usa BD efímera con datos representativos (2 orgs, claves API, usuarios).

## 5. Integración real (sección 7)
CRM participó como SERVICIO REAL (standalone de producción, BD dedicada con 2
organizaciones y API keys) en los 15 escenarios: el puente 2A→CRM creó el
cliente EN la organización correcta (verificado EN LA BD del CRM) y una
organización sin credencial no creó nada (fail-closed). Evidencia:
`/home/z/my-project/integration/results.json` (escenario I-15).

## 6. Enlaces
- Rama: https://github.com/ALBRA8/CRM-ALBRA/tree/fix/tercera-reparacion-integral
- Commit: `3be9bff`
- CI: https://github.com/ALBRA8/CRM-ALBRA/actions (run success en `3be9bff`)
