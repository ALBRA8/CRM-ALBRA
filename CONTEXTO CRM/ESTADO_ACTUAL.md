# Estado actual

**Base revisada:** rama main; README, esquema Prisma, daemon Baileys, webhook Instagram y docs/HARNESS.md. Revisión selectiva, sin ejecutar pruebas ni inspeccionar el despliegue.

## Capacidades declaradas
CRM multi-tenant con organizaciones, usuarios, clientes, oportunidades, pipeline, reservas, cotizaciones, finanzas, reportes, equipo, automatizaciones, WhatsApp, Instagram, Telegram, Google, SMTP, contratos REST/MCP y memoria MemoryDV. Docker separa aplicación y daemon WhatsApp. Son declaraciones de documentación, no certificación de producción.

## Evidencia en código
- Organization es raíz del esquema Prisma y modelos comerciales usan organizationId.
- Integration.organizationId tiene restricción única: una configuración Integration por organización, no un registro N-a-N de cuentas por canal.
- daemon.mjs mantiene un socket, estado de conexión y linkedOrgId globales; la sesión Baileys se almacena en un directorio local. No acredita múltiples sesiones simultáneas.
- Webhook Instagram verifica HMAC, pero permite matching cuando instagramAccountId no está configurado. Se requiere resolución exacta y no ambigua.
- docs/HARNESS.md describe REST /api/crm/actions, MCP /api/mcp y MemoryDV.

## Actualización de seguridad — 2026-11-05

**Importante:** los siguientes avances provienen de informes de ejecución compartidos en la conversación. Se registran como resultados reportados; esta actualización documental no inspeccionó el código ni reprodujo las pruebas de forma independiente.

### P0.1 — WhatsApp Baileys multi-organización
**Estado reportado: implementado y probado; pendiente de verificación independiente del remoto y del código desplegado.**

- Sesiones independientes por organización mediante Map<orgId, sesión>.
- Credenciales separadas en .wa-auth/<orgId>/, con socket, QR, teléfono, reintentos y errores propios.
- Callbacks/eventos cerrados sobre orgId y validación estricta del identificador antes de acceder al disco.
- /connect, /disconnect, /send, /qr y /conversations requieren organización.
- Compatibilidad de /send sin orgId solo cuando existe exactamente una sesión conectada; con dos o más, responde 409.
- Proxy CRM deriva orgId del JWT y no confía en el body del cliente.
- Migración del layout legado reportada como no destructiva, conservando metadata .bak.
- Pruebas reportadas: 17 unitarias nuevas, suite 422/422, TypeScript 0 errores y smoke en vivo 13/13, incluyendo intento de acceso cruzado entre organizaciones con respuesta 403.
- Commit reportado: c2f4001 en main y fix/saas-security-and-stabilization.
- stable-production reportada intacta en ea87cc2.
- Documentación reportada: docs/P0.1-aislamiento-whatsapp-multiorg.md.

La revisión inicial de esta carpeta describía un socket y linkedOrgId globales. Ese hallazgo queda como antecedente histórico y debe considerarse supersedido por el cambio reportado, no como evidencia del estado actual del código.

### P0.2 — Aislamiento de ejecuciones del Doctor
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

### P0.3 — Endpoint público /api/nicho
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

### P0.4 — Secretos inseguros
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

## Verificación independiente — 2026-11-06 (sesión de cierre CP-Sec-01)

**Método:** verificación directa sobre el árbol local (main @ remoto verificado con ls-remote), ejecución de la suite completa, TypeScript, build y escáner de secretos en el sandbox. Los estados cambian de "reportado" a "verificado directamente".

### P0.1 — WhatsApp Baileys multi-organización — VERIFICADO DIRECTAMENTE
- Commit c2f4001 ∈ main confirmado con `git merge-base --is-ancestor`; código de sesiones por orgId presente (`src/lib/whatsapp-session-verdict.ts`, rutas `src/app/api/whatsapp/*` con proxy ligado al JWT).
- Pruebas de aislamiento ejecutadas localmente: `tests/unit/whatsapp-session-verdict.test.ts` dentro de la suite completa 464/464 (51 archivos) en 74s.

