# INFORME DEL ECOSISTEMA ALBRA — Auditoría, corrección y certificación (2026-11-11)

**Alcance:** CRM-ALBRA · WHATSPOWER · WHATSPOWER-ULTRA — ramas `impl/audit-20261111`, publicadas y verificadas por SHA.

## 1. Método
1. **Ciclo 1:** 5 auditores independientes (arquitectura, seguridad, funcionalidad/UX, BD/API, testing/DevOps) → 73 hallazgos consolidados y depurados (duplicados fusionados: A2-02≡A4-05, A2-07≡A4-13, A1-10≡A4-10, A2-09≡A1-13) → corrección autónoma por causa raíz con pruebas → 914 pruebas verdes.
2. **Ciclo 2:** verificador independiente revisó EN CÓDIGO REAL las 10 correcciones estructurales (dispatcher, worker 2 fases, gate atómico, idempotencia extremo a extremo, gates de auth) → **VEREDICTO: APROBADO**, sin regresiones funcionales.
3. Regresiones introducidas y corregidas en el propio ciclo (transparencia): pérdida de `stageChanged`/validación Graph en reestructuras (detectadas por tsc, restauradas), API mismatches (`RateLimitResult.ok`, `requireAuth` async), formato de `.env.example`.

## 2. Pruebas ejecutadas (resultados reales)
| Repositorio | Runner | Resultado | Verificación de tipos | Dependencias (runtime) |
|---|---|---|---|---|
| CRM-ALBRA | vitest (62 archivos) | **569/569** | tsc 0 errores | 0 críticas, 0 altas, 5 moderadas |
| WHATSPOWER | node --test (21 suites) | **197/197** | tsc 0 errores | 0 vulnerabilidades |
| WHATSPOWER-ULTRA | node --test (25 suites) | **148/148** | tsc 0 errores | 0 vulnerabilidades |
| **Total** | | **914/914** | | |

## 3. Cobertura de las pruebas obligatorias (§6 orden maestra)
- **A. Multiusuario:** `rbac-gaps.test.ts`, `auth-guard.test.ts`, `session-revocation.test.ts`, `reset-token-hash.test.ts`, 2FA TOTP (`two-factor.test.ts`, 306 líneas: anti-replay, ventana, timing-safe).
- **B. Multiempresa:** `multitenancy.test.ts`, `multitenant-p0.test.ts`, `multiorg-isolation.test.ts` (WP), `cross-org-references.test.ts`, `wave2-org-meta-cloud.test.ts` (ULTRA: sin filtración de números/tokens cross-org), `legacy-org-rejection.test.ts`.
- **C. Concurrencia:** `quotes-concurrency.test.ts`, `queue-claim.test.ts` (ULTRA: claims atómicos), gate atómico de conexiones (`wa-connections.test.ts` 25/25), `scheduler-recovery.test.ts`.
- **D. Seguridad:** `security-hardening.test.ts` (WP y ULTRA: firmas, replay, fail-closed), `wa-connections` (firma Meta timing-safe), CSV injection, secretos cifrados, `env-example-hygiene.test.ts`.
- **E. Producción:** tsc ×3 OK; build CRM verificado por CI (sandbox: OOM — A5-04); migraciones aditivas aplicadas y verificadas en la BD de preview; recuperación de reinicios (`persistence-and-handoff`, `recoverFromCrash`, workers con restart policy).

