# AUDIT_REPORT — Misión de Auditoría Integral y Corrección Autónoma

**Fecha:** 2026-11-06 · **Rama:** `fix/reparacion-integral` (base `main`)
**Alcance:** ALBRA8/CRM-ALBRA · ALBRA8/WHATSPOWER · ALBRA8/WHATSPOWER-ULTRA
(YOUTUBE-AUTOMATION y AGENTE-GENERAL: fuera de alcance por orden de trabajo)

## 1. Estado inicial

- Los 3 repos en `main` con el cierre de seguridad previo (P0.x autenticación, fail-closed, CI).
- La rama de reparación integral añadió (antes de esta auditoría): HMAC v2 con secretos por organización, anti-replay durable (SQLite), claim atómico de cola en ULTRA, QR autenticado, pagos con máquina de estados, JWT-in-URL eliminado en CRM, lifecycle endurecido.

## 2. Proceso

- **5 auditores independientes** (arquitectura · seguridad · funcionalidad/UX · BD/backend/API · testing/DevOps) sobre las 3 ramas, solo lectura, hallazgos verificados con archivo:línea.
- **1 ciclo completo de auditoría + corrección + re-verificación** ejecutado en esta sesión (límite de seguridad: 10). Segunda pasada de verificación completa (tsc + suites + scanner en los 3 repos) tras corregir.

## 3. Hallazgos consolidados (deduplicados) y estado

### CRÍTICOS (1) — todos corregidos

| ID | Descripción | Archivo | Estado |
|---|---|---|---|
| C1 | Checkers 2B→2A (locks/supresión) sin Bearer → 401 permanente → toda campaña en fail-closed | ULTRA `src/safety/lock-checker.ts`, `suppression.ts` | ✅ Corregido (Bearer `INTERNAL_API_SECRET`) |

### ALTOS (5) — 4 corregidos, 1 documentado

| ID | Descripción | Archivo | Estado |
|---|---|---|---|
| A1 | CRM stage-change sin auth → Triggers morían en 401 silencioso | CRM `src/lib/whatspower-bridge.ts` | ✅ Corregido (Bearer + env) |
| A2 | WP crm-triggers: send_message/start_flow sin ejecutor real | WP `src/engine/crm-triggers.ts` | ⚠️ Documentado (requiere decisión de wiring; hoy no promete efectos que no ejecuta) |
| A3 | Flow Studio WP roto por puerta de auth (fetches sin Bearer) | WP `src/studio/studio-html.ts` | ✅ Corregido (puerta de clave + Bearer automático) |
| A4 | Visor /qr: callejón sin salida con clave correcta | WP `src/server.ts` | ✅ Corregido (shell siempre servido; /qr/data estricto) |
| A5 | Campaign Studio ULTRA roto por puerta de auth (8 fetches) | ULTRA `src/studio/campaign-studio-html.ts` | ✅ Corregido (idem A3) |

### MEDIOS (18) — 8 corregidos, 10 documentados con plan

| ID | Descripción | Estado |
|---|---|---|
| M1 | Guard de cola ULTRA permitía despachar PAUSED | ✅ Corregido |
| M2 | `idempotency_key` con formatos distintos CSV/webhook → doble envío | ✅ Corregido (unificada por hash) |
| M3 | `recoverFromCrash` mataba ítems en vuelo de réplicas vivas | ✅ Corregido (solo claims stale) |
| M4 | Updates post-claim sin guard `claimed_by` (multi-réplica) | ✅ Corregido |
| M5 | Dispatcher daemon sin paridad de `ALLOW_REAL_DISPATCH` | ✅ Corregido |
| M6 | 5 rutas ULTRA leían body sin límite (DoS memoria) | ✅ Corregido (readBody 1MB → 413) |
| M7 | Pagos WP: multi-escritura sin transacción + carrera no detectada | ✅ Corregido (`BEGIN IMMEDIATE` + changes) |
| M8 | `createPaymentLink` sin validación server-side (amount≤0, currency, teléfono) | ✅ Corregido |
| M9 | CI sin triggers en `fix/**` | ✅ Corregido (los 3 repos) |
| M10 | CRM: JWT de usuarios desactivados válidos hasta 7 días | ✅ Corregido (revocación al desactivar/degradar) |
| M11 | Rate-limit burlable vía XFF spoofing si el puerto queda expuesto | ⚠️ Mitigación documentada (Caddy reescribe XFF); fix TRUST_PROXY pendiente |
| M12 | XSS latente en studios (innerHTML con datos de leads/flujos) | ⚠️ Mitigado (gate de clave); escape completo pendiente |
| M13 | CRM: `Quote.number` sin `@@unique` + carrera de numeración | ⚠️ Documentado (migración Prisma + P2002 retry) |
| M14 | CRM: transacción de ingreso fuera de `$transaction` al aceptar quote | ⚠️ Documentado (refactor con ventana de prueba) |
| M15 | CRM: restauración de backup sin `$transaction` | ⚠️ Documentado (lotes + transacción) |
| M16 | CRM: sin `prisma/migrations` (solo `db push --accept-data-loss`) | ⚠️ Documentado (baseline requiere ventana con BD del dueño) |
| M17 | WP `lock-manager.acquireLock` sin upsert (500 en mensaje legítimo concurrente) | ⚠️ Documentado (INSERT ON CONFLICT) |
| M18 | Pasarelas con fallback sandbox silencioso (WOMPI/Stripe) | ⚠️ Documentado (fail-fast + guard pendiente) |