### P0.2 — Aislamiento de ejecuciones del Doctor — VERIFICADO DIRECTAMENTE
- `tests/unit/doctor-isolation.test.ts` ejecutándose en verde: D1 escritura cross-tenant imposible, D2 lectura scoped, D3 rol member/agent → 403, D4 anónimo → 401, D5 sesión por org, D6 parámetros del cliente no alteran alcance.

### P0.3 — Contrato público/privado de /api/nicho — VERIFICADO DIRECTAMENTE
- `src/app/api/nicho/route.ts`: GET lectura pura, orgId desde identidad (el del cliente se ignora y se registra), sin creación en GET.
- `tests/unit/nicho-isolation.test.ts` en verde: N1–N10 (401 anónimo, campos públicos, 404 genérico, 400 traversal, JWT manda, 429 rate-limit, 403 member, body orgId ignorado, 404 org inactiva, no crea filas).

### P0.4 — Secretos y arranque fail-fast — VERIFICADO DIRECTAMENTE
- `src/lib/env-guard.ts` + `tests/unit/env-guard.test.ts` en verde (secrets débiles/conocidos rechazados al arranque).
- Escáner `scripts/scan-secrets.mjs` (nuevo, con pruebas 11/11 y npm run security:scan): árbol LIMPIO.
- **Purga de artefactos de credenciales (CP-Sec-01):** eliminados del árbol `scripts/e2e-token.txt`, `e2e-wp-token.txt`, `e2e-wp-apikey.json`, `e2e-apikey.txt`, `e2e-wp-key.txt` (ya redactados desde bb8ec07; valores históricos verificados como MUERTOS: tabla ApiKey de la DB viva con 0 filas y JWTs que no firman con ningún secreto actual). Reglas .gitignore anti-reintroducción.
- **Secreto de daemon antiguo purgado de 5 scripts** (`e2e-wp-guard.ts`, `e2e-wp-ultra.mjs`, `e2e-wp-ultra-engine.ts`, `bootstrap-e2e-postpub.sh`, `bateria-rotacion.sh`): ahora fail-fast desde entorno. Verificado con el daemon vivo: el valor antiguo responde 401.

### Otros cambios de esta sesión
- Eliminado `scripts/start-whatspower-detached.mjs` (código operativo de otro repositorio con ruta absoluta; el launcher de WP vive en ALBRA8/WHATSPOWER desde 7f38030).
- TypeScript `tsc --noEmit`: 0 errores. Build de producción: OK (standalone generado). Lint: baseline preexistente del repo con 358 errores/5089 avisos NO introducidos por esta sesión (archivos modificados: 0 errores); limpiar el baseline queda como pendiente.
- stable-production: intacta en ea87cc2 (local y remoto).

## Compatibilidad Windows y aislamiento de tests — RESUELTA LA ATRIBUCIÓN
El commit 658740b fue **localizado y verificado en ALBRA8/YOUTUBE-AUTOMATION** (cuarto repositorio del ecosistema, confirmado por el propietario). No pertenece a CRM-ALBRA. Ver sección YT-AUTOMATION del informe de cierre; el caso queda cerrado para este repositorio.

## Conclusión
CRM multi-tenant con P0.1–P0.4 verificados directamente en código y con la suite completa en verde (464/464, tsc 0 errores, build OK, escáner de secretos limpio). El bloqueo de seguridad restante en ESTE repositorio es la exposición histórica de artefactos E2E en el historial git (valores muertos, verificados) que requiere purga con filter-repo y force-push autorizado por el propietario, y el baseline de lint preexistente.

<!-- FUSIÓN repair/integral-20261106 + fix/b1-dashboard-org-isolation: se conservan ambos relatos -->
## Estado según repair/integral-20261106 (rama integral)
## Reparación General Integral — 2026-11-06 (rama `repair/integral-20261106`)

Trabajo verificado en esta sesión (no solo reportado): commits B1→B9 en `repair/integral-20261106`.

