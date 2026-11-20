# CHANGELOG

## 2026-11-21 — Unificación de las 3 generaciones de canales (100% canónico)

- **Qué**: ejecución completa del plan de simplificación (`CONTEXTO CRM/AUDITORIA_REDUNDANCIAS_*`): daemon Baileys escribiendo en `ChannelConnection/ChannelConversation/ChannelMessage`, `GoogleIntegration` dedicada, backfill total del historial, redirección de conexiones/webhooks/bandeja al modelo canónico y DROP formal de `Integration`, `WhatsAppConnection(±Event)`, `WhatsAppConversation` y `WhatsAppMessage` con backfill previo (cero pérdida).
- **Por qué**: eliminar la deuda técnica de 3 generaciones coexistentes (Integration monocuenta → WhatsAppConnection Cloud → Channel* canónico) que duplicaba lecturas en bandeja, webhooks y credenciales.
- **Esquema**: 2 migraciones (expand aditiva + contract destructiva con backfill SQL); `webhookSecretHash` para atribución de webhooks por hash; `agentLeadsSecretEnc` en Settings; 43 modelos Prisma (antes 48).
- **Verificación**: tsc 0 errores; **1104/1104 tests (128 archivos)**; security:scan 0 secretos; check:pii OK; secuencia de migración probada sobre BD con datos legacy (paridad exacta 5/5 mensajes, 3/3 conversaciones, Google y agentLeads migrados).
- **Runbook de producción** en `CONTEXTO CRM/PENDIENTES.md` (backup → backfill opcional → migrate deploy → verify-unification).

## 2026-11-20 — Sesión 7: fix de entorno de preview (HMR dev bloqueado por origen)

- **Síntoma**: en el sandbox de preview la SPA quedaba clavada en «Cargando CRM ALBRA...» — sin errores de página, chunks al 200 % y cero llamadas a `/api` desde el cliente; la hidratación nunca terminaba.
- **Diagnóstico**: en Next 16 dev, la hidratación del App Router espera al WebSocket `/_next/hmr`; el handshake fallaba (`ERR_INVALID_HTTP_RESPONSE`) cuando la petición incluía cabecera `Origin` fuera de la lista blanca de `allowedDevOrigins`. Reproducido con curl: `Origin: http://127.0.0.1:3000` → respuesta vacía; `Origin: http://localhost:3000` → `101 Switching Protocols` OK.
- **Fix**: `allowedDevOrigins: ['localhost', '127.0.0.1', '*.space-z.ai']` en `next.config.ts` (incluye el dominio del gateway de preview). Sin cambios de código de la aplicación; suite intacta (1104/1104 en 128).
- **Verificación E2E en navegador**: landing → «INICIAR DEMO» → dashboard con KPIs reales de la organización demo (8 clientes activos, $4.000 de pipeline, $2.400 de ingresos del mes), pipeline kanban, gráfico de ingresos, próximas reservas y sugerencias de contacto; panel «Números WA» en Ajustes con estado real por número y sesión QR vía daemon (puerto 3002) operativo.

## 2026-11-20 — Sesión 6: consolidación total de ramas (A3/D2 completa) + kits de integración WP/ULTRA

