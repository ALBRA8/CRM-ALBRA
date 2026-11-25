# Historial

## Alta de CONTEXTO CRM
- Fecha: 2026-10-31.
- Repositorio: ALBRA8/CRM-ALBRA.
- Rama predeterminada confirmada: main.
- Cambio: documentación del estado, arquitectura, decisiones, plan, auditorías y pendientes.
- No se modificó intencionalmente código de aplicación.

## Referencias históricas previas (no revalidadas aquí)
- ea87cc279aa04ca2fd0bfac56b1b06b307087830: corrección de routing del remitente Baileys para JIDs modernos, según revisión anterior.
- 9b32591aa73fc3c07c450509e1159de1a12354ab: puente WHATSPOWER con HMAC-SHA256/anti-replay y notificaciones de cambio de etapa, según revisión anterior.

Se mencionaron previamente ramas saas-development y stable-production; confirmar su existencia/estado antes de usarlas. Esta tarea no creó ramas. Registrar nuevos hitos con fecha, rama, commit, impacto y pruebas.

## Actualización de contexto — 2026-11-05
- Se recibió informe de implementación P0.1 para aislamiento multi-organización de WhatsApp Baileys.
- Commit y ramas reportados: c2f4001 en main y fix/saas-security-and-stabilization.
- stable-production reportada intacta en ea87cc2.
- Pruebas reportadas: 17 unitarias nuevas, suite 422/422, TypeScript 0 errores y smoke 13/13 con prueba de denegación entre organizaciones.
- Documentación de implementación reportada: docs/P0.1-aislamiento-whatsapp-multiorg.md.
- Estos datos se registran como reportados, pendientes de verificación independiente del código, remoto y despliegue.

## Registro de compatibilidad Windows — 2026-11-05
- Se informó de un commit local 658740b con correcciones de aislamiento de variables .env, encoding UTF-8 y mock de os.symlink.
- Se informó de 434/434 pruebas en tres escenarios.
- El push fue reportado como bloqueado por falta de credenciales en el sandbox.
- No se ha confirmado a cuál de los tres repositorios activos pertenece el commit; no atribuirlo a CRM-ALBRA ni integrarlo hasta verificar repositorio y rama.
- El trabajo simultáneo en CRM-ALBRA, WHATSPOWER y WHATSPOWER-ULTRA debe mantenerse separado, sin copiar patches ni alterar ramas entre proyectos.

## Cierre de seguridad CP-Sec-01 — 2026-11-06
- Rama: main (base 2cbae0c; remoto verificado con ls-remote antes y después del push). stable-production intacta en ea87cc2.
- **Eliminados del árbol** los 5 artefactos E2E con credenciales (e2e-token.txt, e2e-wp-token.txt, e2e-wp-apikey.json, e2e-apikey.txt, e2e-wp-key.txt) + reglas .gitignore preventivas. Valores históricos verificados MUERTOS (tabla ApiKey vacía; JWTs no firman con secretos vivos; daemon 401 al valor antiguo). Ver AUDITORIAS.md A-005.
- **Secreto de daemon antiguo purgado** de 5 scripts (e2e-wp-guard.ts, e2e-wp-ultra.mjs, e2e-wp-ultra-engine.ts, bootstrap-e2e-postpub.sh, bateria-rotacion.sh) → fail-fast por entorno.
- **Escáner de secretos nuevo** `scripts/scan-secrets.mjs` con 11 pruebas (`npm run security:scan` / `security:scan:history`); árbol LIMPIO al cierre.
- **Eliminado** `scripts/start-whatspower-detached.mjs` (código operativo de otro repositorio con ruta absoluta). Imports absolutos `/home/z/repos/...` corregidos a rutas relativas en scripts E2E.
- **P0.1–P0.4 verificados directamente** (commits en main; suites de aislamiento en verde). Suite completa 464/464 en 51 archivos (74s); tsc 0 errores; build OK; lint con baseline preexistente de 358 errores (0 en archivos de esta sesión).
- Servicios :3000 y :3002 operativos durante toda la sesión, sin interrupciones.

## 2026-11-06 — FUSIÓN de ramas de reparación (repair/integral + fix/b1)
Ambas líneas de trabajo se conservan en el historial:

### Línea repair/integral-20261106
## Reparación General Integral — 2026-11-06 (rama repair/integral-20261106, B1→B9)

- **B1**: JWT restringido fuera de URLs — `?token=` SOLO en endpoints de descarga con opt-in (`DOWNLOAD_AUTH_OPTS`), download-tokens de 5 min (purpose='download') y `Referrer-Policy: no-referrer`. Antes el JWT de 7 días se aceptaba por query en TODAS las rutas.
- **B2**: rate limiting transversal (login 10/min IP + 5/15min email, forgot 3/15min, reset 10/15min, register 5/h, demo 5/h, MCP 60/min, crm-actions 120/min, email/send 20/h + permiso admin; notifications/all con permiso de exportación).
- **B3**: tokens de reset hasheados con sha256 (un solo uso, 1 h) + revocación al resetear (tokenVersion).
- **B4**: revocación de sesiones — `User.tokenVersion`; logout, reset de contraseña y desactivación invalidan el JWT ya emitido. Caché en proceso con prewarm (instrumentation) y refresh con debounce. Tests REV-01/REV-02.
- **B5**: restauración de backup ATÓMICA (`db.$transaction`), tope 25 MB → 413, reporte `transactional:true` + restored/skipped por entidad; jamás introduce registros en otra organización. Tests BKP-01..03.
- **B6**: errores 500 genéricos (jamás `err.message` al cliente; HttpError 5xx también).
- **B7**: escáner de secretos reforzado (DUMMY_HINTS exactos, huellas sha256-12, allowlist `scripts/security/secret-allowlist.json` y baseline histórico `secret-baseline.json` VERIFICABLES, historial COMPLETO sin tope de 400 ni solo-líneas-añadidas; CI bloqueante solo para hallazgos NUEVOS) + lint con baseline de reducción progresiva (`npm run lint:baseline`, bloquea errores nuevos) + auditoría de dependencias en CI.
- **B8**: observabilidad de seguridad transversal (`auth.login_failed`, `rbac.denied` vía security-log).
- **B9**: puente CRM→WHATSPOWER actualizado al contrato HMAC v2 (`timestamp.body` — mismo timestamp firmado y enviado) coordinado con 2A y 2B; `docs/INTEGRATION_CONTRACT.md` v1.1.0.
- **Verificación**: suite local 501/506 (los 5 fallos restantes son del trabajo CONCURRENTE de terceros en archivos sin seguimiento — chat/agent WIP; en checkout limpio `harness-independence` pasa 4/4, verificado con worktree temporal). tsc limpio en el árbol versionado. `security:scan` y `security:scan:history` exit 0 (33 dummies en allowlist explícita; 78 hallazgos históricos en baseline con estado ROTACION-PENDIENTE).
- **NOTA de concurrencia**: durante la ejecución, un agente de terceros operaba el mismo repositorio (WIP sin seguimiento de chat/agent y checkouts de rama). La reparación se preservó íntegra en `repair/integral-20261106` sin tocar su trabajo.

### Línea fix/b1-dashboard-org-isolation (absorbida)
## Bloqueos B1–B4 publicados — 2026-11-06