### BAJOS (12) — 4 corregidos, 8 documentados

Corregidos: `handle()` mapea P2002→409/P2025→404 y 500 genérico (CRM) · 4 rutas daemon→CRM con comparación timing-safe (CRM) · servidor WP escucha en 127.0.0.1 (WP) · `.env.example` sincronizados (3 repos).
Documentados: mínimo de contraseña 6→8 · SSRF admin-configurable `llmBaseUrl` (feature BYO-LLM, allowlist pendiente) · dead-code URL builders `getReportPdfUrl/ExcelUrl` · docstrings obsoletos (`export/csv`, FICHA v1) · variables env no documentadas (parcial resuelto) · `pilot-safeguards/bajas-circuit` fuera de CI (requieren `.env`) · botón "Historial" y paleta `addNode` sin handler en studios · FKs ausentes en tablas WP.

### INFORMATIVOS

Duplicación de primitivas de seguridad entre WP y ULTRA (150 líneas) — extraer lib compartida cuando exista monorepo/paquete. Artefactos de recuperación `crm_albra_recovered/`, `crm_albra_mirrored/` sin referencia — archivar fuera del árbol (decisión del dueño). PII en `pilot-config.ts` (ULTRA) — decisión del dueño.

## 4. Correcciones por archivo (resumen)

- **ULTRA:** `safety/lock-checker.ts`, `safety/suppression.ts`, `queue/broadcast-worker.ts`, `audiences/webhook-ingest.ts`, `server.ts`, `studio/campaign-studio-html.ts`, `.github/workflows/ci.yml`, `.env.example`
- **WP:** `payments/payment-gateway.ts`, `server.ts`, `studio/studio-html.ts`, `.github/workflows/ci.yml`, `.env.example`
- **CRM:** `lib/whatspower-bridge.ts`, `app/api/team/[id]/route.ts`, `app/api/_lib/shared.ts`, `app/api/whatsapp/{auto-reply,handoff,transcribe,describe-image}/route.ts`, `.github/workflows/ci.yml`, `.env.example`, `tests/*`

## 5. Verificación (Ciclo 2 — resultados reales)

| Repo | tsc --noEmit | Suite | Scanner secretos |
|---|---|---|---|
| CRM-ALBRA | 0 errores | **475/475** (52 archivos) | ✅ limpio |
| WHATSPOWER | 0 errores | **104/104** | n/a (sin scanner propio) |
| WHATSPOWER-ULTRA | 0 errores | **76/76** | n/a (sin scanner propio) |

## 6. Pendientes honestos (no bloquean CI; requieren dueño/ventana)

1. A2 (wiring de crm-triggers), M11 (TRUST_PROXY), M12 (escape HTML completo), M13–M17, M18, y bajos documentados — cada uno con causa raíz y fix propuesto en la tabla anterior.
2. Purga del historial git (credenciales muertas) — requiere force-push autorizado por el dueño.
3. Crear organizaciones/API keys reales en el CRM para producción plena del puente.
4. **Rotar el PAT publicado en el chat** (dos veces expuesto) — acción inmediata del dueño.

## 7. Veredicto

**Production Ready con reservas documentadas**: cero críticos abiertos, cero regresiones, suites íntegras y CI disparando en ramas de trabajo; los pendientes son de refuerzo/decisión de negocio, cada uno documentado con causa raíz y plan exacto. No se marca "producción plena" hasta completar los pendientes M13–M16 (datos) y la rotación del PAT.

