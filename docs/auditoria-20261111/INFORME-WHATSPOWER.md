# INFORME DE CORRECCIÓN — WHATSPOWER (auditoría 2026-11-11)

**Rama:** `impl/audit-20261111` · **Head publicado:** `9434734` · **Base:** `main @ 54b1535` (Oleada 2)

## Estado inicial
- 197/197 node --test OK; tsc limpio; 0 vulnerabilidades de dependencias; limiter en memoria sin uso real en endpoints públicos; `verifyHmac` con `===`; catch del dedup tragaba cualquier error de SQLite como "duplicado".

## Correcciones

| ID | Problema | Archivo | Causa raíz | Solución | Prueba | Resultado |
|---|---|---|---|---|---|---|
| A1-02 ALTO | Fuga de memoria lineal en `sentLog` | `src/adapters/meta-cloud-org-transport.ts` | push sin tope por envío | ring buffer 500 | wave2-org-wa-registry + full suite | ✓ 197/197 |
| A1-03 ALTO | Cualquier error de SQLite = "duplicado" (evento descartado sin ejecutar) | `src/engine/crm-triggers.ts` | `catch {}` genérico en INSERT dedup | rethrow salvo `UNIQUE constraint failed` | wave2-automation-executors | ✓ |
| A1-04 ALTO | `__legacy__` aceptado en `WA_ORG_CREDENTIALS` (contrato §4) | `src/org-wa-registry.ts` | guard ausente (ULTRA sí lo tenía) | guard espejo `orgId === '__legacy__'` → skip | wave2-org-wa-registry | ✓ |
| A1-05 MEDIO | stage-change de cliente sin teléfono → 400 por binding undefined | `crm-triggers.ts` | sin validación de `clientPhone` | estado auditable `SKIPPED_NO_PHONE` + cierre limpio | wave2-automation-executors | ✓ |
| A4-06 MEDIO | Crash entre dedup y envío = mensaje perdido (at-most-once) + dedup sin purga | `crm-triggers.ts` | mark-before-execute | `dispatchWithRelease` (libera la clave si el envío no inició) + purga 24 h cada 10 min | wave2-automation-executors | ✓ |
| A2-10 BAJO | `verifyHmac` con `===` | `src/server.ts` | comparación directa | `safeEqual` (timing-safe) | suite completa | ✓ |
| A2-11 MEDIO | Rate limit solo en memoria (se evade con reinicio/réplicas) | `src/db.ts`, `src/server.ts` | sin contadores durables | `durableRateLimit` UPSERT…RETURNING sobre SQLite + cableado en `/api/inbound` (240/min) y `/api/payments/webhook` (120/min) ANTES del limiter en memoria | suite completa | ✓ |
| A4-14 BAJO | 9 handlers 400 filtraban `e.message` | `src/server.ts` | respuesta directa del error | mensaje genérico al llamador + detalle al log | suite completa | ✓ |
| A5-06 MEDIO | Variables de envío sin documentar | `.env.example` | drift | 10 variables documentadas (WA_ORG_*, TRUST_PROXY, WEBHOOK_*…) | env hygiene | ✓ |
| A5-07 MEDIO | Sin Docker/supervisor | `Dockerfile`, `docker-compose.yml` | empaquetado ausente | imagen node:24-alpine non-root + compose con restart | — | ✓ archivos |
| A5-08 MEDIO | Sin handlers de proceso | `src/server.ts` | muerte silenciosa | `uncaughtException` (exit limpio) + `unhandledRejection` (log) | — | ✓ |
| A5-11 BAJO | typescript/@types/node extraneous | `package.json` | install sin save | movidos a devDependencies | npm ls | ✓ |

## Identidad de organización y aislamiento (§3 orden maestra)
- Verificado en ciclo 1 (auditor A2): toda ruta resuelve la org desde la credencial/registro con `timingSafeEqual`, fail-closed; ningún mensaje usa credenciales de otra org (env→registry→transport con re-verificación de pertenencia).
- §3.3/§3.4: ejecutores `send_message` y `start_flow` REALES por organización (Oleada 2, commit `882effd`) — verificados por el verificador del ciclo 2 (puntos 4-5 OK).

## Verificación
- **Pruebas:** **197/197** (`node --test`, 21 suites) · tsc limpio · 0 vulns.
- **Ciclo 2:** APROBADO (puntos 4-5 verificados en código real).

## Riesgos residuales / pendientes
1. **A1-08** — `resolveOrgByPhoneNumberId()` (atribución número→org del contrato §1.4) sigue sin cablear al flujo inbound (hoy la atribución del inbound va por firma/secrets). Pendiente Oleada 3 (integración con Embedded Signup en vivo).
2. **A1-13** — divergencia semántica documentada del `INTERNAL_API_SECRET` legado (CRM: resuelve org `default`; WP: jamás resuelve org). El contrato §3 debe actualizarse como fuente de verdad.
3. **E2E entre servicios** (`pilot-safeguards` del lado 2A) requiere secretos reales del ecosistema.