- CRM-ALBRA: rama `fix/b1-dashboard-org-isolation`, commit `f9e36f2f7dbe02f22809615910be1f5c8f3af7cf`; saneamiento de clientes ajenos invocado en dashboard. CI [42314688847](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/42314688847): success.
- WHATSPOWER: rama `fix/b2-uncertain-b3-org-identity`, commit `618bcba95db95304ee2abf84f0458a76597393a0`; transporte ambiguo a UNCERTAIN y credencial interna vinculada a organización. CI [42314696590](https://github.com/ALBRA8/WHATSPOWER/actions/runs/42314696590): success.
- WHATSPOWER-ULTRA: rama `fix/b3-org-identity-b4-null-org`, commit `d6d0cc2dd28ad3c3dd86e7c73596a139add3264d`; identidad por organización y cuarentena/rechazo de ítems sin organización verificable. CI [42314700665](https://github.com/ALBRA8/WHATSPOWER-ULTRA/actions/runs/42314700665): success.
- Los tres heads y runs se verificaron directamente en GitHub. Los conteos de tests/build e integración 15/15 son resultados comunicados por la ejecución correctiva y quedan etiquetados como tales hasta revisión independiente de sus artefactos.
- Riesgo pendiente de confirmación: idempotencia realmente aplicada por el daemon Baileys; no se afirma exactly-once. Sin PR, merge ni despliegue; main y stable-production no se tocaron.
- Próximo hito: revisión independiente final de diffs y evidencias; después preparar tres PR para revisión humana, sin abrirlos hasta autorización expresa.


## Revisión independiente final — B2 sigue bloqueado (2026-11-06)

- CRM B1 y ULTRA B4 revisados en código y pruebas; CI success en sus SHA de código.
- WHATSPOWER B2 no queda cerrado: el daemon Baileys no consume ni persiste la clave de idempotencia que le transmite el transporte. El journal puede re-ejecutar un efecto PENDING tras expirar el lease; la reconciliación vuelve a ejecutar el pendiente. La prueba actual no simula aceptación externa seguida de pérdida de respuesta.
- B3 tiene validación por organización en el servidor 2A y credenciales por org en ULTRA, pero no se acreditó una prueba entre procesos reales en esta rama.
- `contracts-integration.test.ts` usa stubs para daemon y 2A; no es integración real de los tres servicios. No se certifica 15/15 real.
- Próximo paso: corregir B2 en daemon + journal con deduplicación durable scoped por org y comportamiento no-reenvío para PENDING/UNCERTAIN; agregar crash-window test y luego ejecutar integración real multi-proceso. No abrir PR hasta cerrar el bloqueo.

## 2026-11-13 — Selector multiempresa y auditoría de sesión superadmin (PR #3)

- Repositorio: `ALBRA8/CRM-ALBRA`.
- Rama de trabajo: `fix/migration-safety-audit`; destino previsto: `main`.
- Pull Request: [#3 — feat(super-admin): conectar selector de organizaciones](https://github.com/ALBRA8/CRM-ALBRA/pull/3). Estado registrado: abierta/en draft; no integrada.
- Autenticación (`src/lib/auth.ts`): se reforzó la validación de la sesión contra la base de datos, usuario activo, `tokenVersion`, rol vigente y organización activa. El contexto entre organizaciones queda reservado al superadmin.
- Endpoint (`src/app/api/super/switch-organization/route.ts`): se incorporó el cambio protegido de organización para superadmin y emisión de un token de sesión actualizado.
- Cliente API (`src/lib/api.ts`): se añadió `switchSuperOrganization(organizationId)`.
- Interfaz (`src/components/super/super-page.tsx`): se conectó la acción **Ingresar** en la tabla de organizaciones; sincroniza el token con el cliente API y el store, vuelve a consultar `/me`, actualiza el usuario y navega al dashboard. Se bloquea el cambio simultáneo y no se permite ingresar a organizaciones inactivas.
- Pruebas (`tests/integration/superadmin-organization-switch.test.ts`): se añadieron escenarios para cambio de organización, denegación a usuario normal y organización inexistente (404).
- La PR #3 incluye además cambios previos de esta rama: workflow CI, Docker/entrypoint, guardas de BD, documentación de migraciones e índices de auditoría, y pruebas de `db-guard`. El conjunto reportado en la PR fue de 15 archivos.
- Verificación de CI consultada para el SHA `27870abcc9b6c27e843ff17a48dde18068c0c0d6`: no se encontraron statuses ni ejecuciones de workflow asociadas en esa consulta. No equivale a una ejecución satisfactoria.
- **Estado de validación:** build y pruebas de esta versión aún no verificados de forma reproducible en esta sesión. No declarar funcionalidad al 100 %.
- **Estado de entrega:** cambios publicados en la rama y contenidos en la PR; no integrados en `main`, no desplegados en producción. No se modificó producción.
- Siguiente paso: verificar el head actual de la PR, ejecutar CI/build/pruebas, corregir fallos y revisar aislamiento positivo/negativo antes de integrar. No hacer merge ni despliegue sin validación y autorización.


## 2026-11-13 — Corrección de los nueve fallos de CI

- Inspeccionado el run fallido `43378623273`: 9 fallos en pruebas multi-tenant, conexiones WhatsApp/Embedded Signup y reporte PDF.
- Causa común de 8 fallos: JWT de pruebas con rol `owner` que no coincidía con el rol `member` persistido para user B. Se mantuvo la comprobación de rol en servidor y se corrigieron los fixtures de `tests/integration/multitenant-p0.test.ts`, `tests/integration/wa-connections.test.ts` y `tests/integration/reports-pdf.test.ts` para cambiar el rol en BD durante el escenario y restaurarlo al terminar.
- El noveno fallo del PDF era secundario al 401: el test intentaba extraer cifras de un PDF no generado por la autenticación rechazada.
- Commit final de la corrección/validación: `040d8875ff9b10b5179313bbc374a5e7795af8ed`.
- CI run `43379605573`: **success**, 64 archivos / 580 pruebas aprobadas; TypeScript, lint, migraciones, escáner y build aprobados.
- Pruebas automatizadas del selector Super Admin pasaron dentro de la suite.
- No se hizo merge ni despliegue. La validación visual del selector en navegador/staging y la comprobación integral de aislamiento en un entorno desplegado siguen pendientes.


## 2026-11-13 — Cierre de validación automatizada del selector

- Hallazgo adicional en revisión de UI: `/api/auth/me` filtraba siempre por la organización base del usuario, por lo que el superadmin podía cambiar token pero no completar la recarga de sesión en otra organización.
- Corrección: `src/app/api/auth/me/route.ts` permite que el superadmin consulte su usuario por ID y proyecta el contexto activo del token en `user.organizationId`; no cambia la organización base en BD. Los usuarios normales siguen filtrados por su organización asignada.
- Prueba añadida: tras cambiar a org B, `/api/auth/me` devuelve org B; se conserva org A como organización base persistida.
- Head final `5c1e73e0c99c488c843d42aff6fe8cef6928bf23`; CI run `43380198626` **success**, 64 archivos y 580 pruebas aprobadas, build incluido.
- No merge, no despliegue. Pendiente verificación visual/manual en staging y prueba de regreso al panel Super Admin.

## 2026-11-15 — Memoria técnica y operativa del Webinar oficial de WhatsON
- Transcripción y análisis íntegro del webinar de Roberto Valverde (`rcvalverde.com`) documentados en `CONTEXTO CRM/INGENIERIA_INVERSA_WHATSON_WEBINAR.md`.
- Documentadas reglas antispam de WhatsApp: umbral de 5 bloqueos en <20 min, bloqueo de enlaces en frío, warm-up de chips, y la estrategia "Saludos múltiples y respuesta única".
- Parámetros técnicos del motor de WhatsON mapeados: Spintax combinatorio 5×5×5×5 (625 variantes), rotación multi-cuenta con emuladores, pacing con jitter, control de lotes y automatización de listas de difusión.
- Tabla comparativa de paridad y modernización hacia el ecosistema SaaS multi-tenant ALBRA (Capa 1 CRM, Capa 2A WhatsPower, Capa 2B WhatsPower-Ultra).

## 2026-11-16 — Cierre de Paridad 100% WhatsON & WATI, Retiro de Páginas de Venta y Dashboard Único en WhatsPower-Ultra (Capa 2B)
- **Repositorio:** `ALBRA8/WHATSPOWER-ULTRA`.
- **Ramas actualizadas:** `repair/produccion-real` y `main` sincronizadas en commit `6a68b86` y posterior `c7bf070`.
- **Cierre de Paridad WhatsON & WATI:** Alcanzada paridad técnica al 100% y superioridad arquitectónica SaaS frente al software de escritorio WhatsON monousuario. Implementado escudo anti-ban de 5 capas (throttler, enfriamiento por lotes `PAUSED_COOLDOWN`, fatiga, spintax recursivo determinista y chequeos JIT contra Capa 2A).
- **Retiro de Páginas de Venta:** Eliminadas las carpetas `web/site/` y `web/sitio/` del árbol de código (archivadas en backup seguro fuera del repo).
- **Dashboard Único y Modo Demo:** La raíz `/` y `/campaigns` sirven exclusivamente el Dashboard SPA interactivo. Incorporado botón *"Entrar sin registro (demo)"* (`POST /studio/login-demo` protegido por `DEMO_MODE=true` en `.env`), toggle de tema claro/oscuro (☀️/🌙) y favicon SVG. Rutas legadas (`/app`, `/panel`, `/sitio`, `/inicio`) redirigen con HTTP 302 hacia `/`.
- **4 Detalles de Remate Implementados:**
  1. Paginación de hilo de chat con botón *"Cargar mensajes anteriores"* (`limit` y `before`).
  2. Tooltip con motivo real de fallo de entrega en el icono de error `✗`.
  3. Salto directo de página ("Ir a página N") en la tabla de Contactos.
  4. Buscador instantáneo con debounce en el tablero Kanban (`pkSearch`).
- **Verificación de Calidad (4 Puertas en Verde):**
  - Pruebas unitarias y de integración: 239/239 pasadas (50 suites, 0 fallos).
  - TypeScript: 0 errores (`tsc --noEmit`).
  - Seguridad: Escáner de secretos limpio (0 secretos expuestos).
  - Build: Generación de bundle de producción con salida limpia.
- **Documentación:** Creado `CONTEXTO CRM/PARIDAD_WHATSON_WHATSPOWER_ULTRA.md`.

## 2026-11-17 — Reparación técnica y auditoría de producción (FASE 1–5) en los tres repositorios

Ejecución del encargo de reparación técnica en las tres capas del ecosistema, sobre la rama `repair/produccion-real` de cada repositorio: `main` intacto, sin force-push, sin reescritura de historial, cero datos reales (solo `+573000000000`, `user@example.com`, `org_test`) y Baileys se mantiene como canal principal de WhatsApp (NO se migró a Meta Cloud API; los adaptadores existentes no se tocaron). Método: TDD (cada reparación precedida de una prueba que falla antes y pasa después) + verificación real (suites completas, escáner de secretos y simulación E2E de los 3 servicios con `ALLOW_REAL_DISPATCH=false`). Auditoría consolidada en [AUDITORIAS.md](AUDITORIAS.md) A-007; tareas del dueño en [PENDIENTES.md](PENDIENTES.md). Detalle completo por repositorio en sus `AUDIT_REPORT.md`, `CHANGELOG.md` y `OWNER_TODO.md`.

### CRM-ALBRA (6 commits, `4284687` → `d7ad0bb`)
- `4284687` fix(daemon): bind por defecto en `127.0.0.1` (configurable por `HOST`), secreto comparado con `crypto.timingSafeEqual` (SHA-256 de longitud fija) y validación EXACTA de origen con `new URL().origin` (se elimina `.startsWith()`, que admitía bypass tipo `crm.albra.co.attacker.com`; orígenes malformados rechazados). Prueba: `tests/integration/daemon-security.test.ts` (6, incluye bind no-loopback contra la IP real).
- `057511b` fix(security): aislamiento multi-tenant en rutas que no tenían suite dedicada (OAuth social Instagram/Facebook/Telegram/TikTok, Google OAuth, `/api/team/:id`, `/api/knowledge/:id`, `/api/custom-fields/:id`, `/api/internal/*` — anónimo/sin permiso/cross-tenant → 401/403/404 con efecto cero) y condición `WHERE id AND organization_id` explícita en mutaciones por id (api-keys, custom-fields, knowledge, saved-views, team; auditoría de las 122 rutas `[id]`). Prueba: `tests/integration/tenant-route-hardening.test.ts` (22).
- `2ae7f9f` docs(hygiene): aviso de canal no oficial Baileys en README y dummy marcado en la prueba del daemon.
- `5089356` docs(parity): matriz de paridad WhatsON sincerada — "Rotación multi-cuenta automática" dejada de declarar al 100% y registrada como NO implementada (requiere integración futura).
- `0368299` chore: limpieza de artefactos operativos y `.gitignore` global (`*.pdf`, `backups/`, `storage/temp/`).
- `d7ad0bb` docs(audit): CHANGELOG, AUDIT_REPORT, OWNER_TODO y matriz de producción de la sesión.
- Puertas verificadas: suite 764/764 (93 archivos, vitest), escáner de secretos del árbol limpio (allowlist con 50 dummies verificados) y escáner de historial sin hallazgos NUEVOS.

### WHATSPOWER (4 commits, `53cb61f` → `4b06118`)
- `53cb61f` fix(ai): IA desactivada por defecto — `isAiEnabled()`: sin credencial se realizan CERO llamadas HTTP a terceros y `AI_ENABLED=false` manda sobre la credencial presente; documentación explícita de que, al activarla, el texto de las conversaciones de clientes se transmite al proveedor externo (`.env.example` y README §2.b). Prueba: `tests/ai-disabled-by-default.test.ts` (6).
- `acd532f` docs(hygiene): aviso Baileys en la cabecera del README, documentación del motor de automatización (`automation_rules`, `automation_events`, `stage_change_dedup`, `/api/crm/stage-change`) en `FICHA.md` §7.b y sustitución de conteos de pruebas hard-coded.
- `a6cf359` docs(architecture): postura sobre `node:sqlite` y `--experimental-strip-types` con mitigaciones y plan de migración (`DOCS/DECISION_SQLITE_TYPES.md`).
- `4b06118` docs(audit): CHANGELOG, AUDIT_REPORT, OWNER_TODO y matriz de producción de la sesión.
- Puertas verificadas: suite 316/316 (`npm test`), escáner de secretos del árbol limpio.

### WHATSPOWER-ULTRA (8 commits, `4794444` → `56a0653`)
- `4794444` fix(worker): `ConsentStore` OBLIGATORIO en `BroadcastEngine` (fail-closed `CONSENT_STORE_REQUIRED`) y cableado en `worker-main.ts` (también en `LocalSuppressionStore`): el chequeo JIT de consentimiento (Ley 1581) ya no puede saltarse y un opt-out revoca el consentimiento en el store. Prueba: `tests/worker-consent.test.ts` (5).
- `ab524ce` fix(auth): `/studio/login-demo` devuelve 403 cuando `NODE_ENV=production`; `DEMO_MODE=true` en producción es problema fatal en `productionConfigProblems`; el rate limiter de login ya NO borra el contador tras cada éxito (acumula, anti fuerza bruta); IP desde `req.socket.remoteAddress` salvo `TRUST_PROXY=true`. Prueba: `tests/login-demo-hardening.test.ts` (6).
- `df13523` fix(worker): `WORKER_DISABLE_PACING` prohibido en producción (problema fatal en `productionConfigProblems` + guard en `worker-main.ts` con exit 1; legítimo solo en desarrollo). Prueba: `tests/pacing-guard.test.ts` (4, con proceso hijo real).
- `4ac7996` fix(tracking): la IP de los clics (`/t/:code`) jamás se almacena en crudo — solo `sha256(ip+salt)`; `X-Forwarded-For` condicionado a `TRUST_PROXY=true`. Prueba: `tests/tracking-ip-hash.test.ts` (6).
- `aa81718` docs(hygiene): aviso de canal no oficial Baileys en README y en la caja de aviso de Integraciones → Transporte.
- `b261f5f` build: `engines` y `.nvmrc` alineados a Node 22; decisión documentada de `node:sqlite`/strip-types (`DOCS/DECISION_SQLITE_TYPES.md`); `scripts/backup-db.ts` y `scripts/restore-db.ts` creados y probados con datos ficticios; RUNBOOK §3.1–3.2 (healthcheck/systemd y respaldo).
- `9cbd4d0` fix(suppression): normalización canónica del teléfono en la lista de bajas (una baja `+57…` ahora coincide con el contacto `573…`; el guardia JIT comparaba formatos distintos) + simulación E2E de flujo cruzado. Prueba: `tests/e2e-cross-flow.test.ts` (7: mensaje entrante → flujo → evento CRM → campaña ULTRA con `LOCK_EXCLUDED`, `SKIPPED_NO_CONSENT` y salvaguarda; `SENT=0`).
- `56a0653` docs(audit): CHANGELOG, AUDIT_REPORT, OWNER_TODO y matriz de producción de la sesión.
- Puertas verificadas: suite 269/269 (50 suites, node:test), test de seguridad 2/2, escáner de árbol limpio, TypeScript 0 errores y E2E cruzado 7/7.

### Publicación
- Las tres ramas `repair/produccion-real` se envían a `origin` al cierre de esta sesión con un PAT nuevo provisto por el dueño (push por rama; `main` intacto; verificación posterior con `ls-remote` registrada en AUDITORIAS A-007).

## 2026-11-17 (bis) — Acceso directo al ecosistema desde el "demo" (SSO de un solo uso, 3 repositorios)

A petición del dueño: el acceso demo ahora abre el ECOSISTEMA COMPLETO (CRM + WhatsPower + WhatsPower-Ultra), no solo el CRM. Implementado como SSO firmado de un solo uso entre las tres capas, sin debilitar las puertas endurecidas de la reparación:

- **CRM (capa 1, commit `9276e22`)**: botón **Ecosistema** en el sidebar (desktop y móvil) visible en cualquier sesión autenticada — incluida la demo. `GET /api/auth/ecosystem/links` emite un enlace por capa con token `v1.<payload>.<hmac>` (HMAC-SHA256 con `ECOSYSTEM_SSO_SECRET` compartido, TTL 90 s, `jti` de un solo uso). Fail-closed: sin secreto o sin `WHATSPOWER_STUDIO_URL`/`ULTRA_STUDIO_URL` el enlace se declara `available:false` y JAMÁS se emite token. Prueba: `tests/integration/ecosystem-links.test.ts` (9). Suite: **773/773** (95 archivos).
- **WHATSPOWER (capa 2A, commit `84d7232`)**: `GET /studio/login-ecosystem` canjea el enlace (verificación timing-safe, jti único, rate limit compartido con el login del studio) y concede la sesión del Studio con cookie HttpOnly (302 a `/`). Sin secreto → 404 (la ruta NO existe). Prueba: `tests/ecosystem-login.test.ts` (8). Suite: **318/318**.
- **WHATSPOWER-ULTRA (capa 2B, commit `9c00ad2`)**: misma ruta de canje hacia el dashboard `/`. SSO CONSCIENTE del dueño: funciona en producción SOLO con el secreto configurado; el login-demo ANÓNIMO conserva su bloqueo total en producción (regla H-2 intacta). Prueba: `tests/ecosystem-login.test.ts` (9). Suite: **278/278**.
- **Contrato compartido**: módulo `ecosystem-sso.ts` idéntico en los tres repos (formato, TTL, jti); documentado en los tres README y `.env.example`. `ALLOW_REAL_DISPATCH=false`, Baileys como canal principal y todas las reglas del encargo siguen intactas.
- **Verificación pre-subida (commit CRM `bb2bd1c`)**: reejecución de las tres suites completas antes de subir. WP 318/318 y ULTRA 278/278 verdes a la primera; CRM detectó que la allowlist de higiene de `.env.example` (test P0.4-H3) no reconocía los dos puertos locales nuevos del SSO (`127.0.0.1:3003`/`3004`) — corrección en la allowlist del test (las URLs loopback son legítimamente no-secretas según el propio contrato del test). Suite final CRM: **773/773**. Los tres repos verificados con `git ls-remote`: SHA remoto = SHA local en `repair/produccion-real`.

## 2026-11-17 (ter) — Blindaje y resolución de handshake de WhatsApp Baileys (Código 428) y sincronización

- **Causa raíz del fallo de vinculación (código 428)**: Baileys utilizaba un descriptor de navegador no estándar `['CRM ALBRA', 'Chrome', '1.0.0']` y `fetchLatestBaileysVersion()` obsoleto. Los servidores multi-device de WhatsApp cerraban el socket WebSocket con error 428 (`connectionClosed` / `Connection Terminated`) durante el registro.
- **Solución implementada (`daemon.mjs`, commits `6f2ca35` y `78151c8`)**:
  - Se configuró `Browsers.ubuntu('Chrome')` (firma oficial de navegador web soportada por WhatsApp).
  - Se reemplazó por `fetchLatestWaWebVersion()` dinámico con timeout de 3.5s y fallback seguro.
  - Limpieza preventiva de sesiones huérfanas en `.wa-auth/<orgId>`: si `creds.json` existe pero carece de `me.id` (sesión no emparejada o abandonada), se purgan los archivos residuales antes de `useMultiFileAuthState(dir)` para garantizar un estado criptográfico limpio.
  - Límite de reintentos: el daemon limita a 3 reintentos el ciclo de reconexión si no hay credenciales vinculadas, pasando a estado `qr_expired` para no saturar los servidores de WhatsApp.
  - TTL y frescura del QR: se añadieron `ttlSeconds: 25`, `qrGeneratedAt` y `qrExpiresAt` en `GET /qr` y soporte de `POST /connect { force: true }` para regeneración manual inmediata.
- **Frontend endurecido (`settings-page.tsx`)**:
  - Cuenta regresiva visible `Activo (Xs)` de 25 segundos para el código QR.
  - Desenfoque visual y overlay interactivo al expirar (`qrSecondsLeft <= 0`) con botón `"Generar nuevo QR"` que dispara `handleWaConnect(true)` de forma forzada.
  - El botón "Refrescar QR" ahora invoca la reconexión forzada en lugar de solo consultar la imagen caducada en memoria.
  - Prevención de parpadeo de imagen durante la expiración.
- **Sincronización remota y merge limpio (commit `ac2f3ee`)**:
  - Se hizo pull de `origin/repair/produccion-real` en los 3 repositorios (WHATSPOWER y ULTRA avanzaron fast-forward; CRM-ALBRA integró los endpoints de SSO de ecosistema sin conflictos con commit de merge `ac2f3ee`).
  - Suite de pruebas completa verificada.

## 2026-11-17 (cuarta) — corrección del ecosistema demo: pantalla de acceso, demo de 2A, arranque y aceptación completa

Diagnóstico del dueño (Windows, 03:40-03:55 America/Bogota): solo el 3000 escuchaba; el canje SSO no llegaba a probarse; los studios pedían el secreto con `window.prompt` bloqueante y borraban el body al cancelar; 2A pedía además la organización con un segundo prompt; `INICIAR_ECOSISTEMA.bat` no esperaba salud ni avisaba fallos; la cookie del CRM con Secure no se guarda por IP de LAN.

- **Causa raíz del arranque**: las capas 2A/2B simplemente no estaban arriba (el código arranca limpio en primer plano — verificado en Linux con stderr capturado). El "Acceso denegado" de PowerShell al crear `.log` dentro de WHATSPOWER/WHATSPOWER-ULTRA es ACL de Windows heredada de esas subcarpetas, no un fallo del servidor. Los `.bat` nuevos ya no escriben archivos de log (cada capa muestra sus logs en su propia ventana).
- **2A y 2B (commits en sus repos)**: pantalla de acceso real (secreto clásico + botón demo condicionado + "Volver al CRM" desde `CRM_BASE_URL`); sin `window.prompt` ni body vacío; la organización solo se pide en el login clásico (SSO/demo → `default` sin preguntar); los fallos del canje SSO (403/404/429) ahora responden página HTML (`src/studio/ecosystem-error-html.ts` en ambos repos, contrato espejo) con el motivo — caducado / ya usado / no configurado — y enlace para reintentar desde el CRM.
- **2A — entrada demo**: nueva `POST /studio/login-demo` con la dureza exacta de 2B (403 SIEMPRE en producción; exige `DEMO_MODE=true` e `INTERNAL_API_SECRET`; mismo rate limiter que el login clásico; misma cookie HttpOnly de sesión).
- **CRM**: cookie `albra_session` con Secure condicional (`SESSION_COOKIE_SECURE=false` como escape explícito documentado para IP de LAN sin HTTPS; por defecto Secure solo en producción). Nuevos `INICIAR_ECOSISTEMA.bat` (orden daemon→CRM→2A→2B con espera de salud y reporte de fallos por capa) y `DIAGNOSTICO_ECOSISTEMA.bat` (puertos + HTTP + presencia/igualdad de `ECOSYSTEM_SSO_SECRET` en los tres `.env` sin imprimir el valor).
- **Aceptación**: pasos 1-7 del guion en verde contra los 4 servicios reales (CRM standalone producción, daemon, 2A, 2B) y paso 8 en navegador real (Chrome headless): landing → INICIAR DEMO → sidebar Ecosistema → Abrir WhatsPower (nueva pestaña con Flow Studio y el flujo ManyChat cargado, sin gate) → Abrir WhatsPower-Ultra (dashboard con métricas y onboarding, sin login). Capturas en `download/`.
- Suites finales: CRM **778/778** (96 archivos; +5 pruebas de cookie), 2A **321/321** (+3: cadena de aceptación, páginas de error SSO, login-demo dev/producción), 2B **280/280** (+2: cadena de aceptación y páginas de error SSO). Reglas intactas: login-demo anónimo 403 en producción, nada de secretos en JS/sessionStorage/URLs, comparación timing-safe, jti de un uso, `ALLOW_REAL_DISPATCH=false`, Baileys como canal principal, `.env` jamás commiteado.

## 2026-11-17 (quinta) — Auditoría de Seguridad Ecosistema SSO, blindaje de entorno y salvaguarda de prueba real

Auditoría integral del acceso "Ecosistema" (traspaso SSO entre CRM, WhatsPower y WhatsPower-Ultra) tras la vinculación interactiva exitosa de WhatsApp en el daemon:

- **1. Salvaguarda física de despacho y prueba real**:
  - `ALLOW_REAL_DISPATCH=false` verificado y confirmado en `.env` de las 3 capas (CRM-ALBRA, WHATSPOWER, WHATSPOWER-ULTRA).
  - Componentes automáticos de envío APAGADOS: `CHANNEL_AUTOREPLY_ENABLED=false` en `.env` del CRM; `/api/whatsapp/auto-reply` responde `{ paused: true }` sin invocar LLMs ni generar mensajes; workers de difusión de WhatsPower-Ultra inactivos y con fail-closed físico (`SKIPPED_NO_CONSENT`/`FAILED_FATAL`, 0 envíos reales).
  - Regla estricta: mientras haya sesión real vinculada, SOLO se admiten pruebas de RECEPCIÓN. Cero envíos automáticos. Los envíos de prueba son exclusivamente manuales y autorizados uno a uno.
  - Sanitización estricta: política de no imprimir ni persistir en el repositorio, commits, archivos de test o logs el número de teléfono vinculado ni datos personales del operador.
- **2. Auditoría del acceso "Ecosistema" (SSO)**:
  - **Mecanismo analizado**: formato `v1.<b64url(payload)>.<b64url(HMAC-SHA256)>`, firmado por el CRM con `ECOSYSTEM_SSO_SECRET`, TTL de 90 segundos, canje único vía `SingleUseJti` en memoria y emisión de cookie HttpOnly de sesión de operador (`issueStudioSession`).
  - **Vulnerabilidad hallada (H-ECO-1 / H-C8)**: `GET /studio/login-ecosystem` (en 2A y 2B) y `GET /api/auth/ecosystem/links` (en Capa 1) carecían de verificación de entorno y aislamiento multi-tenant. En producción, un token emitido hubiera otorgado sesión administrativa central sin credenciales.
  - **Corrección y blindaje aplicado**:
    - **Rechazo tajante (403 Forbidden)**: `GET /studio/login-ecosystem` (2A y 2B) y `GET /api/auth/ecosystem/links` (Capa 1) ahora rechazan con 403 incondicional si `NODE_ENV === 'production'` o si `DEMO_MODE !== 'true'`.
    - **Fallo al arrancar en producción**: `productionConfigProblems` en `WHATSPOWER/src/security.ts` y `WHATSPOWER-ULTRA/src/security.ts` marca `ECOSYSTEM_SSO_SECRET` y `DEMO_MODE=true` como problemas fatales bloqueantes del arranque.
    - **Aislamiento multi-tenant en el token**: el payload de `signEcosystemToken` ahora incluye obligatoriamente `orgId` y `role` de la sesión CRM. `verifyEcosystemToken` verifica la correspondencia y rechaza tokens ajenos con 403 "organización no autorizada", evitando cualquier escalada de privilegios cruzada.
  - **Auditoría de accesos sin credenciales**: revisadas exhaustivamente todas las rutas de WhatsPower y WhatsPower-Ultra. Fuera del modo demo (`DEMO_MODE=false`), NO existe ninguna vía pública ni anónima para obtener sesión ni acceder a la API (todas las rutas exigen Bearer administrativo o sesión HttpOnly autenticada).
- **3. Suites de pruebas actualizadas y en verde**:
  - `CRM-ALBRA`: 12/12 PASS en `tests/integration/ecosystem-links.test.ts` (verificado 403 en producción, 403 sin demo, firma con orgId y rechazo ante org ajena).
  - `WHATSPOWER`: 14/14 PASS en `tests/ecosystem-login.test.ts` (+4 pruebas: 403 en producción, 403 sin DEMO_MODE, rechazo ante org ajena, cadena de aceptación).
  - `WHATSPOWER-ULTRA`: 14/14 PASS en `tests/ecosystem-login.test.ts` (+4 pruebas espejo alineadas con el nuevo contrato).

## 2026-11-17 (sexta) — Sanitización Integral de PII en Árbol Público y Guardián Automatizado en CI

Saneamiento riguroso de datos personales y teléfonos colombianos reales en el árbol rastreado de los tres repositorios públicos:
- **1. Saneamiento de datos reales**:
  - `CRM-ALBRA`: `worklog.md` saneado (nombre de operador a `Operador Demo` y WhatsApp LID real a dummy `215779999999999`); `scripts/e2e-tiktok-2026-10-31.sh` y `scripts/mock-tiktok-server.mjs` (handles personales a `operadordemo01`).
  - `WHATSPOWER-ULTRA`: `docs/WEBHOOK-MENSAJES.md` (teléfono `57301...` a dummy `573000000001`); `tests/dashboard-parity.test.ts` (nombre real a `Operador Demo` / `Contacto Demo` y teléfono a `573000000001`); `tests/superpowers-level3.test.ts` (`30198...` a `3000000002` / `573000000002`); `FICHA.md` saneado.
- **2. Guardián automatizado de PII (`npm run check:pii`)**:
  - Implementado `scripts/check-pii.mjs` en los tres repositorios. Audita con regex y análisis de patrones cada archivo versionado por git.
  - Bloquea commits y pipelines si reaparecen números colombianos reales (`573...`), nombres reales u operadores no autorizados.
  - Integrado como paso obligatorio `Escáner de PII y teléfonos reales` en `.github/workflows/ci.yml`.
- **3. Puertas de calidad finales ejecutadas**:
  - `CRM-ALBRA`: `npx vitest run` → **781/781 PASS** (96 test files). `npm run check:pii` → 0 violaciones.
  - `WHATSPOWER`: `npm test` → **324/324 PASS** (38 suites). `npm run check:pii` → 0 violaciones.
  - `WHATSPOWER-ULTRA`: `npm test` → **283/283 PASS** (50 suites). `npm run check:pii` → 0 violaciones.

## 2026-11-18 — Auditoría y Certificación de Pruebas en Host Local (Antigravity)

Ejecución metódica del plan de pruebas sobre la rama `repair/produccion-real` sincronizada en los tres repositorios (CRM: `59b6c71`, WP: `bd8e335`, ULTRA: `b5f5a1c`):

- **1. Ejecución de Pruebas Unitarias y de Integración**:
  - `CRM-ALBRA`: **781/781 PASS** en `vitest` (96 archivos, exit code 0). Base de datos temporal creada con 17 migraciones en Prisma (`test-prisma.db`).
  - `WHATSPOWER`: **324/324 PASS** en `npm test` (38 suites, exit code 0). Exacto al valor de referencia.
  - `WHATSPOWER-ULTRA`: **283/283 PASS** en `npm test` (50 suites, exit code 0). Exacto al valor de referencia.
- **2. Verificación del Guardián de PII**:
  - `npm run check:pii` arrojó exit code 0 en los 3 repos (árboles 100% limpios de datos reales o teléfonos no autorizados).
  - Prueba negativa ejecutada: un archivo temporal con teléfono no autorizado fue interceptado de inmediato (`[TELEFONO_NO_AUTORIZADO]`), redactado en logs (`[REDACTADO]`) y generó exit code 1. Archivo eliminado inmediatamente.
- **3. Pruebas de Arranque en Modo Producción y Guards Fail-Closed**:
  - WhatsPower-Ultra y WhatsPower Studio: llamadas a `/studio/login-demo` responden `HTTP 403 Forbidden` cuando `DEMO_MODE=false`.
  - Servidor de Ultra falla al arrancar (exit 1) con `DEMO_MODE=true` en producción.
  - Worker de Ultra falla al arrancar (exit 1) con `WORKER_DISABLE_PACING=1` en producción.
  - Servidor CRM falla al arrancar (exit 1) ante secretos débiles o ausentes en producción (`src/instrumentation.ts`).
  - CRM `/api/auth/ecosystem/links`: responde 403 en producción o con DEMO_MODE apagado (12/12 PASS en `ecosystem-links.test.ts`).
- **4. Consentimiento y Circuito de Bajas (Ultra)**:
  - Ensayo con componentes reales del worker (`BroadcastEngine`, `ConsentStore`, `LocalSuppressionStore`): contacto sin consentimiento previo quedó en `SKIPPED_NO_CONSENT`; contacto con opt-out/baja quedó en `SUPPRESSED`. Total llamadas de envío: 0 (`sentCount = 0`).
- **5. Integración de Servicios y Salud**:
  - Levantados CRM (:3000), WHATSPOWER (:3003) y ULTRA (:3004) en modo desarrollo/simulación con bases temporales. Los tres endpoints `/api/health` respondieron HTTP 200 con éxito.
- **6. Inspección de Interfaz en Navegador (Subagente Browser a 390px móvil)**:
  - CRM-ALBRA: carga completa responsiva a 390x844 sin pantallas blancas ni errores fatales de React.
  - WHATSPOWER Studio: carga lienzo visual y bloquea con modal de acceso requiriendo credenciales.
  - WHATSPOWER-ULTRA Studio: carga panel completo. Al hacer clic en botón *"🚀 Entrar sin registro (demo)"* en `/login`, el backend devuelve `403 Forbidden` (`{"error":"Modo demo no habilitado. Configura DEMO_MODE=true en .env"}`), desplegando la advertencia visual.
- **7. Operación y Respaldo**:
  - Respaldo atómico de base SQLite temporal ejecutado con `VACUUM INTO`. `PRAGMA integrity_check` retornó `ok` antes y después de restaurar las 47 tablas.
  - Docker Compose: no se pudo ejecutar localmente por no estar instalado Docker en el host.
- **8. Hallazgos Documentados para el Constructor (z.ai)**:
  - Error TS2540 en `tests/integration/ecosystem-links.test.ts` (impide `tsc --noEmit` y `npm run build`).
  - Detección de secreto falso sin allowlist en `ecosystem-links.test.ts:27` en `npm run security:scan`.
  - Fallo de compilación nativa en `better-sqlite3@13.0.3` bajo Node 24 Windows (`npm ci --ignore-scripts` resuelve temporalmente).

## 2026-11-18 (Segunda Fase) — Verificación de Correcciones y Certificación Final de Puertas

Sincronizados los repositorios con origin tras las correcciones aplicadas por el constructor (`z.ai`):
- **CRM-ALBRA (`67f8a96`)**:
  - `tests/integration/ecosystem-links.test.ts`: Asignación a `process.env.NODE_ENV` sustituida por `vi.stubEnv('NODE_ENV', ...)` y `vi.unstubAllEnvs()` en `afterEach`.
  - Secreto literal de prueba reemplazado por `crypto.randomBytes(24).toString('hex')` en runtime.
  - Implementado `scripts/e2e-3-servicios.mjs` con runner dinámico multiplataforma.
  - `npx tsc --noEmit`: **0 errores** (exit code 0).
  - `npm run security:scan`: **0 secretos** (exit code 0).
  - `npm run build`: **Exitoso** (exit code 0, 124 rutas standalone compiladas).
  - `npx vitest run tests/integration/ecosystem-links.test.ts`: **12/12 PASS** (exit code 0).
- **WHATSPOWER (`fe22890`)**:
  - Soporte de base de datos SQLite configurable por variable de entorno `WHATSPOWER_DB_PATH` para aislamiento en pruebas E2E.
  - `npm test`: **324/324 PASS** en 38 suites (exit code 0).
  - `npm run check:pii`: **0 violaciones** (exit code 0).
- **WHATSPOWER-ULTRA (`71871df` / `3aecd54`)**:
  - Soporte de base de datos configurable por entorno `ULTRA_DB_PATH`.
  - `renderDashboardLoginHtml(opts.demoEnabled)`: El botón *"🚀 Entrar sin registro (demo)"* se renderiza en la UI únicamente cuando `demoEnabled=true` (`DEMO_MODE=true` fuera de producción).
  - `npm test`: **284/284 PASS** en 50 suites (exit code 0). Incluye nueva prueba unitaria `1.B.6` para renderizado condicional del botón demo.
  - `npm run check:pii`: **0 violaciones** (exit code 0).
- **Integración E2E 3 Servicios (`npm run e2e:3`)**:
  - Ejecutada la suite completa multiplataforma: levantamiento orquestado de CRM (:3000), WP (:3003) y ULTRA (:3004) con puertos libres automáticos y bases SQLite temporales.
  - Resultado: **19/20 aserciones PASS**, **SENT=0** absoluto (cero envíos a la red real).

## 2026-11-20 — Fusión de la Integración Maestra (44 Commits) en repair/produccion-real

- **Rama e Integración**: Fusión de la rama `impl/integracion-maestra-20261120` (commits `dde4207` hasta `c5e4aee`) sobre `repair/produccion-real`.
- **Resguardo**: Creación de la rama local `backup/repair-produccion-real-premerge` en commit `a72cc95`.
- **Hitos de Construcción Incorporados**:
  - `dde4207` (D1): Scheduler multiproceso con leases concurrentes y pruebas de ACK ambiguo.
  - `c2b20cc` / `8c459ac` (F2): Panel de conexiones WhatsApp multi-número en Ajustes.
  - `1fe8041` / `9e0d271` (M7/F3): Criterio de bandeja única y filtros server-side.
  - `c108b40` (M8): Conciliación de envíos UNCERTAIN en panel de administración.
  - `76564f2` (F4): Agenda comercial semanal/diaria con duraciones y huecos libres.
  - `9b65a2f` (F5): Pantalla `/health` y wizard de puesta en marcha.
  - `09f7a4f` / `aa5ab3e` (U1/U2): Navegación 5+1 y dashboard de atención de excepciones.
  - `821f867` (U3): Catálogo de errores accionables sin jerga técnica.
  - `508a00a` (U4): Ajustes divididos en 4 dominios.
  - `0543f3b` (U5): Pulido visual (tipografía mínima 13px, dark mode y empty states).
  - `8a9e08f` (U6): Semillas sectoriales para demos reproducibles.
  - `39f9a99` / `4077fd6` (F1): Tareas, recordatorios y quick-actions en ficha 360.
  - `f444aa9` (O4): Worker pull persistente para outbox y servicios systemd.
  - `b934eec`: Port de `fix/whatsapp-production-media` (validación de ASR por org, firmas binarias de imagen y media-guard).
  - `c3665ab`: Endurecimiento de referencias históricas cross-org en 9 rutas.
  - `b855b9a`: Backfill aditivo de `QuoteItem.organizationId` con migración SQL.
  - `a920ba6`: Kits de integración WP/ULTRA en `integration-kits/wp-ultra/` para las 13 tareas de dependencias externas.
- **Auditoría Futura**: Incorporado el documento rector `AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION_FASE_POSTERIOR.md` para la simplificación de modelos post-cierre.
- **Verificación**: TypeScript `tsc --noEmit` completado con 0 errores; suite en 1,104 pruebas en 128 archivos.

## 2026-11-20 — Despliegue de los 9 Kits Portables en WHATSPOWER y WHATSPOWER-ULTRA

- **Objetivo**: Aplicar los 9 paquetes portables diseñados en `CRM-ALBRA/integration-kits/wp-ultra/` a los repositorios satélite `WHATSPOWER` (Capa 2A) y `WHATSPOWER-ULTRA` (Capa 2B), adaptando su persistencia a `node:sqlite` nativo y creando sus respectivas suites de prueba nativas.
- **CRM-ALBRA (`0dbc31a`)**:
  - Kits persistentes `s4-durable-replay-cache` y `m4-durable-pacing` actualizados con soporte dual dinámico (`node:sqlite.DatabaseSync` prioritario + fallback `better-sqlite3`).
  - Suite de kits (`tests/kits/`): 9 suites, **51 passed, 0 failed**.
- **WHATSPOWER (`66f36a3`)**:
  - Kits instalados: S3 (Org Bearer Auth), S4 (Durable Replay Cache), S7 (Org Credentials Crypto), M3 (Meta Dispatch Guard), I6 (Transport Policy), F6 (Payment Gateway Adapter).
  - 6 suites de prueba nativas Node 24 creadas en `tests/`.
  - Resultado test suite: **41 archivos de prueba, 358 passed, 0 failed, 0 errors**.
- **WHATSPOWER-ULTRA (`eb5f89f`)**:
  - Kits instalados: S4 (Durable Replay Cache), S7 (Org Credentials Crypto), M2 (Bulk Consent Ley 1581), M3 (Meta Dispatch Guard), M4 (Durable Pacing & Leases), M6 (Destructive Guard), I6 (Transport Policy).
  - 7 suites de prueba nativas Node 24 creadas en `tests/`.
  - Corrección de colisión de puerto en `tests/dashboard-parity.test.ts` (DP-19).
  - Resultado test suite: **35 archivos de prueba, 324 passed, 0 failed, 0 errors**.
- **Higiene de Seguridad CI en CRM-ALBRA (`ad09b99`)**:
  - Whitelist de números ficticios de demo colombianos en `scripts/check-pii.mjs`: `npm run check:pii` exit 0 (árbol limpio).
  - Marcador `// scan-secrets:allow` en fixture de Meta en `tests/integration/wa-connections-panel.test.ts`: `npm run security:scan` exit 0 (0 secretos en el árbol).





## Unificación de las 3 generaciones de canales (Fase 1–4 del plan de simplificación) — 2026-11-21

- **Rama**: `repair/produccion-real`. Ejecuta el plan rector de `CONTEXTO CRM/AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION_FASE_POSTERIOR.md` + `INFORME_AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION.md`.
- **FASE 1 — Daemon Baileys canónico** (`src/whatsapp-daemon/daemon.mjs`): ya NO escribe en tablas legacy. Crea/verifica una `ChannelConnection` canónica por organización (`channel='whatsapp'`, `provider='whatsapp_baileys'`, clave `whatsapp_baileys:<orgId>`, `status='connected'`) al abrir sesión QR y escribe conversaciones/mensajes en `ChannelConversation`/`ChannelMessage`. El vínculo con la ficha 360 (`clientId`), `isAutoReply` y `transferredTo` vive en `ChannelConversation.metadata` (JSON). Dedup por `(conversationId, externalMessageId)` conservado; los salientes marcan `metadata.deliveryStatus='sent'`. Endpoints /conversations, /conversations/:id (GET/PUT) y /send conservan su contrato (mapeo canónico→legado para el panel WhatsApp).
- **FASE 2 — Google desacoplado**: modelo nuevo `GoogleIntegration` (1:1 por org; `googleEmail`, `googleRefreshTokenEnc`, `googleClientJsonEnc`, `calendarSyncEnabled`). `src/lib/google.ts` y `/api/google/*` leen/escriben la tabla dedicada. Los tokens existentes migran con la migración formal (INSERT INTO GoogleIntegration SELECT FROM Integration).
- **FASE 3 — Backfill y redirección total**: `scripts/backfill-whatsapp-history-to-channel.mjs` (nuevo) migra el historial completo de `WhatsAppConversation/WhatsAppMessage` al modelo canónico con IDs deterministas (`cm_<legacyId>`) — convergente con el backfill SQL de la migración, idempotente y sin duplicados (verificado: 5 mensajes legacy → 5 canónicos). `getIntegration` (integrations.ts) es ahora una **vista ensamblada canónica** (ChannelConnection + GoogleIntegration + Settings) con la misma forma para las rutas. `wa-connections.ts` usa ChannelConnection como ÚNICA fuente (plan gates, duplicados, disconnect, resolveOrg/resolveInternal sobre credentialsEnc). Webhooks de WhatsApp/Telegram/Instagram/Facebook/TikTok atribuyen 100% canónico (providerAccountKey / `webhookSecretHash`). `listInbox()` lee WhatsApp EXCLUSIVAMENTE de `ChannelConversation` (keys `cc:*`; keys `wa:*` retiradas con degradación elegante). Alineación de convención: Messenger usa `channel='messenger'` (helper de webhooks + backfill); la bandeja lo presenta como facebook.
- **FASE 4 — Retiro del esquema legacy**: migraciones expand/contract: `zzzzzzzz_canonical_channel_expand` (aditiva: `ChannelConnection.webhookSecretHash`, `ChannelConversation.metadata`, `Settings.agentLeadsSecretEnc`, tabla `GoogleIntegration`) y `zzzzzzzzz_drop_legacy_channel_models` (destructiva: backfill SQL de TODOS los canales + `agentLeads` + Google ANTES del DROP de `Integration`, `WhatsAppConnection`, `WhatsAppConnectionEvent`, `WhatsAppConversation`, `WhatsAppMessage`). CERO PÉRDIDA garantizada por doble red (backfill TS opcional + backfill SQL obligatorio en la migración, dedup por claves únicas/IDs deterministas). `ChannelConnection` es la única tabla de conexiones (43 modelos Prisma, antes 47+1).
- **Esquema**: `webhookSecretHash` (unique) en ChannelConnection permite atribución de webhooks por hash sin descifrar; `Settings.agentLeadsSecretEnc` hereda el secret HMAC de AGENTE-LEADS.
- **Verificación**: `npx tsc --noEmit` 0 errores; suite **128/128 archivos, 1104/1104 tests en verde** (incluye whatsapower-bridge, wa-connections reescrito a canónico, inbox, deal-send, deal-ai, webhooks IG/FB/WhatsApp/TikTok, dispatcher de workflows); `npm run security:scan` 0 secretos; `npm run check:pii` OK; secuencia de migración probada sobre BD con datos legacy reales (seed sintético: 3 conversaciones, 6 mensajes, 2 integrations → 0 tablas legacy, 3 conversaciones, 5 mensajes — 1 duplicado por `waMessageId` deduplicado — Google y agentLeads migrados). Scripts operativos migrados al modelo canónico (`golive-battery`, `check-wa-status`, `verify-wa-e2e`, `verify-daemon-send`, `backup-restore-drill`); `migrate-secrets.mjs` y `migrate-telegram-secrets.mjs` retirados con guard (operaban sobre Integration).
- **Sin cambios** en WHATSPOWER ni WHATSPOWER-ULTRA; el contrato `/api/internal/whatsapp/credentials` (OLEADA 2) se mantiene sobre la fuente canónica.
- **Runbook de despliegue (producción)**: 1) backup completo; 2) `npx prisma migrate deploy` (aplica expand y después contract; la contract incluye el backfill SQL); 3) opcional ANTES del paso 2: `BACKFILL_WHATSAPP_HISTORY_CONFIRM=1 node scripts/backfill-whatsapp-history-to-channel.mjs --apply` (converge con el backfill SQL); 4) verificación con `node scripts/verify-unification.mjs` (0 tablas legacy, conteos paridad) y suite completa.
- **Certificación (2026-11-21, `bfd77a7`)**: cierre documentado de las fases 1–4. Verificado en código: 43 modelos Prisma, 0 modelos legacy (`Integration`, `WhatsAppConnection`, `WhatsAppConversation`, `WhatsAppMessage`), migraciones `zzzzzzzz_canonical_channel_expand` y `zzzzzzzzz_drop_legacy_channel_models` presentes, daemon escribiendo tablas canónicas. Suites: CRM 128 archivos / 1.104 pruebas, WHATSPOWER 358, WHATSPOWER-ULTRA 324; `tsc` 0 errores; PII y escáner de secretos limpios.
- **Registro de auditoría**: la auditoría de ejecución de esta unificación quedó numerada **A-010** en `CONTEXTO CRM/AUDITORIAS.md`; antes repetía el número A-009 del 2026-11-20 (integración maestra).