---

# SEGUNDA REPARACIÓN INTEGRAL — 2026-11-06 (rama `fix/segunda-reparacion-integral`)

Nueva orden de trabajo (fase 2). Causas raíz corregidas y evidencia de cada bloque:

## §2.A Sesiones — revocación PERSISTENTE
- **Causa raíz:** `src/lib/session-invalidation.ts` usaba un `Map` en memoria (no persistente, no compartido, se perdía al reiniciar).
- **Corrección:** contador `tokenVersion` en BD (migración 1), claim `tv` en el JWT, guardas async `requireAuth/requireAdmin/requireSuperAdmin/requirePermission` que consultan la BD en cada petición (usuario existe + activo + `tv` vigente + org del token = org del usuario). Fail-closed ante fallo de BD. Revocación atómica dentro del MISMO update que desactiva/degrada (team PUT/DELETE) y en el reset de contraseña. 141 call sites migrados a `await`.
- **Pruebas:** `tests/integration/session-revocation.test.ts` (7): desactivación, reinicio (nuevo registro de módulos), multi-instancia (BD como única autoridad), flujo forgot→reset real, doble uso concurrente imposible, rol revocado, login de inactivo 403.

## §2.B Autorización y aislamiento
- **Auditoría** de las 110 rutas API: sin bypass cross-org explotable; `requireSuperAdmin` solo en `/api/super/overview`; ninguna ruta acepta `organizationId` del cliente.
- **Corrección de integridad referencial cross-org:** `assignedToId` (clients/opportunities), `quoteId` (transactions), `userId` (notifications), `clientId` (inbox/send) se validan contra la org antes de usarse.
- **Pruebas:** `tests/integration/cross-org-references.test.ts` (4 negativas con 2 orgs).

## §2.C Rate limiting y proxies
- **Causa raíz:** `clientIp()` confiaba ciegamente en `X-Forwarded-For` (falsificable); límites solo en memoria.
- **Corrección:** política `TRUST_PROXY`/`TRUST_PROXY_HOPS` (entrada derecha no falsificable; sin proxy declarado la cabecera se ignora); `dbRateLimit` PERSISTENTE en BD (tabla `RateLimitBucket`) para login/forgot/reset; límite de cuerpo 1 MB (413) en `readBody` y 25 MB en restore.
- **Pruebas:** `tests/unit/rate-limit-policy.test.ts` (6).

## §2.D Ciclo de vida de cuentas
- Consumo ATÓMICO del token de reset (`updateMany` condicional: doble uso concurrente imposible — probado); contraseñas ≥ 8; revocación por cambio de rol; logout con `allDevices` (bump persistente).

## §2.E Cotizaciones, pagos y datos
- `UNIQUE (organizationId, number)` en Quote + asignación de número con contador atómico (`OrgCounter`, upsert+RETURNING; la contención de transacciones interactivas paralelas en SQLite es patológica — eliminada del camino caliente).
- PUT con transición CAS + ingreso por aceptación DENTRO de la transacción (dos PUT concurrentes → EXACTAMENTE un ingreso — probado).
- Backup GET con snapshot en transacción (timeout 60s); restore TODO-O-NADA en una transacción con sufijo ante colisión de números y tope 25 MB.

## §2.F Migraciones
- Baseline `0_baseline` + migración aditiva `1_session_revocation_quote_uniqueness_ratelimit` (dedup NO destructivo de números duplicados históricos).
- Validado con evidencia: instalación limpia (`migrate deploy` OK) y BD existente con duplicados (P3005 → `migrate resolve --applied 0_baseline` → deploy → 0 duplicados, sin filas perdidas). Runbook completo en `docs/MIGRACIONES.md`.

## §7 CI
- Filtro de ramas reparado (estaba corrupto: `branches: ain, ...`).
- Lint sin `continue-on-error`: ratchet `scripts/lint-baseline.mjs` (baseline 328 errores preexistentes; los NUEVOS bloquean; las mejoras rebajan el baseline automáticamente).

## Resultados reales (esta rama)
- `npx tsc --noEmit`: 0 errores.
- Suite: **56 archivos, 499/499** pruebas (baseline previo 475; +24 nuevas).
- Build de producción `next build`: OK (en sandbox con heap limitado 1400MB por memoria del entorno).
- Escáner de secretos: ver apartado de la rama base; el token de GitHub usado para push viaja SOLO en la llamada de push (nunca en archivos/commits).