- **Autenticación**: JWT restringido fuera de URLs (solo descargas con opt-in + download-tokens de 5 min); rate limiting en login/forgot/reset/register/demo/MCP/crm-actions/email; tokens de reset hasheados (sha256, un solo uso); revocación de sesiones por `User.tokenVersion` (logout/reset/desactivación).
- **Datos**: restauración de backup atómica en transacción con tope 25 MB y reporte; sin inyección cross-org.
- **Secretos**: escáner reforzado con allowlist y baseline histórico explícitos y verificables (huellas sha256-12, jamás valores); escaneo del historial COMPLETO; CI bloqueante solo para hallazgos NUEVOS. 78 hallazgos históricos con estado ROTACION-PENDIENTE (ver PENDIENTES.md).
- **Integración**: puente CRM→WHATSPOWER al contrato HMAC v1.1.0 (`timestamp.body`); `docs/INTEGRATION_CONTRACT.md`.
- **Observabilidad**: `auth.login_failed` y `rbac.denied` en security-log.
- **CI**: secret-scan árbol+historial bloqueantes, tsc, lint con baseline de reducción progresiva, tests, build, npm audit informativo.
- **Pruebas**: 501/506 locales (los 5 fallos son del WIP concurrente de terceros en archivos sin seguimiento; en checkout limpio el gate de independencia pasa 4/4 — verificado con worktree). tsc limpio en árbol versionado; security:scan y security:scan:history exit 0.
- **No se tocó** `stable-production`, no se desplegó, no se activaron envíos reales, y NO se modificó el trabajo concurrente sin seguimiento de terceros (chat/agent).

## Reparación general integral — cierre de ejecución 2026-11-06 (ramas repair)

**Método:** ejecución directa sobre ramas `repair/integral-20261106` en los TRES repositorios (CRM-ALBRA, WHATSPOWER, WHATSPOWER-ULTRA), verificación por suites reales (sin continue-on-error ni mocks que oculten fallos), push verificado con ls-remote posterior.

### CRM-ALBRA (Capa 0) — rama repair @ 0ebb48f
- B1–B9 verificados en esta sesión: tsc 0 errores; suite 500/500 (56 archivos); escáner de secretos del árbol LIMPIO; escáner del historial COMPLETO en verde con entradas allowlist/baseline explícitas para fixtures dummy verificados (huellas sha256-12; commits 171f2319, c1ed7015, 7f5fb6c6 — este último solo alcanzable desde main local de sandbox, jamás empujado).
- Puente CRM→2A al contrato HMAC v2 confirmado: `signWhatspowerPayload` firma `timestamp.body` con el MISMO ts firmado y enviado, y `eventId` en el payload.
- CI con lint:baseline bloqueante (sin continue-on-error para errores nuevos) + secret scanners bloqueantes + tsc + suite + build.

### WHATSPOWER (Capa 2A) — rama repair @ a82880b
- HMAC v2 (timestamp dentro de la MAC, ±300 s, timing-safe) + anti-replay PERSISTENTE en SQLite (`webhook_replay`, purga >600 s, sobrevive reinicios — probado entre instancias).
- Multi-organización: `INTERNAL_API_KEYS="orgId:secreto[:rol]"` (legado → org default/admin), roles admin para liberar locks y eliminar supresiones, X-Org-Id solo restringe (403), secretos de webhook por organización (el secreto validado VINCULA la org; orgId del payload contradictorio → 403).
- Esquema v3 org-scoped con migración reversible documentada (docs/MIGRACION-ORG-SCOPED.md: copia .bak pre-migración, transacción única con ROLLBACK, datos heredados → org 'default').
- /qr y /qr/data protegidos (jamás QR a anónimos; /qr/data exige rol admin); idempotencia atómica por reclamación (INSERT OR IGNORE) con purga a 7 días; pagos con máquina de estados PENDING→APPROVED|REJECTED (409 terminales, 400 whitelist, 404 desconocida), `payment_audit`, `PAYMENTS_MODE` (simulador etiquetado, jamás como cobro real); rate limiting 429+Retry-After; body 1 MB con 413 y drenaje; errores 5xx genéricos; teléfonos enmascarados en logs.
- Los 7 rechazos del contrato §4 en `tests/contract-v11.test.ts` (R1–R7, incluida concurrencia real con UNA sola operación). Suite: 102/102 × 2 ejecuciones; tsc 0.