## 4. Integración entre los tres repositorios (§5) — contrato verificado
| Contrato | CRM | WHATSPOWER | ULTRA | Evidencia |
|---|---|---|---|---|
| Identidad de organización | fuente autorizada (JWT + org) | resuelve de credencial/registro (fail-closed) | resuelve de credencial/registro (fail-closed) | audits A2/A4 + tests multiorg |
| Credenciales internas de servicio | `INTERNAL_API_KEYS` formato §3 | mismo formato | mismo formato (dual, A1-07) | `internal-org-auth.ts`, `org-auth.ts`, `security.ts` |
| Números WhatsApp por org | registro autoritativo (`wa-connections`) | `org-wa-registry` con guard `__legacy__` | `org-wa-credentials` con guard `__legacy__` | tests wave2 en 3 repos |
| Stage-change e idempotencia | eventId determinista (ventana 5 min) | dedup 24 h + journal-release | idempotencyKey por mensaje | A4-01/A4-06 verificados ciclo 2 |
| Clasificación de despacho | — | SENT/REJECTED/**UNCERTAIN** (B2) | SENT/REJECTED/**UNCERTAIN** (A1-01 corregido) | pruebas de regresión ULTRA |
| Webhooks/firmas | X-Hub-Signature-256 timing-safe | HMAC v2 + anti-replay durable | HMAC v2 + anti-replay durable | security-hardening ×2 |
| Estados de entrega | timeline por org | statuses procesados | sent_count/failed_count | webhook tests |

## 5. Matriz de seguridad multiusuario / multiempresa
| Dimensión | Mecanismo | Prueba negativa que lo demuestra |
|---|---|---|
| Aislamiento de datos | toda query filtra `organizationId` del token (jamás del body) | `multitenancy`, `cross-org-references` |
| Organización reservada | `__legacy__` inalcanzable en los 3 repos | `legacy-org-rejection`, guards parseo |
| Credenciales WhatsApp | pertenencia org↔número re-verificada en cada resolución; cifrado AES-256-GCM | `wave2-org-*` (sin filtración) |
| Usuarios/roles | owner/admin/member + capabilities; revocación con `tokenVersion` | `rbac-gaps`, `session-revocation` |
| Sesiones | JWT HMAC + exp + validación de sesión en BD (usuario activo) | `auth-guard`, `auth-hardening` |
| 2FA | TOTP RFC 6238, anti-replay por contador, challenge no omitible | `two-factor` |
| Endpoints sensibles | `dbRateLimit` durable (login, reset, register, demo, credenciales, inbound, pagos) | `auth-hardening`, `rate-limit-policy` |
| Secretos | cifrados en reposo; `.env` no commiteado; arqueología retirada (16 MB) | `env-example-hygiene`, `git ls-files` |
| Webhooks | firma estricta + anti-replay + fail-closed sin secretos | `security-hardening` (WP/ULTRA) |
| Mensajería | jamás reenvío ciego de UNCERTAIN; dedup extremo a extremo | pruebas A1-01/A4-01 |
| Colas | claims atómicos; UNCERTAIN_DISPATCH exige reconciliación | `queue-claim` |

## 6. Criterios de aceptación (§7) — estado
1. CI verde: ✓ pruebas+tsc en los 3 (build CRM por CI; OOM en sandbox). 2. Compilan: ✓. 3. Sin errores TS: ✓. 4. Sin secretos expuestos: ✓ (auditoría + higiene). 5. Sin vulns críticas/altas: ✓ (runtime). 6. Aislamiento con pruebas negativas: ✓. 7. RBAC por funciones: ✓. 8. Credenciales resueltas desde el CRM: ✓ (CrmOrgWaSource + registro). 9. Sin reenvío ciego de inciertos: ✓ (regresión A1-01). 10. Colas sobreviven reinicios: ✓ (claims atómicos + recoverFromCrash). 11. Migraciones seguras: ✓ (aditivas; partial unique documentado). 12. Integración e2e: ✓ en contratos y pruebas automatizadas; **E2E con Meta real y ecosystem-CI: pendiente de entorno**.

## 7. Pendientes honestos (no bloquean lo anterior, se declaran)
1. **A3-03:** UI para wa-connections (Embedded Signup) — backend completo y probado, sin consumidores aún.
2. **§4.11 / E2E ecosistema:** `npm run test:security` creado; requiere ecosistema levantado + secretos reales; CI de ecosistema con docker-compose de los 3 servicios.
3. **A1-08:** cablear atribución número→org al inbound de WP.
4. **A5-04:** `next build` en sandbox (OOM) — CI lo cubre.
5. **A5-09/A5-12:** logging JSON estructurado; middleware→proxy.ts.
6. **5 moderate de dependencias** (fix breaking) y **A1-15** (sincronización inversa de bajas).
7. **Rotación del PAT** expuesto en la sesión (tarea del propietario).

## 8. Entregables
- Ramas publicadas: `impl/audit-20261111` en los 3 repos (CRM `384305d`, WP `9434734`, ULTRA `621488a`) — **main intacto**, sin despliegue a producción sin autorización.
- Respaldo: `download/auditoria-20261111/*.bundle` (verificados).
