# INFORME DE CORRECCIÓN — CRM-ALBRA (auditoría 2026-11-11)

**Rama:** `impl/audit-20261111` · **Head publicado:** `384305d` · **Base:** `main @ 5f60618` (Oleada 2)

## Estado inicial
- 62 archivos de prueba / 568 tests vitest OK; tsc limpio; npm audit: 1 critical + 3 high (next 16.1.1, sharp, zod, js-yaml); ~16 MB de arqueología commiteada (`crm_albra_mirrored/`, `crm_albra_recovered/`); eventId del stage-change aleatorio (idempotencia CRM→WHATSPOWER inoperante).

## Correcciones (problema → causa raíz → solución → commit → prueba)

| ID | Problema | Archivo | Causa raíz | Solución | Commit | Prueba | Resultado |
|---|---|---|---|---|---|---|---|
| A4-01 CRÍTICO | Mensaje duplicado al cliente en retry del PUT | `src/lib/whatspower-bridge.ts` | eventId `randomUUID()` por envío; el dedup del receptor no ve el reintento | `deriveStageEventId` HMAC determinista con ventana de 5 min + tests misma/distinta ventana | `502dcf6` | `whatspower-bridge.test.ts` | ✓ verde |
| A1-06 ALTO | webhook-secret usado como Bearer admin → 401 silencioso | `whatspower-bridge.ts` | fallback de `WHATSPOWER_WEBHOOK_SECRET` en la cadena de auth | eliminado el fallback; solo credencial por-org o `WHATSPOWER_INTERNAL_API_SECRET`; resultados `{sent}` honestos | `502dcf6` | test A1-06 (Bearer exacto + no_config) | ✓ |
| A4-03 ALTO | Doble ingreso por cierre concurrente; efectos pre-update | `src/app/api/opportunities/[id]/route.ts` | guard read-then-write; auditoría/workflows antes del update | claim `updateMany({status:{not:'won'}})`→409; efectos POST-COMMIT | `30cc6be` | suite oportunidades | ✓ 569/569 |
| A4-02 ALTO | Auto-respuesta IA duplicada (Meta re-entrega webhook) | `src/app/api/whatsapp/webhook/route.ts` | sin dedup por `message.id`; procesamiento inline lento | dedup por (org, waMessageId) + índice único parcial (migración 4) | `30cc6be` | suite webhook | ✓ |
| A4-04 ALTO | Clientes duplicados del mismo contacto | `src/lib/integrations.ts`, `daemon.mjs` | find-then-create sin restricción | índice único parcial `(organizationId, phone)` + recuperación P2002 (re-find) | `30cc6be` | multitenancy/clients | ✓ |
| A2-01 ALTO | `/api/auth/demo` sin gate en producción | `src/app/api/auth/demo/route.ts` | endpoint abierto a anónimos | `DEMO_MODE` obligatorio en prod + `dbRateLimit` 10/h por IP | `502dcf6` | auth-guard | ✓ |
| A2-02/A4-05 MEDIO | `err.message` crudo en 500s (~40 rutas) | `src/lib/api-helpers.ts` | handler duplicado sin máscara | mapeo P2002→409, P2025→404, 500 genérico; detalle solo al log | `502dcf6` | suite general | ✓ |
| A2-05 MEDIO | CSV injection en exports | `src/lib/csv.ts` | `escapeCsv` sin neutralizar fórmulas | prefijo `'` a celdas `= + - @` | `502dcf6` | export-csv | ✓ |
| A2-03 MEDIO | Sesión revocada seguía leyendo config interna | `src/app/api/nicho/route.ts` | `getAuth` sin validación de estado | `getAuth` + `assertSessionState` solo en rama autenticada (ruta pública anónima preservada) | `502dcf6` | nicho-isolation 10/10 | ✓ |
| A2-06 MEDIO | Registro ilimitado; contraseña de 6 | `src/app/api/auth/register/route.ts` | sin rate limit durable | `dbRateLimit` 20/h por IP + mínimo 8 | `502dcf6` | auth-guard | ✓ |
| A4-07 MEDIO | Org huérfana si el registro falla a mitad | `register/route.ts` | 4 escrituras sin transacción | `$transaction` org+user (núcleo atómico) | `502dcf6` | auth-hardening | ✓ |
| A1-09 MEDIO | Webhook procesaba solo `entry[0].changes[0]` | `whatsapp/webhook/route.ts` | FASE 1 sin iteración | iteración completa de entries/changes | `30cc6be` | webhook suite | ✓ |
| A1-11 MEDIO | `state` de Embedded Signup reutilizable | `src/lib/wa-connections.ts` | nonce nunca se consumía | nonces de un solo uso con TTL 15 min | `30cc6be` | wa-connections 25/25 | ✓ |
| A1-12 MEDIO | Rate limit por proceso en credenciales | `internal/whatsapp/credentials` | Map en memoria | `dbRateLimit` durable por org | `502dcf6` | wa-connections | ✓ |
| A2-07/A4-13 MEDIO | `telegramSecret` y `webhookVerifyToken` en claro | telegram routes, `wa-connections.ts` | sin convención *Enc | cifrado AES-256-GCM + lookup por hash (columna nueva) | `30cc6be` | telegram/backup tests | ✓ |
| A2-09/A1-13 BAJO | Secreto global resolvía org con keys presentes | `src/lib/internal-org-auth.ts` | orden de evaluación | legado activo SOLO sin `INTERNAL_API_KEYS` | `502dcf6` | rbac-gaps | ✓ |
| A2-12 BAJO | verify_token GET no timing-safe | whatsapp/facebook webhooks | comparación `===` | `safeEquals` | `30cc6be` | security tests | ✓ |
| A2-14 BAJO | 16 MB de arqueología commiteada | `crm_albra_mirrored/`, `crm_albra_recovered/` | restos de recuperación | `git rm` (sin referencias, verificado) | `30cc6be` | tsc sin ruido | ✓ |
| A4-08/A4-09/A4-12 MEDIO | Índices/huérfanos/import N+1 | schema, clients delete, import/csv | deuda de esquema | @@index stageId/opportunityId, deleteMany timeline, pre-carga de teléfonos | `30cc6be` | migración aplicada en preview | ✓ |
| §2.1 orden maestra | Carrera en creación de conexiones/límite de plan | `src/lib/wa-connections.ts` | count-then-create | transacción interactiva (gate+unicidad+create) + retry BUSY + P2002→duplicate | `384305d` | wa-connections 25/25 | ✓ |
| A5-01/A5-03 CRÍTICO/ALTO | Next advisory crítico + 3 HIGH runtime | `package.json` | dependencias viejas | next 16.4.6, sharp 0.35.5, zod 4.6.7, js-yaml 5.5 (override), nodemailer 10.1.4 | `8baba22` | npm audit: 0C/0H/5M; 569/569 | ✓ |
| A3-01…A3-11 | UI muerta/botones 404/responsive | settings-page, whatsapp-page, client-form-dialog, views.ts, api.ts | features huérfanas | pestaña Inventario retirada; `/api/email/test` real; `/chat` fantasma eliminada; etc. | `384305d` | 569/569 | ✓ |

## Verificación
- **Pruebas:** 62 archivos / **569/569 vitest** · `tsc --noEmit` limpio.
- **BD:** migración 4 aplicada (2 índices + 2 únicos parciales verificados en `custom.db`); `postinstall: prisma generate` añadido (A5-05).
- **Dependencias runtime:** 0 critical, 0 high, 5 moderate (PrismJS vía react-syntax-highlighter; fix breaking — Oleada 4).
- **Verificador ciclo 2:** APROBADO (puntos 6, 7, 9, 10 verificados en código real).

## Riesgos residuales / pendientes
1. **A3-03** — el stack wa-connections (Embedded Signup) no tiene UI: endpoints operativos y probados, sin consumidores. Programado (sección de Settings).
2. **A5-04** — `next build` OOM en sandbox (exit 137): BLOQUEADO-por-entorno; CI lo ejecuta en runners.
3. **A5-12** — middleware → proxy.ts (deprecación futura de Next).
4. **A1-08** — `resolveOrgByPhoneNumberId` (WP) sin cablear al inbound (ver informe WP).
5. 5 moderate de dependencias con fix breaking.
