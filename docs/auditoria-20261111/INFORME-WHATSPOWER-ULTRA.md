# INFORME DE CORRECCIÓN — WHATSPOWER-ULTRA (auditoría 2026-11-11)

**Rama:** `impl/audit-20261111` · **Head publicado:** `621488a` · **Base:** `main @ 25bc761` (Oleada 2)

## Estado inicial
- 145/145 node --test OK pero **6 errores TypeScript en tests** (CI rojo); `MetaCloudDispatcher` jamás devolvía `uncertain` (reenvío masivo duplicado posible); `ADMIN_API_KEYS` descartaba credenciales en formato contrato; listas sin paginar; createCampaign sin atomicidad.

## Correcciones

| ID | Problema | Archivo | Causa raíz | Solución | Prueba | Resultado |
|---|---|---|---|---|---|---|
| A1-01 CRÍTICO | Timeout/5xx → fallo "confirmado" → FAILED_RETRYABLE → **reenvío masivo duplicado** | `src/adapters/meta-cloud-dispatcher.ts` | sin clasificación B2 (el tipo ya tenía `uncertain`; nunca se emitía) | espejo del contrato §7: 5xx/timeout → `{success:false, uncertain:true}`; solo rechazables (400/401/403/404/410/413/422/429) son fallo confirmado | **3 pruebas nuevas de regresión** (500→uncertain, 400→confirmado, throw→uncertain) | ✓ 148/148 |
| A1-02 ALTO | Fuga lineal en `dispatchedMessages` | `meta-cloud-dispatcher.ts` | push sin tope | ring buffer 500 | suite | ✓ |
| A1-07 MEDIO | `ADMIN_API_KEYS` formato contrato descartado por el filtro | `src/security.ts` | parse `key:org` invertido vs contrato §3 | dual-format por longitud del secreto (≥16); filtro sobre la KEY | security-hardening (ORG-01..03) | ✓ |
| A2-04 MEDIO | Login del Studio con `===` | `src/server.ts` | comparación directa | `safeEqual` sobre TODAS las claves (sin early-return) | security-hardening | ✓ |
| A4-10 MEDIO | `GET /api/campaigns` y detalle serializan TODO (100k ítems = OOM) | `src/server.ts`, `broadcast-worker.ts` | `SELECT *` sin límites | paginación `?limit/?offset` (1..500) + detalle con `?itemsLimit` + `itemsTotal`; `getItems(limit?)` | security-hardening (listas) | ✓ |
| A4-11 MEDIO | Campaña a medias si crashea a mitad; N+1 de escrituras | `broadcast-worker.ts` | INSERT por contacto con HTTP entremezclado | 2 fases: clasificación HTTP sin escrituras + transacción única BEGIN/COMMIT/ROLLBACK | suite completa | ✓ |
| A4-15 BAJO | `POST /api/campaigns` devolvía 200 | `server.ts` | semántica REST | **201 Created** (tests actualizados) | security-hardening ORG-02/03 | ✓ |
| A5-02 ALTO | 6 errores TS en tests (CI rojo) | 2 archivos de test | fixtures vs firma actual | anotaciones `captured` completas + fixture sin `accessToken` global | `tsc --noEmit` exit 0 | ✓ |
| A5-06 MEDIO | env sin documentar (10 vars) | `.env.example` | drift | WORKER_*, META_ORG_*, salvaguardas piloto documentadas; obsoletas marcadas | — | ✓ |
| A5-07 MEDIO | Sin Docker/supervisor | `Dockerfile`, `docker-compose.yml` | empaquetado ausente | server + worker como servicios con `restart: unless-stopped` | — | ✓ |
| A5-08 MEDIO | Sin handlers de proceso | `server.ts`, `worker-main.ts` | muerte silenciosa | uncaughtException→exit limpio; unhandledRejection→log (worker no muere) | — | ✓ |
| §4.11 | Suites de seguridad excluidas del flujo habitual | `package.json` | son E2E entre servicios | `npm run test:security` creado; **su ejecución requiere el ecosistema levantado** | local: 2/2 FALLAN sin 2A viva (documentado, no se declara verde) | ⚠ pendiente |

## Aislamiento multiempresa (§4 orden maestra)
- Cada campaña despacha con credenciales de SU organización (registro fail-closed); **CrmOrgWaSource ya está en la cadena por defecto** cuando `CRM_INTERNAL_CREDENTIALS` está definido (`org-wa-credentials.ts:214`) — §4.4 verificado sin cambios.
- Resultado incierto → `UNCERTAIN_DISPATCH` (NUNCA reenvío a ciegas) — criterio de aceptación §7.9 cumplido con prueba de regresión.
- Claims de cola atómicos `UPDATE … WHERE status='PENDING'` (reinicio no duplica trabajos) — §7.10.

## Verificación
- **Pruebas:** **148/148** · `tsc --noEmit` exit 0 · 0 vulns de dependencias (runtime stdlib-only).
- **Ciclo 2:** APROBADO (puntos 1-3 verificados en código real, incluido ROLLBACK correcto y saveItem sin awaits en la transacción).

## Riesgos residuales / pendientes
1. **§4.11** — E2E de seguridad requiere ecosistema 2A viva + secretos; CI de ecosistema pendiente (docker-compose de los 3 servicios).
2. Supresión compuesta: reactivación de baja en 2A no propaga inversa a ULTRA (conservador; política documentada) — A1-15.
3. Heurística de `parseAdminKeys`: un legado cuyo segmento tras `:` mida ≥16 se interpretaría como contrato (mitigado por el filtro final de longitud de key).