### WHATSPOWER-ULTRA (Capa 2B) — rama repair @ ba805f0
- HMAC v2 per-org `WEBHOOK_LEAD_SECRETS` (el secreto vincula la org; legado solo org default; producción EXIGE per-org en el guard fail-fast) + anti-replay persistente + idempotencia de eventos `orgId::eventId` (SQLite, 7 días).
- Bind de organización en la ingesta: un webhook de la org A JAMÁS añade leads a la campaña de la org B (validación de ownership → 404 sin oráculo) — probado R6b.
- Motor de despacho: claim ATÓMICO `UPDATE … WHERE id=? AND status='PENDING'` (changes=0 ⇒ otro worker), transiciones posteriores con guard `WHERE status='DISPATCHING'`, /step solo RUNNING (DRAFT promociona; pausas/terminales no), reconciliación FAILED_RETRYABLE ≤3 intentos → FAILED permanente, UNCERTAIN_DISPATCH jamás re-enfocado automáticamente, recoverFromCrash al arrancar, nextPacingDelayMs (jitter 15–35 s) y cooldown de lote con vencimiento y reset automático.
- Máquina de estados de campañas: pause/resume/cancel con transiciones legales y terminales intocables (409); audit_log para identidades de servicio (actor truncado, jamás la clave); rate limits 120/min admin y 30/min webhook por IP con 429+Retry-After; body 1 MB en los 4 endpoints sin tope; TRUST_PROXY para x-forwarded-for; destinos de enlaces solo http(s):// absoluto; credenciales 2B→2A (Bearer) en checkers de locks/supresión; gate DOBLE ALLOW_REAL_DISPATCH (flag + env) y bloqueo por config incompleta en TODOS los adaptadores — la salvaguarda queda INTACTA y reforzada.
- Los 7 rechazos + R6b + ST-01..05 en `tests/contract-v11.test.ts`. Suite: 73/73 × 3 ejecuciones; tsc 0. (pilot-safeguards/bajas-circuit siguen en test:e2e exigiendo servicios vivos — fail-closed preservado.)

### Estado de ramas tras el push (verificado con ls-remote)
- CRM-ALBRA: main ac01106 intacta; stable-production ea87cc2 intacta; repair/integral-20261106 → 0ebb48f (NUEVA en origin).
- WHATSPOWER: main 85d7fcf intacta; repair/integral-20261106 → a82880b (NUEVA en origin).
- WHATSPOWER-ULTRA: main 8d00230 intacta; repair/integral-20261106 → ba805f0 (NUEVA en origin).
- Push normal (fast-forward), sin force, sin mezclas entre repos, sin despliegue, sin envíos reales (ALLOW_REAL_DISPATCH=false en todos lados).

## Estado según fix/b1-dashboard-org-isolation (rama correctiva, absorbida por la fusión)
## Cierre de bloqueos B1–B4 — 2026-11-06

**Alcance:** cambios correctivos publicados en ramas independientes de CRM-ALBRA, WHATSPOWER y WHATSPOWER-ULTRA. Esta anotación documenta el estado de las ramas correctivas; no afirma que estén desplegadas ni integradas en `main`.

### Ramas y evidencia remota