- **Consolidación de las 6 ramas con contenido único** (pendiente de decisión desde la sesión 4; acta `docs/actas/CIERRE-FINAL-SESION-6-2026-11-20.md` §2, decisión por rama con evidencia):
  - `fix/whatsapp-production-media` (56 commits): port del endurecimiento de media — ASR por organización con validación base64, `X-WhatsApp-Org-Id` obligatorio en transcribe, visión con firma binaria (magic bytes) + techo 40 MP (sharp), media-guard del daemon con techos duros (25 MiB audio / 8 MiB imagen) y pipeline de imágenes con fail-open a humano; checklist de producción WhatsApp. Las partes superadas por la maestra (outbox durable, ledger de webhook, analyze-image) descartadas con decisión escrita.
  - `fix/fase-correctiva-final`: endurecimiento de referencias históricas cross-org (patrón B1 `stripForeignClients`) en las 9 rutas que faltaban (oportunidades, pipeline, cotizaciones+pdf, reservas, export CSV) + 6 tests de no-filtración.
  - `cierre/a-estabilizacion-y-deuda` (PR #5): migración aditiva `zzzzzzz_quoteitem_org_backfill` + 3 tests (reparación, idempotencia, cero NULLs).
  - `fix/migration-safety-audit`: test concurrente en-proceso del lease (complemento del caso multiproceso de D1).
  - `docs/plan-maestro-cierre-2026-11-19` (plan v1): integrado por cherry-pick como archivo histórico.
  - `docs/context-crm-reorganization-20261107`: NO fusionada (876 commits de desfase + arquitectura documental de la maestra ya cumple la función) — contenido preservado íntegro en su etiqueta de archivo.
- **Archivo y borrado de las 6 ramas** con etiquetas `archive/20261120-*` (SHAs verificados en servidor antes de crear cada tag): CRM-ALBRA queda en **5 ramas + 28 etiquetas**. CRM-2 intacto como espejo completo.
- **Kits de integración `integration-kits/wp-ultra/`** para las 13 dependencias externas (S3, S4, S7, M2, M3, M4, M6, I4, I5, I6, E5, E6, F6): 9 libs portables probadas (replay cache durable, crypto AES-256-GCM por org, bearer por org, bulk consent Ley 1581, guard de despacho Meta, pacing durable, guard destructivo de smoke-live, política de transporte por org, adaptador de pagos fail-closed) + README de aplicación por kit + paquete de decisiones I4/I5/E5/E6. Los repos WP/ULTRA no se tocan.
- **Suite**: 1024/1024 → **1104/1104 pruebas en 128 archivos** (+80); cifras canónicas reconciliadas (128 archivos de prueba, 19 migraciones); `tsc --noEmit` 0; `next build` OK; `verify-doc-figures` verde.

## 2026-11-20 — Sesión 5: U6 (semillas sectoriales para demos reproducibles)

- **U6 (F7-T06) — ejecutada** (estaba pospuesta; última tarea construible del plan): definiciones puras por sector en `scripts/demo-sectors.mjs` (restaurante, salud-estética, inmobiliaria) con validador integrado, y seeder idempotente `scripts/seed-demo-sector.mjs` que materializa la organización `demo-<sector>` con usuarios demo, pipeline sectorial, clientes, oportunidades, reservas, tareas, cotizaciones (+ítems, IVA 19 %) y conversaciones WhatsApp.
- **Seguridad**: el seeder aborta en entorno productivo (NODE_ENV/CRM_ENV/DATABASE_URL con «prod») y jamás toca organizaciones que no sean `demo-<slug>`; todo dato marcado «(Demo)/[demo]»; contraseñas de demostración impresas al terminar.
- **Reproducibilidad probada en BD desechable**: doble corrida produce los mismos conteos (6 clientes / 5 opps / 4 reservas / 5 tareas / 3 cotizaciones / 2 conversaciones — sin duplicados), totales de cotización conciliados contra sus ítems, y el resultado alimenta el dashboard real (1 tarea vencida, citas próximas, conversación sin contestar).
- **Tests**: +16 unitarios — invariantes de las definiciones (unicidad de claves, referencias internas, marcas demo, aislamiento cross-sector) y 8 casos negativos que demuestran que el validador detecta datos corruptos antes de tocar la BD. Suite: **1024/1024 en 115 archivos**; cifras canónicas reconciliadas (115).
- **Runbook**: nueva subsección «Demos reproducibles (U6)» en `docs/RUNBOOK-CRM.md` §2.

## 2026-11-20 — Sesión 4: D1 (integración PR #4 + tests multiproceso) + D2 (consolidación de ramas) + O1 (verificación estática)

- **D1 (F2-T04) — terminada**: tests del PR #4 (`workflow-outbox-ambiguous-ack.test.ts` — cuarentena del ACK ambiguo de WhatsApp vía trigger SQLite; el envío aceptado nunca se reenvía) y del scheduler multiproceso con lease (`scheduler-multiprocess.test.ts` + fixture + `vitest.worker.config.mts` — 2 procesos independientes compiten y se crea exactamente 1 run durable) portados a la maestra (`dde4207`). Bloque canónico reconciliado (112→114 archivos de prueba). Decisión escrita de cierre de PR #4/#6 en `docs/actas/CIERRE-D1-D2-O1-2026-11-20.md`.
- **D2 (F7-T05) — terminada (borrado con etiqueta)**: inventario ahead/behind de las 32 ramas de CRM-ALBRA → 22 ramas archivadas con etiquetas `archive/20261120-*` (SHAs verificados en servidor) y eliminadas; quedan 11 ramas vivas. **CRM-2 no se toca** (espejo de respaldo completo). Ramas con contenido único no consolidado (`fix/migration-safety-audit`, `fix/whatsapp-production-media`, `docs/context-crm-reorganization-20261107`, etc.) permanecen vivas para decisión del propietario.
- **O1 (F6-T01) — verificación estática completa**: YAML de compose válido (app + wa-daemon, ambos con healthcheck), Dockerfile 3 etapas, entrypoint con wait-db + `migrate deploy` con guardarrails, `/api/health` existente, volúmenes persistentes, `app` enlazado a 127.0.0.1. Runbook exacto para la máquina del propietario en el acta §O1 (Docker no existe en el sandbox).
- **Suite**: 1008/1008 en 114 archivos.

## 2026-11-20 — Sesión 3: consolidación en línea maestra + S1 + S2 (runbook) + F1 (PR #6) + F2 endpoint agregado + U5

- **Línea maestra `impl/integracion-maestra-20261120`**: consolida en UNA rama la cadena acumulativa sesiones 1+2 (F2 UI → M7 → F3 → M8 → E7 → F4 → F5 → U1 → U2 → U3 → U4 → I3 → O3 → S6 → O2 → E4 → D4 → E3 → I2+I1) más los aportes de esta sesión. Merge-only (sin reescritura de historia). Base para la decisión A3/D1 del propietario.
- **S1 (F1-T01)**: acta de rotación de credenciales `docs/actas/ROTACION-CREDENCIALES-2026-11-20.md` (inventario de PATs expuestos en chats + procedimiento de revocación). La revocación efectiva sigue siendo acción del propietario (el PAT clásico no puede revocarse a sí mismo vía API).
- **S2 (F1-T02) — preparación validada, ejecución GATED**: generador `scripts/security/build-purge-replace-text.mjs` (cobertura 35/35 huellas pendientes en 1169 commits) + runbook `docs/actas/VENTANA-PURGA-HISTORIAL-S2.md` con dry-run completo en clon desechable (filter-repo 2.47.0: 0 pendientes post-purga; baseline reclasificada 310 dummy / 0 pendientes). El force-push queda bloqueado hasta completar S1 (orden del plan).
- **F1 (F2-T03)**: PR #6 integrado (tareas y recordatorios + quick-actions de la ficha 360); migración `11_tareas` → `zzzzzz_tareas` (regla de z creciente); triggers CI `cierre/**`; `defaultTime` (F4) y `defaultClientId` (PR #6) conviven en el diálogo de reservas.
- **F2 — endpoint agregado**: `GET /api/whatsapp/connections-panel` (una llamada: conexiones Cloud + veredicto real del daemon + plan) con modelo de vista puro `src/lib/wa-connections-view.ts` y +25 pruebas (fail-closed ante daemon caído; aislamiento cross-org; sin fuga de material sensible).
- **U5 (F4-T05) — pulido visual (OPCIONAL del plan, ejecutada)**: tipografía mínima 13px como token `@utility` (barrido de 195 clases sub-13px en 30 archivos), dark mode completo bloqueado por invariante de CI, componente `EmptyState` reutilizable adoptado en 6 pantallas. +9 invariantes en `tests/unit/pulido-visual.test.ts`.
- **O4 (F6-T06) — observabilidad mínima y unidades systemd (OPCIONAL del plan, ejecutada)**: worker pull continuo `scripts/outbox-worker.mjs` (backoff acotado, cierre limpio, sin cuerpos en logs; +11 pruebas) y unidades `deploy/systemd/` (app, daemon Baileys `Restart=always`, worker, monitor con timer de 10 min) con README de instalación y **kill test** pendiente del propietario (systemd no corre en el sandbox). Runbook y `.env.example` actualizados.
- **Cifras conciliadas (E4/D4)**: bloque canónico recalculado — rutas_api=128, archivos_prueba=112, modelos_prisma=47, migraciones=18, componentes_ui=106; `CONTRATOS-ECOSISTEMA.md` con las 3 rutas nuevas (tasks ×2, connections-panel).
- **Suite**: 955/955 → **1006/1006** pruebas en 112 archivos; `tsc --noEmit` 0 errores; eslint limpio; `next build` OK; `verify-doc-figures` en verde.

## 2026-11-20 — Construcción del plan definitivo v2.0 (oleadas F2→O2) y cifras conciliadas (E4)

- **Construcción** (rama `docs/plan-definitivo-crm-2026-11-19` + ramas `impl/*`): F2 (UI de conexiones WhatsApp multi-número), M7 (criterio de unificación de bandeja), F3 (filtros y búsqueda server-side), M8 (conciliación operable UNCERTAIN), E7 (test backup/restore roundtrip), F4 (agenda semana/día), F5 (pantalla de Salud + wizard de puesta en marcha), U1 (navegación 5+1, una sola bandeja), U2 (dashboard "Requiere atención"), U3 (catálogo de errores accionables), U4 (ajustes por dominio), I3 (contratos del ecosistema), O3 (instalador idempotente), S6 (saneamiento de scripts e2e históricos), O2 (runbook único).
- **Suite**: 781/781 → **955/955** pruebas en 107 archivos; `tsc --noEmit` 0 errores; eslint limpio; `next build` OK.
- **E4 — cifras conciliadas**: `PRODUCTION_READINESS.md` deja de citar cifras viejas (107 rutas, 475/569 pruebas) y ahora incluye un **bloque canónico** recalcado por `scripts/verify-doc-figures.mjs` (rutas_api=125, archivos_prueba=107, modelos_prisma=46, migraciones=17, componentes_ui=104). El script es re-ejecutable en cada release; una cifra desalineada sale con exit 1 y la diferencia exacta. Las entradas históricas de este archivo NO se reescriben (son el registro de su fecha).
- **Control de avance**: `docs/CONTROL-AVANCE.md` con el estado de las 48 tareas del plan.

## 2026-11-17 — check:pii sin datos reales (hashes con sal, denylist local y whitelist exacta)

- **`fix(pii)`**:
  - **El escáner ya no contiene valores reales**: `scripts/check-pii.mjs` dejó de incrustar los datos prohibidos en texto plano (antes se detectaba a sí mismo: 6 violaciones y exit != 0 al correr `npm run check:pii`). Ahora los valores prohibidos viven SOLO como hashes SHA-256 con sal aleatoria por entrada en `scripts/pii-hashlist.json` (comprometido; funciona igual en CI).
  - **`scripts/pii-denylist-build.mjs`**: constructor de la hashlist. Reconstrucción local sin publicar valores: `node scripts/pii-denylist-build.mjs --from-git "scripts/check-pii.mjs@<revision-antigua>" --out scripts/pii-hashlist.json` — extrae de la historia de git y nunca imprime ni guarda valores en claro.
  - **Lista local opcional**: `scripts/pii-denylist.local.txt` (gitignored) o la ruta en `PII_DENYLIST_FILE`; si no hay ninguna denylist, se aplican solo los patrones genéricos con aviso explícito (CI no se rompe).
  - **Whitelist exacta documentada**: rango ficticio 573000000000–573000000099 (normalizado 3000000000–3000000099) + 117 números exactos usados en pruebas (unión verificada de los 3 repos, 2026-11-17). Cualquier otro número colombiano de 10 dígitos iniciando en 3 se reporta.
  - **Reporte redactado**: las violaciones se imprimen con el valor sustituido por `[REDACTADO]` y dígitos enmascarados; el número que dispara la alerta jamás aparece en el log.
  - **Verificación**: exit 0 en los 3 repos; negativas: número no autorizado -> exit 1 (`TELEFONO_NO_AUTORIZADO`); valor real plantado -> exit 1 (`DATO_PROHIBIDO:phone`); lista local vía `PII_DENYLIST_FILE` -> exit 1 (`DATO_PROHIBIDO:name`); hashlist ausente -> avisos y exit 0.

## 2026-11-17 — Higiene PII y guardián automatizado en CI

- **`fix(pii)`**:
  - **Saneamiento exhaustivo de PII**: Reemplazo de identificadores personales en archivos rastreados (`worklog.md`, `scripts/e2e-tiktok-2026-10-31.sh`, `scripts/mock-tiktok-server.mjs`) por datos ficticios estándar (`Operador Demo`, LID `215779999999999`, handle `operadordemo01`).
  - **Guardián automatizado (`scripts/check-pii.mjs`)**: Escáner AST y regex ejecutado con `npm run check:pii` que audita el árbol rastreado por git buscando números telefónicos colombianos reales (`573...`), nombres personales u operadores reales.
  - **Integración en CI (`.github/workflows/ci.yml`)**: Agregado el paso `Escáner de PII y teléfonos reales` previo a la ejecución de pruebas. Suite Vitest: **781/781 PASS** (96 test files).

## 2026-11-17 — Blindaje del ciclo de vida QR de WhatsApp (Baileys) y solución Handshake 428

- **`fix(whatsapp)` (6f2ca35 & 78151c8)**:
  - **Resolución de Error 428 (`connectionClosed` / `Connection Terminated`)**: WhatsApp cerraba el WebSocket al generar el código QR debido al descriptor de navegador `['CRM ALBRA', 'Chrome', '1.0.0']` y versión obsoleta de Baileys. Se actualizó a `Browsers.ubuntu('Chrome')` y consulta dinámica con `fetchLatestWaWebVersion()` (con timeout de 3.5s y fallback seguro).
  - **Saneamiento automático de sesiones huérfanas**: Si existe `.wa-auth/<orgId>/creds.json` pero carece de `me.id` (sesión no emparejada o escaneo interrumpido), se purga el directorio antes de inicializar `useMultiFileAuthState()`, previniendo corrupción de claves de cifrado en reintentos.
  - **Límite de reintentos en bucle**: Se estableció un tope de 3 reintentos automáticos si la sesión no está autenticada, pasando a estado `qr_expired` para proteger la IP contra bloqueos y throttling de WhatsApp.
  - **TTL y frescura de QR**: `GET /qr` ahora reporta `ttlSeconds` (25s), `qrGeneratedAt` y `qrExpiresAt`. `POST /connect` admite `{ force: true }` para forzar reinicio inmediato del socket y emisión de un nuevo QR.
  - **Frontend reactivo (`settings-page.tsx`)**:
    - Temporizador regresivo visible de 25 segundos (`Activo (Xs)`).
    - Desenfoque y overlay de expiración interactivo con botón *"Generar nuevo QR"* (`handleWaConnect(true)`).
    - El botón "Refrescar QR" ahora solicita regeneración forzada al daemon.
    - Eliminado el parpadeo de imagen durante la transición de estado.
- **`merge` (ac2f3ee)**:
  - Integración sin conflictos de los commits remotos de SSO de ecosistema (`origin/repair/produccion-real`) con las mejoras locales de WhatsApp.

## 2026-11-17 — Acceso directo al ecosistema (SSO de un solo uso)

- **`feat(ecosystem)` (9276e22)**: el botón **Ecosistema** del sidebar (desktop y móvil) abre
  WhatsPower (capa 2A) y WhatsPower-Ultra (capa 2B) con sesión de operador, sin repetir
  credenciales y también desde la sesión demo:
  - `GET /api/auth/ecosystem/links` (autenticado): emite un enlace por capa con token
    `v1.<payload>.<hmac>` — HMAC-SHA256 con `ECOSYSTEM_SSO_SECRET` compartido, TTL 90 s,
    `jti` de un solo uso, verificación timing-safe en el receptor.
  - Fail-closed: sin `ECOSYSTEM_SSO_SECRET` o sin `WHATSPOWER_STUDIO_URL`/`ULTRA_STUDIO_URL`
    el enlace se declara `available:false` y JAMÁS se emite token.
  - Receptores: `GET /studio/login-ecosystem` en 2A y 2B (canje único, 302 con cookie HttpOnly;
    404 sin secreto, 403 inválido/expirado/reutilizado).
  - El login-demo anónimo y los logins clásicos de cada studio quedan intactos.
  - Pruebas: `tests/integration/ecosystem-links.test.ts` (9 casos). Suite: **773/773**.
  - Docs: README §Ecosistema, `.env.example` (`ECOSYSTEM_SSO_SECRET`, URLs de studios).


## 2026-11-17 — Reparación de producción real (FASE 1.C + higiene + FASE 5)

### Seguridad — Daemon de WhatsApp (Baileys)
- **`fix(daemon)` (4284687)**: `src/whatsapp-daemon/daemon.mjs`:
  - **Bind a 127.0.0.1 por defecto** (antes 0.0.0.0): el daemon es un servicio
    interno y jamás queda expuesto a la red; `HOST` admite override explícito.
  - **Secreto compartido con timingSafeEqual** (SHA-256 de longitud fija — sin
    fuga de contenido ni longitud por tiempo de comparación); nuevo módulo
    testeable `security-helpers.mjs`.
  - **Validación EXACTA del origen** con `new URL(origin).origin`: eliminado el
    `.startsWith()` que aceptaba `crm.albra.co.attacker.com`; orígenes
    malformados se RECHAZAN (no se omiten); peticiones servidor-a-servidor sin
    Origin no pasan filtro (el proxy de Next no envía Origin).
  - `ENV_FILE` para pruebas herméticas (jamás toca el `.env` real).
  - Prueba: `tests/integration/daemon-security.test.ts` (6 casos vitest:
    helpers unitarios, secreto 200/401, sufijo atacante 403, bind no-loopback
    verificado contra la IP real de la máquina, inspección estática).

### Seguridad — Aislamiento tenant en rutas no verificadas (FASE 5)
- **`fix(security)` (057511b)**: nueva suite `tests/integration/tenant-route-hardening.test.ts`
  (22 pruebas): anónimo→401, miembro→403, admin de otra org→404 SIN oráculo,
  con verificación de EFECTO CERO, para OAuth social (Instagram/Facebook/TikTok
  start+config, Telegram config, Google auth/disconnect), equipo
  (/api/team, /api/team/:id), conocimiento, campos personalizados y
  /api/internal/*.
- **Defensa en profundidad**: `WHERE id = ? AND organization_id = ?` EXPLÍCITO
  en las mutaciones por id de api-keys, custom-fields, knowledge, saved-views y
  team (un id adivinado/cruzado jamás muta registros de otro tenant). Auditoría
  completa del resto de rutas: findFirst con organizationId en el mismo handler.

### Higiene y documentación
- **`docs(hygiene)` (2ae7f9f)**: aviso de canal NO oficial Baileys en README;
  dummy de secreto de prueba marcado `scan-secrets:allow`.
- **`docs(parity)` (5089356)**: matriz de paridad sincerada — la fila
  "Rotación de Líneas" declaraba 100% Paridad SIN código: ahora
  "No implementada (Requiere integración futura)".
- **`chore` (0368299)**: `.gitignore` bloquea `*.pdf`, `backups/`, `storage/temp/`
  (el árbol ya estaba limpio de PDFs/PIDs/logs rastreados).
- 2FA documentado en `docs/MIGRACIONES.md` (migración 3, preexistente
  verificado: setup/enable/verify/disable, secreto cifrado AES-256-GCM).

### Números de la sesión
- Suite completa: **764/764** PASS en 94 archivos (vitest; tras regenerar el cliente Prisma) ·
  `security:scan`: 0 secretos en el árbol.

---


## [repair/produccion-real] 2026-11-15 — Preparación para Producción Real

### Fase 1 — Canal Oficial de WhatsApp
- **Meta Cloud API por defecto:** Integración de Meta Cloud API como transporte principal para organizaciones de pago.
- **Ventana de 24 horas y Plantillas:** Control estricto de la ventana de 24 horas (`MessagingWindowStore`) y bloqueo de envíos fuera de ventana sin plantilla aprobada.
- **Clasificación de Errores Meta:** Clasificación explícita de errores (límites, calidad de número, plantilla rechazada) y aislamiento de estados `UNCERTAIN` sin reintentos ciegos.

### Fase 2 — Consentimiento y Cumplimiento Normativo (Ley 1581)
- **Almacenamiento de Consentimiento:** Registro auditable de autorización previa por organización y teléfono (`consent_records` y `consent_audit_log`).
- **Validación JIT:** Bloqueo automático (`SKIPPED_NO_CONSENT`) para cualquier contacto sin consentimiento previo vigente.
- **Importación CSV:** Requisito obligatorio de columna `consent_origin` en importador de audiencias.
- **Bajas y Habeas Data:** Revocación automática de consentimiento ante bajas/STOP; endpoints `/api/compliance/contact-data` para exportación y borrado de datos.
- **Rastreo de Clics Seguro:** Validación estricta `TRUST_PROXY === 'true'` y almacenamiento de IP anonimizada con hash SHA-256 de 16 caracteres.

### Fase 3 — Estabilidad, Versiones y Operaciones
- **Alineación de Entorno:** Node aligned a `>=22.12.0` (engines), `.nvmrc` (`22.14.0`), Dockerfiles (`node:22-alpine`) y CI (`node-version: 22`).
- **Runner de Pruebas Multiplataforma:** `scripts/run-tests.mjs` en WHATSPOWER y ULTRA para evitar cuelgues por `--test-isolation=process` en Windows/Node 22+.
- **Observabilidad Operativa:** Endpoints `/api/health` ampliados con métricas de base de datos, colas, despachos y memoria.
- **Benchmark SQLite:** Capacidad validada de 70,914 inserts/s (batch) y 2,541 claims/s (cola), demostrando soporte para producción en nodo único sin requerir PostgreSQL.
- **Runbooks:** Guías operativas paso a paso en `WHATSPOWER/docs/RUNBOOK.md` y `WHATSPOWER-ULTRA/docs/RUNBOOK.md`.

### Fase 4 — Higiene y Sanitización
- Purgados todos los datos personales sensibles (teléfonos reales, nombres) de CONTEXT, fichas, scripts y tests.
- Retiradas afirmaciones engañosas de paridad 100% ManyChat/WhatsOn.
- Exclusión de binarios residuales, logs y dumps en `.gitignore`.

### Fase 5 — Calidad y Verificación
- TypeScript compilation: 0 errores en CRM-ALBRA, WHATSPOWER y WHATSPOWER-ULTRA.
- Suites de pruebas: 250/250 en WHATSPOWER y 194/194 en WHATSPOWER-ULTRA superadas al 100%.

---

## 2026-11-15 — Producción real: higiene, E2E de 3 servicios y B2 residual (rama repair/produccion-real)

### Corregido (cada ítem con su prueba ejecutada)
- **B2 residual — idempotencia del daemon Baileys:** `/send` del daemon leía solo `to`/`text` (ventana real de duplicación). Ahora reserva `idempotencyKey`/`X-Correlation-Id` en tabla aditiva `DaemonSendIdempotency` ANTES del envío: claves en curso → 409 IN_FLIGHT sin reenvío; lease vencido → 409 UNCERTAIN permanente (jamás reenvío automático); DONE responde el messageId original sin reenviar; FAILED permite reintento. Pruebas `tests/unit/daemon-idempotency.test.ts` (6, fallaban antes del fix, pasan después).
- **Higiene PII:** teléfonos reales del negocio/destinatario sustituidos por dummies 573000000001/2 en `worklog.md`, `handoff.mjs` y `handoff.test.ts` (45/45 en verde); contraseña demo ya no se versiona (`DEMO_PASSWORD` fail-fast en 2 scripts).
- **Artefactos retirados del árbol (38 archivos):** pids, logs, PDFs, capturas, backups y respuestas E2E viejos + `.gitignore` anti-reintroducción. Historial NO purgado (regla).
- **Versiones:** `engines.node >=22.12.0` + `.nvmrc` 22.14 (igual que WP/ULTRA; CI ya usaba Node 22).
- **Baseline de secretos del historial:** +319 pares (commit,huella) verificados uno a uno como fixtures dummy de test (0 secretos reales) → `security:scan` y `security:scan:history` en verde (exit 0).

### Pruebas y evidencia
- Suite: **736/736 (92 archivos)** · tsc 0 errores · eslint 0/0 · `npm audit` 0 vulnerabilidades.
- **E2E de los 3 servicios reales juntos** (`scripts/e2e-3-servicios.mjs`, 18/18 PASS, ALLOW_REAL_DISPATCH=false): webhook Meta firmado → CRM valida → puente → WP procesa → flujo ejecuta crm_action → CLIENTE creado en el CRM real; lock IN_FLOW_2A verificado en WP; campaña ULTRA con contacto con lock (LOCK_EXCLUDED), sin consentimiento (SKIPPED_NO_CONSENT) y válido (FAILED_FATAL por salvaguarda, jamás SENT; SENT=0).
- Studios probados en navegador real (Playwright/Chromium 11/11): Flow Studio carga, paleta 7 nodos, addNode añade nodo al lienzo (nodos 8→9), Campaign Studio con Historial y métricas, vista móvil 390px sin desbordamiento.

### Límites honestos
- Docker compose NO se ejecutó (sin docker en el entorno de trabajo; tarea del PC en OWNER_TODO).
- El flujo E2E corre con servicios reales en simulación: ningún mensaje real, ninguna sesión Baileys conectada.

# CHANGELOG — Reparación Integral 2026-11-06

## [fix/reparacion-integral] CRM-ALBRA

### Seguridad
- **JWT-in-URL eliminado**: descargas directas con tickets de un solo uso (60 s, SHA-256) vía `POST /api/download-ticket` + `?ticket=`; `?token=` ya no autentica.
- Puente CRM→WhatsPower en **HMAC v2** (timestamp ligado al cuerpo) y stage-change con Bearer (los Stage Triggers morían en 401 silencioso).
- Lifecycle: rate limiting (login 10/min cuenta + 30/min IP; forgot 5/h; reset 10/h), resetToken **solo como SHA-256**, revocación de sesiones (cutoff `iat`) al cambiar contraseña, desactivar o degradar.
- 4 rutas daemon→CRM con comparación timing-safe; `handle()` mapea P2002→409 / P2025→404 y devuelve 500 genérico sin fuga de SQL.

### Tests
- 464 → **475 tests** (L1–L6: tickets, revocación, hasheo de reset, HMAC v2, rate limit). Scanner de secretos limpio.

## [fix/reparacion-integral] WHATSPOWER

### Seguridad
- `/qr` y `/qr/data` tras puerta Bearer (el QR de WhatsApp permitía secuestrar la sesión); visor reescrito como shell con clave en sessionStorage (jamás en URL).
- Webhook de pagos: `eventId` único + **idempotencia durable** (`payment_webhook_events`), validación `amount/currency/reference`, **máquina de estados legal** (terminales inmutables), auditoría completa (`payment_audit`), transición **atómica** (`BEGIN IMMEDIATE` + changes), simulator bloqueado en producción salvo decisión explícita.
- HMAC **v2** (`${ts}.${body}`) + rotación `actual|previo` + anti-replay **durable** (SQLite, sobrevive reinicios y multi-réplica).
- Servidor en `127.0.0.1` por defecto.

### Funcionalidad
- Flow Studio operativo tras el endurecimiento (puerta de clave + Bearer automático en `/api/*`).

### Tests
- 86 → **104 tests** (PAY-01..07, 7 negativas de pagos, QR-01..03, replay durable).

## [fix/reparacion-integral] WHATSPOWER-ULTRA

### Seguridad
- HMAC **v2 con secretos por organización** (`WEBHOOK_LEAD_SECRETS="org:sec|prev"`, org reservada `_legacy`); firma liga `org+timestamp+body` (cierra replay con ts fresco); huellas anti-replay por organización (sin colisión cross-org).
- Inyección cross-org cerrada: webhook-lead 403 si la campaña no pertenece a la org autenticada; el secreto v1 no puede ligar leads a campañas.
- Anti-replay **durable** (SQLite) sobrevive reinicios; `REPLAY_DB_PATH` para réplicas.

### Cola de despacho
- **Claim atómico** `PENDING→DISPATCHING` (UPDATE condicional + `claimed_by/claimed_at`): un ítem, un worker; fin del doble despacho concurrente.
- `reconcileStaleClaims()` controlado → `UNCERTAIN_DISPATCH` (nunca reintento ciego); `recoverFromCrash` solo toca claims stale; updates post-claim con guard `claimed_by` (multi-réplica).
- `PAUSED*` no despacha; idempotencia unificada con el importador CSV; `ALLOW_REAL_DISPATCH` con paridad en ambos adaptadores (la salvaguarda queda intacta).

### Funcionalidad
- Campaign Studio operativo (puerta de clave + Bearer automático); 5 rutas con body limitado (413); checkers 2A con Bearer (la integración anti-ban vuelve a funcionar).

### Tests
- 60 → **76 tests** (7 negativas HMAC obligatorias, ORG-WH-01..03, REPLAY-DUR-01, CLAIM-01..05).


## 2026-11-11/12 — Auditoría integral: ciclos 1 y 2 (rama impl/audit-20261111)

### Corregido
- Seguridad: rate limiting durable en BD; fail-closed de secretos; HMAC timing-safe;
  secretos Telegram cifrados con lookup por hash; JWT jamás en URLs de export; errores
  genéricos (sin filtrar e.message); P2002→409 / P2025→404.
- Fiabilidad: idempotencia extremo a extremo con eventId determinista; dedup de webhooks
  (waMessageId/mid) incl. statuses; liberación de dedup on-throw; transacciones atómicas
  (registro, conexiones con límite de plan, cliente+timeline); WAL + busy_timeout.
- Frontend (CRM): deep-links reales, reset de formulario corregido, TabsList wrap,
  JSON.parse blindado, vista /chat muerta eliminada.
- Pruebas: suites en verde al cierre de cada ciclo; pruebas nuevas para cada corrección
  (rate limit durable, dedup, dual-formato, release-on-throw, etc.).

### Rerequisito de despliegue
- Ejecutar `npx prisma migrate deploy` (incluye migración 4_audit_indexes con respaldo
  reversible) y `node scripts/migrate-telegram-secrets.mjs` (backfill idempotente).
- NO desplegar sin autorización expresa del propietario.