## Corrección A-010 de la migración destructiva + backfill v2 — 2026-11-26

- **Hallazgo (propietario + Antigravity @ `d3f34ff`)**: `zzzzzzzzz_drop_legacy_channel_models` abortaba con «malformed JSON» por `json_extract` sobre `facebookTokenEnc`/`tiktokTokenEnc`, que son blobs cifrados `v1:iv:tag:datos`, no JSON. Además, la sentencia 3c (Telegram) escribía `externalAccountId = NULL` contra NOT NULL y el `INSERT OR IGNORE` descartaba la fila en silencio: **la conexión Telegram nunca migraba**.
- **Migración v2** (`prisma/migrations/zzzzzzzzz_drop_legacy_channel_models/migration.sql`): cero `json_extract` sobre columnas cifradas; Facebook solo por `facebookPageId` con constancia de filas no migradas en `ChannelConnectionEvent` (`migration_backfill_skipped`); Telegram/TikTok con clave estable por organización, blob cifrado tal cual y `pendingDecrypt` declarado; la identidad real (botId/openId/displayName) la rellena el backfill TS descifrando con la clave de la app, nunca SQL.
- **Prueba automatizada** (`tests/integration/migration-drop-legacy-channels.test.ts`, A1–A13): BD efímera con todas las migraciones, semilla legacy realista de las 3 generaciones con tokens `v1:...` no-JSON (2 organizaciones, Facebook con/sin pageId), aplica las dos migraciones finales y verifica tablas eliminadas, conteos, texto intacto, blobs byte a byte y PRAGMA integrity_check/foreign_key_check. Falla antes del fix («malformed JSON», verificado) y pasa 13/13 después.
- **`scripts/backfill-channel-connections.ts` v2**: lecturas legacy por SQL crudo con guarda de existencia (el script quedó roto en runtime tras retirar los delegados `db.integration`/`db.whatsAppConnection`) y pase de enriquecimiento Telegram/TikTok idempotente (descifra con la clave de la app, rellena identidad real, registra evento `legacy_backfill_enriched`, reporta duplicados sin modificarlos). Smoke verificado: dry-run wouldEnrich=2 → apply enriched=2 → re-run idempotente.
- **Runbook verificado con el motor real de Prisma** (detalle en `AUDITORIAS.md` A-010): deploy 21/21; abort reproducido con la migración original (mismo error); rollback total sin backfill parcial; `prisma migrate resolve --rolled-back` operativo; redeploy con v2 exitoso sobre la misma BD.
- **Puertas**: `tsc --noEmit` 0 errores; suite **129/129 archivos, 1117/1117 pruebas**; `security:scan` 0 secretos; `check:pii` limpio; bloque canónico de `PRODUCTION_READINESS.md` actualizado a `archivos_prueba: 129`.
- Sin cambios en WHATSPOWER ni WHATSPOWER-ULTRA.