| Repositorio | Rama | Commit publicado | GitHub Actions |
|---|---|---|---|
| ALBRA8/CRM-ALBRA | `fix/b1-dashboard-org-isolation` | `f9e36f2f7dbe02f22809615910be1f5c8f3af7cf` | [Run 42314688847 — success](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/42314688847) |
| ALBRA8/WHATSPOWER | `fix/b2-uncertain-b3-org-identity` | `618bcba95db95304ee2abf84f0458a76597393a0` | [Run 42314696590 — success](https://github.com/ALBRA8/WHATSPOWER/actions/runs/42314696590) |
| ALBRA8/WHATSPOWER-ULTRA | `fix/b3-org-identity-b4-null-org` | `d6d0cc2dd28ad3c3dd86e7c73596a139add3264d` | [Run 42314700665 — success](https://github.com/ALBRA8/WHATSPOWER-ULTRA/actions/runs/42314700665) |

Los heads de las tres ramas y los resultados de Actions se consultaron directamente en GitHub el 2026-11-06. Los enlaces corresponden a los SHA indicados.

### Bloqueos tratados

- **B1 — CRM:** el endpoint `src/app/api/dashboard/route.ts` invoca el saneamiento `stripForeignClients` antes de responder. Se reportó una prueba de regresión que reproduce una referencia histórica cruzada y comprueba que la PII del cliente ajeno no aparece. Resultado de suite/build comunicado por la ejecución: 504/504, TypeScript OK, lint ratchet OK y build OK.
- **B2 — WHATSPOWER:** los resultados ambiguos de transporte (errores de red, timeout y 5xx) se encaminan a `UNCERTAIN` y requieren reconciliación; no deben habilitar reintentos ciegos. La idempotency key se transmite, pero no se certifica que el daemon externo la aplique. El modelo de entrega se mantiene como at-least-once; no se promete exactly-once. Suite comunicada: 137/137 y TypeScript OK.
- **B3 — identidad entre servicios:** se añadieron credenciales vinculadas a organización y validación fail-closed en los caminos internos indicados; ULTRA envía identidad de organización y WHATSPOWER la valida. Se reportaron pruebas negativas de acceso cruzado. Suite comunicada para ULTRA: 76/76 en la fase de identidad.
- **B4 — ULTRA:** el claim y el despacho comprueban que el ítem tenga organización verificable y coincidente con la campaña; filas sin identidad verificable se ponen en cuarentena. Suite comunicada tras integrar los tests B4: 85/85.

### Nivel de verificación y límites

- **Verificado directamente en esta sesión:** existencia de las tres ramas, SHA completos de sus heads, contenido remoto de los puntos de entrada principales y estado `success` de los tres runs de GitHub Actions asociados a esos SHA.
- **Reportado por la ejecución correctiva, no repetido independientemente en esta sesión:** conteos detallados de suites, build local y pruebas específicas rojas/verdes.
- **Integración entre servicios:** se comunicó un resultado 15/15. Antes de tratarlo como certificación independiente, revisar el artefacto reproducible y distinguir cada escenario ejecutado contra servicios reales de los escenarios con mocks.
- **Riesgo externo abierto:** la aplicación efectiva de idempotencia en el daemon Baileys no quedó certificada por la evidencia consultada aquí. Mantener la protección UNCERTAIN/reconciliación y el modelo at-least-once.
- **Estado de entrega:** cambios publicados en ramas correctivas; sin PR, merge ni despliegue. No se modificaron `main` ni `stable-production` como parte de esta anotación.

### Siguiente paso

Realizar una revisión final independiente de los diffs exactos y de los artefactos de prueba, priorizando la idempotencia efectiva del daemon y la clasificación real/mock de la integración. Si esa revisión no encuentra bloqueos, preparar los tres PR para revisión humana; abrirlos solo con autorización expresa. No desplegar ni activar envíos reales como parte de esa preparación.


## Revisión independiente final — resultado bloqueante B2 (2026-11-06)

Revisión de lectura sobre los heads publicados de las tres ramas correctivas. No se modificó código.

### Estado por bloqueo

- **B1 CRM — APROBADO A NIVEL DE CÓDIGO/CI:** `dashboard/route.ts` invoca `stripForeignClients` sobre oportunidades, reservas y eventos de timeline antes de serializar. `tests/unit/dashboard-org-isolation.test.ts` usa el handler real, JWT firmado y BD de prueba, y comprueba que no aparezcan nombre, email ni ID del cliente de la otra organización. El run [42314688847](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/42314688847) terminó success en el commit de código `f9e36f2f7dbe02f22809615910be1f5c8f3af7cf`. La rama tiene después un commit documental `8f93c2177e614584be626f991d4a9a0b09e2354c`; el run citado no se ejecutó sobre ese commit posterior (solo cambia CONTEXTO CRM).
- **B2 WHATSPOWER — BLOQUEADO:** el transporte clasifica 5xx, timeout, red y respuesta ilegible como `UNCERTAIN`; el reingreso se bloquea mientras la clave esté UNCERTAIN. Sin embargo, `src/whatsapp-daemon/daemon.mjs` recibe el POST `/send` y solo lee `to` y `text`: no lee ni persiste `idempotencyKey` ni `X-Correlation-Id`, y no aplica deduplicación. Además, `journaledEffect()` deja el efecto `PENDING` antes de llamar al transporte; si el proceso cae tras la aceptación externa, `reserveIdempotency()` permite tomar de nuevo un `PROCESSING` con lease vencido y `journaledEffect()` vuelve a ejecutar `fn()` cuando encuentra un efecto PENDING. La reconciliación también re-ejecuta el efecto pendiente. Esto mantiene abierta una ventana real de duplicación.
- **Prueba B2 insuficiente:** `tests/transport-ambiguity.test.ts` comprueba clasificación y bloqueo de reingreso tras un 502, pero su transporte simulado no registra una aceptación externa en el primer intento. T-B2-04 simula 502 y después un envío exitoso; no reproduce “proveedor aceptó y se perdió la respuesta”. Por tanto, no demuestra idempotencia externa ni exactamente una vez.
- **B3 identidad de servicio — PARCIALMENTE VERIFICADO:** WHATSPOWER valida `X-Org-Id` + Bearer contra credenciales vinculadas a la organización en los endpoints internos de locks/supresión. Las pruebas W-B3 arrancan el servidor 2A real en localhost y verifican accesos cruzados. ULTRA resuelve credenciales por organización y envía `X-Org-Id`; sus pruebas de cliente usan un servidor stub. No encontré evidencia reproducible de una ejecución integrada de ambos procesos reales en esta rama.
- **B4 ULTRA — APROBADO A NIVEL DE CÓDIGO/CI:** `claimNextItem()` exige organización no nula e igual a la campaña; el worker vuelve a comprobarla contra BD antes del despacho y cuarentena NULL/organización ajena. `tests/null-org-quarantine.test.ts` cubre backfill, NULL, org ajena y corrupción después del claim. El run [42314700665](https://github.com/ALBRA8/WHATSPOWER-ULTRA/actions/runs/42314700665) terminó success en `d6d0cc2dd28ad3c3dd86e7c73596a139add3264d`.

### Integración y CI

- El archivo `tests/contracts-integration.test.ts` de ULTRA levanta un servidor daemon mock y un servidor 2A mock. Es una prueba contractual con stubs, no integración real de los tres servicios.
- Los runs verificados por SHA concluyen success: CRM [42314688847](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/42314688847), WHATSPOWER [42314696590](https://github.com/ALBRA8/WHATSPOWER/actions/runs/42314696590), ULTRA [42314700665](https://github.com/ALBRA8/WHATSPOWER-ULTRA/actions/runs/42314700665).
- No se encontró en las ramas correctivas de WHATSPOWER/ULTRA el artefacto `docs/EVIDENCIA-CUARTA-FASE.md` ni `docs/integracion/results-cuarta-fase.json` que se había mencionado previamente. No se certifica el resultado “15/15 integración real”.
- Esta revisión fue estática sobre código, tests y metadatos de GitHub. No ejecuté los tests localmente ni accedí a un daemon Baileys desplegado.

### Siguiente acción requerida

No preparar ni abrir los PR todavía. Cerrar B2 primero: el daemon debe recibir y persistir una clave de idempotencia scoped por organización antes del envío; solicitudes repetidas de una clave ya PENDING/IN_FLIGHT/UNCERTAIN deben devolver estado incierto sin reenviar. Si Baileys no ofrece una clave externa consultable/deduplicable, la caída tras aceptación debe permanecer UNCERTAIN y requerir reconciliación con evidencia, nunca reenvío automático. Añadir una prueba de crash-window que simule aceptación real del stub antes de perder la respuesta y demuestre que el segundo intento no produce un segundo envío. Después ejecutar una prueba integrada con 2A, ULTRA y daemon en procesos separados y etiquetar los mocks restantes.
