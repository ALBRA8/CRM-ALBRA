# Pendientes

## Crítico — aislamiento y seguridad

### P0.1 — WhatsApp Baileys multi-organización
- [x] Implementación y pruebas reportadas: sesiones por org, credenciales aisladas, validación de orgId, rutas con alcance por organización y proxy CRM ligado al JWT.
- [x] Verificar independientemente el diff y el commit c2f4001 en ALBRA8/CRM-ALBRA — HECHO 2026-11-06 (commit ∈ main, código presente, tests en verde).
- [x] Confirmar que main y fix/saas-security-and-stabilization apuntan al commit esperado y que stable-production sigue intacta en ea87cc2 — HECHO 2026-11-06 (ls-remote local+remoto).
- [x] Repetir pruebas de aislamiento — HECHO 2026-11-06 (suite 464/464 incluye whatsapp-session-verdict, doctor-isolation, nicho-isolation).

### P0.2 — Ejecuciones del Doctor — CERRADO 2026-11-06
- [x] orgId derivado de identidad autenticada; escritura cross-tenant imposible (D1), lectura scoped (D2), roles 403 (D3), anónimo 401 (D4), sesión por org (D5), parámetros de cliente ignorados (D6) — todos en verde.

### P0.3 — Endpoint público /api/nicho — CERRADO 2026-11-06
- [x] GET lectura pura sin creación; orgId desde JWT (body/query ignorado y registrado); anónimo solo campos públicos; 400 traversal; 404 genérico sin oráculo; 429 rate-limit; PUT member 403 — N1–N10 en verde.

### P0.4 — Secretos inseguros — CERRADO 2026-11-06
- [x] Escáner de secretos `scripts/scan-secrets.mjs` + 11 pruebas + `npm run security:scan[:history]`; árbol LIMPIO.
- [x] 5 artefactos E2E con credenciales eliminados del árbol + .gitignore preventivo; valores históricos verificados MUERTOS (DB sin API keys, JWTs no firman con secretos vivos, daemon responde 401 al valor antiguo).
- [x] Secreto de daemon antiguo purgado de 5 scripts → fail-fast por entorno.
- [ ] PENDIENTE (requiere al propietario): purga del historial git (filter-repo/BFG + force-push) para borrar los valores muertos de commits antiguos; requiere ventana de congelación y re-clone de todos los clones.

### CP-Sec-01 — Higiene de repositorio (2026-11-06)
- [x] `scripts/start-whatspower-detached.mjs` eliminado (código operativo de otro repo con ruta absoluta).
- [x] Imports con ruta absoluta `/home/z/repos/...` corregidos a rutas relativas `repos/` en scripts E2E.
- [ ] PENDIENTE: limpiar baseline de lint (358 errores preexistentes, mayormente en scripts one-off E2E) sin tocar rutas de producción.

## Alto — multicuenta
- [x] Diseñar entidad canónica `ChannelConnection`, conversaciones y mensajes aislados por conexión.
- [~] Backfill repetible disponible con dry-run por defecto, doble/triple confirmación y reporte de conflictos; ejecutar en staging, completar dual-read/paridad y ensayar rollback sigue pendiente.
- [x] Documentar que Baileys separa sesiones por organización, no por cada cuenta individual; no confundirlo con multicuenta completa.
- [~] Instagram OAuth/selector y WhatsApp Cloud sincronizan conexiones canónicas; falta auditoría integral de state/PKCE, renovación y revocación por proveedor.
- [~] WhatsApp Cloud e Instagram tienen webhooks y outbox canónicos en transición; Telegram, Facebook Messenger y TikTok siguen pendientes de adaptadores, ciclo de vida y pruebas.
- [x] Confirmar el alcance final de cinco canales: WhatsApp, Instagram, Facebook Messenger, Telegram y TikTok.

## Alto — SaaS y operación
- [ ] Elegir motor de producción y ensayar migración desde SQLite.
- [ ] Definir onboarding, invitaciones y recuperación.
- [ ] Definir planes, cuotas, medición y facturación.
- [ ] Definir retención, exportación y eliminación.
- [ ] Definir observabilidad, alertas, SLO, RPO y RTO.
- [ ] Ejecutar restauraciones y pruebas de carga reproducibles.

## Medio — calidad/ecosistema
- [ ] Inventario de endpoints, modelos y permisos.
- [ ] Matriz de capacidades por canal.
- [ ] Revisar idempotencia, reintentos y dead-letter queue.
- [ ] Contratos versionados entre productos ALBRA.
- [ ] Confirmar estado de ramas de evolución.

## Continuación outbox y webhook echo — 2026-11-13 (histórico consolidado)

- [x] Confirmación de outbox enlaza un echo de Instagram preexistente por `conversationId + externalMessageId`, con validación de dirección/cuerpo y sin crear duplicado.
- [x] Conciliación manual `unknown → sent` reutiliza el mensaje echo preexistente si coincide.
- [x] Webhook Instagram persiste `is_echo` como mensaje saliente en la conversación de la cuenta exacta.
- [x] Prueba de integración para el orden echo-antes-de-ACK añadida.
- [x] Carrera WhatsApp Cloud cubierta mediante `biz_opaque_callback_data` y conciliación de status callbacks antes/después del ACK.
- [x] Fixtures firmados de POST batch para WhatsApp (dos tenants + destino desconectado) e Instagram (dos cuentas + cuenta desconectada), con replay deduplicado.
- [x] Persistencia/deduplicación durable por conexión mediante `ChannelWebhookEvent`; los handlers reclaman eventos y responden 500 cuando un evento sigue ocupado o falla para permitir reintento.
- [x] CI completa del HEAD `61c35988a54ee3182169122de0681c6724454940` (push y pull_request) — éxito: TypeScript, lint ratchet, migraciones limpias, suite de tests y build de producción.

## Backfill de conexiones legacy — 2026-11-13

- [x] Script `scripts/backfill-channel-connections.ts` disponible con dry-run predeterminado, confirmación doble para aplicar, cifrado de credenciales, transacción por conexión, auditoría y no-destructivo.
- [x] Fuentes soportadas: WhatsAppConnection, Integration legacy de WhatsApp/Instagram/Messenger/Telegram/TikTok cuando existe identidad y token exactos.
- [x] Evita sobrescribir conexiones canónicas y deduplica la misma clave entre fuentes legacy; conflictos entre tenants no se reasignan.
- [ ] Ejecutar dry-run en staging y revisar conteos/conflictos.
- [ ] Aplicar backfill solo tras backup restaurable y aprobación explícita; nunca ejecutar en producción automáticamente.

## Continuación multicanal — estado técnico 2026-11-13

- [x] Correlación WhatsApp Cloud outbox ↔ webhook mediante `biz_opaque_callback_data`, comprobando tenant/conexión/provider antes de conciliar.
- [x] Callback de estado puede confirmar `sending/unknown → sent` sin reintento ciego.
- [x] Persistencia de recibos `sent/delivered/read/failed` en mensaje canónico y presentación en el hilo.
- [x] Orden monotónico de recibos y deduplicación de timeline por `messageId + status`.
- [x] Tabla `ChannelWebhookEvent`, migración 9, claim concurrente por conexión, recuperación de eventos fallidos/leases vencidos y tests de integración del ledger.
- [x] Integración del ledger en los handlers canónicos de WhatsApp e Instagram; los handlers responden 500 ante fallo procesando un evento reclamado para permitir retry del proveedor.
- [~] La reclamación + deduplicación por TimelineEvent evita repetir workflows/autorespuestas después de que el timeline se confirmó; queda una ventana at-most-once donde un crash antes del efecto puede perder la automatización. Outbox/idempotencia propia sigue pendiente.
- [x] Fixtures firmados de POST batch y pruebas de ruta completas para WhatsApp (dos tenants + destino desconectado) e Instagram (dos cuentas + destino desconectado + fallback legacy bloqueado).
- [x] CI completa del HEAD de código `61c35988a54ee3182169122de0681c6724454940` — éxito en push y pull_request; los cambios posteriores son documentales.

## Trabajo de tests Windows/.env — RESUELTO 2026-11-06
- [x] 658740b localizado y verificado en ALBRA8/YOUTUBE-AUTOMATION (cuarto repositorio del ecosistema, confirmado por el propietario).
- [x] Las correcciones están en main de ese repositorio (posteriores a 658740b); no corresponden a CRM-ALBRA.
- [ ] Verificación en Windows real con el .env local: requiere la máquina del propietario (ver informe de cierre YT-AUTOMATION).

Cerrar cada pendiente con commit/PR, evidencia de pruebas y revisión de seguridad; no basta con código parcial. No desplegar sin autorización expresa.

## Reparación General Integral 2026-11-06 — pendientes del operador

1. **ROTACIÓN DE SECRETOS HISTÓRICOS (prioridad alta)**: el historial git contiene secretos reales publicados antes de la reparación (baseline verificable en `scripts/security/secret-baseline.json`, 78 huellas en commits 23c945e, d646cf9, 541d9b2, ab23795, f2e98c0, ff8b184e, 8d01287, c54f5c1: JWTs, APP_SECRET/CONFIG_SECRET, token de Slack). Acción: rotar APP_SECRET, secretos de integraciones y el token de Slack; opcionalmente purgar el historial con `git filter-repo` (requiere force-push — decisión explícita del operador; la rama `stable-production` NO debe reescribirse).
2. **Lint**: baseline heredado de 331 errores registrado en `scripts/security/eslint-baseline.json` (solo puede BAJAR; `npm run lint:baseline` bloquea errores nuevos en CI). Reducción progresiva pendiente.
3. **`npm audit --omit=dev`**: paso de CI no bloqueante; hacer triage y elevar a bloqueante tras revisar hallazgos.
4. **Trabajo concurrente de terceros**: existe WIP sin seguimiento (chat/agent) que incumple el gate de independencia del chaleco (`tests/unit/harness-independence.test.ts` falla con ese WIP presente y pasa 4/4 en checkout limpio). Coordinar con su autor: o se integra correctamente o se retira.
5. **Migración Prisma**: `User.tokenVersion` se aplica con `prisma db push` (BD actual ya la tiene). Si se adoptan migraciones formales, crear la migración correspondiente (reversible: DROP COLUMN).


## Plan de cierre y evolución — 2026-11-12

**Propósito:** continuar desde la base existente y cerrar brechas verificables. Esta sección complementa el inventario anterior; no sustituye ni elimina entradas históricas.

### Base que se conserva
- Multiusuario en CRM-ALBRA: usuarios, roles y permisos por organización. No reconstruir.
- Multiempresa/multi-tenant: organización como límite de propiedad y aislamiento en los tres repositorios. No reconstruir; mantener pruebas negativas entre organizaciones.
- Capacidades conversacionales, campañas e integraciones existentes: reutilizar y ampliar solo donde la evidencia demuestre una brecha.

### Plan priorizado
1. **Línea base común de los tres repositorios.** Registrar SHA de cada rama objetivo, PR/ramas de evolución, CI y pruebas reproducibles. Distinguir explícitamente `main`, ramas repair/fix y `stable-production`; no asumir que cambios en ramas están integrados o desplegados.
   - Aceptación: matriz por repositorio con commit, estado de CI, pruebas ejecutadas, alcance (mock/real) y estado de integración/despliegue.
2. **Contratos e integración CRM-ALBRA ↔ WHATSPOWER ↔ WHATSPOWER-ULTRA.** Verificar identidad de organización, autorización, eventos, webhooks, bajas/supresiones, reintentos e idempotencia de extremo a extremo.
   - Aceptación: pruebas reproducibles con procesos reales separados para los flujos críticos; mocks identificados como tales. Cerrar especialmente la ventana de duplicación del envío WhatsApp señalada en la revisión B2: si no puede demostrarse deduplicación externa, mantener el resultado UNCERTAIN y prohibir reenvío automático sin reconciliación.
3. **Seguridad y cierre operativo.** Unificar política de contraseñas y permisos; revisar/rotar secretos históricos según el procedimiento aprobado; resolver baseline de lint; formalizar migraciones y respaldos/restauración.
   - Aceptación: evidencias de escaneo, pruebas de autorización, rotación confirmada, migración ensayada y restauración comprobada. Las acciones que reescriban historial Git o requieran force-push necesitan autorización expresa del propietario.
4. **Multicuenta y multicanal.** Diseñar y migrar sin pérdida desde la configuración actual uno-a-uno hacia conexiones múltiples por organización y canal. Cada conexión debe tener credenciales, OAuth/sesión, webhook, estado y ciclo de revocación propios. Validar resolución inequívoca de cuenta entrante y selección explícita de cuenta saliente.
   - Aceptación: pruebas de dos o más cuentas del mismo canal en una organización, sin cruces de mensajes, credenciales ni eventos. WhatsApp multi-sesión reportado/verificado en ramas concretas no equivale por sí solo a multicuenta general para todas las plataformas.
5. **Identidades virtuales y memoria aislada.** Definir una entidad de perfil/persona/marca dentro de la organización (sin confundirla con usuario humano ni crear organizaciones artificiales por defecto). Vincular a cada perfil sus cuentas de canal, número, correo, clientes, conversaciones, preferencias y memoria.
   - Aceptación: pruebas con al menos dos perfiles que demuestren aislamiento de clientes, historial, memoria, credenciales y respuestas; permisos administrativos y trazabilidad de cambios.
6. **Preparación SaaS/producción.** Decidir base de datos de producción y estrategia de despliegue; evaluar migración desde SQLite, concurrencia, observabilidad, cuotas/onboarding, retención, exportación/eliminación, SLO, RPO/RTO y carga.
   - Aceptación: entorno de staging reproducible, migración y rollback ensayados, backup/restauración y pruebas de carga; no declarar producción lista solo por CI verde.

### Reglas de ejecución
- No reescribir módulos funcionales ni reconstruir multiusuario/multiempresa sin evidencia de defecto.
- Antes de modificar, identificar repositorio, rama, archivos y pruebas afectadas; preservar cambios ajenos y el historial.
- Cada tarea se cierra con commit/PR, evidencia de pruebas y revisión; separar implementado, probado, integrado y desplegado.
- No desplegar, activar envíos reales ni reescribir historial sin autorización expresa.
- Actualizar este documento y ROADMAP.md con fecha, SHA y evidencia al cerrar cada bloque.

### Criterio de estado
La base multiusuario y multiempresa está implementada según el contexto y las auditorías registradas. La preparación de producción, la integración real de extremo a extremo, la multicuenta general y la gestión de identidades virtuales permanecen sujetas a los criterios de aceptación anteriores. No se declara ninguna de estas últimas como terminada por el mero hecho de existir modelos, documentación, mocks o CI satisfactorio.

## Selector multiempresa Super Admin — PR #3 (2026-11-13)

- [x] Endpoint protegido `POST /api/super/switch-organization` añadido en la rama `fix/migration-safety-audit`.
- [x] Método cliente `switchSuperOrganization()` conectado.
- [x] Acción **Ingresar** conectada en la tabla del panel Super Admin; sincroniza token/sesión y abre el dashboard de la organización seleccionada.
- [x] Bloqueo de organizaciones inactivas y del cambio simultáneo.
- [x] Pruebas de integración añadidas: cambio superadmin, denegación de usuario normal y organización inexistente.
- [x] Pull Request #3 abierta en draft hacia `main`: https://github.com/ALBRA8/CRM-ALBRA/pull/3.
- [ ] Verificar build y TypeScript sobre el head actual de la PR.
- [ ] Ejecutar suite unitaria e integración y confirmar resultados en GitHub Actions.
- [ ] Revisar aislamiento cross-tenant con usuario normal y superadmin, incluyendo manipulación de `organizationId`.
- [ ] Revisar renovación/expiración del token y retorno al panel superadmin.
- [ ] Integrar PR #3 en `main` solo tras CI verde, revisión del diff completo y autorización.
- [ ] Desplegar en staging/producción solo después de integración, pruebas de humo, respaldo y autorización expresa.

**Nota de estado:** los checks marcados [x] documentan cambios de código y publicación en la rama/PR; no certifican build, pruebas aprobadas, merge ni despliegue. La PR agrupa 15 archivos y commits anteriores de la misma rama, por lo que la revisión debe cubrir el diff completo.


## Actualización 2026-11-13 — CI corregido

- [x] Corregir los nueve fallos de la ejecución CI anterior sin quitar validaciones de seguridad.
- [x] Alinear el rol de los JWT de prueba con el rol persistido en BD durante los escenarios owner B; restaurar el rol al terminar cada prueba.
- [x] TypeScript y lint aprobados en el nuevo CI.
- [x] Migraciones Prisma, escáner de secretos y build de producción aprobados.
- [x] Suite completa aprobada: 64/64 archivos y 580/580 pruebas.
- [x] Pruebas de integración del cambio de organización Super Admin incluidas en la suite verde.
- [ ] Hacer prueba visual/manual del botón **Ingresar** en navegador con dos organizaciones en staging.
- [ ] Verificar retorno al panel Super Admin y comportamiento de sesión/expiración en navegador.
- [ ] Repetir pruebas de aislamiento cross-tenant en entorno staging con datos representativos.
- [ ] Integrar PR #3 en `main` solo con autorización expresa.
- [ ] Desplegar solo después de integración, smoke tests, backup y autorización expresa.

**Evidencia:** PR #3, head `040d8875ff9b10b5179313bbc374a5e7795af8ed`; CI run `43379605573` aprobado. Esto no equivale a merge ni despliegue.


## Validación final del selector — 2026-11-13

- [x] Corregir la recarga de sesión `/api/auth/me` para el contexto activo del superadmin sin alterar su organización base.
- [x] Añadir prueba que confirma que el superadmin entra en org B, `/api/auth/me` informa org B y los datos listados pertenecen a org B.
- [x] Confirmar que la organización base del usuario sigue siendo org A.
- [x] CI del head `5c1e73e0c99c488c843d42aff6fe8cef6928bf23` aprobado: 64/64 archivos, 580/580 pruebas, build correcto.
- [ ] Prueba visual/manual del botón **Ingresar** en navegador sobre staging.
- [ ] Verificar regreso al panel Super Admin, recarga de página y expiración/renovación de sesión en navegador.
- [ ] Integrar PR #3 en `main` solo con autorización expresa.
- [ ] Desplegar solo tras integración, pruebas de humo, backup y autorización expresa.


## Actualización 2026-11-13 — multusuario y preparación SaaS

- [x] Corregir el test cross-tenant: org B usa una identidad admin vigente para comprobar que no puede editar ni desactivar miembros de org A.
- [x] Unificar contraseña mínima de invitación en 8 caracteres, igual que el registro.
- [x] Añadir test de contraseña corta, manipulación de organizationId, creación por rol, listado aislado y revocación de JWT al cambiar rol.
- [x] CI run `43384116466` aprobado sobre commit de código `268a124ce8ee2d3a06d33978d3cc31a509efa8a8`: 65/65 archivos y 587/587 pruebas, TypeScript, lint, migraciones, escáner y build.
- [x] Añadir `CONTEXTO CRM/PREPARACION_SAAS.md` con criterios de salida multiusuario, multicuenta, comercial y operación.
- [ ] Completar invitación por enlace de un solo uso y verificación de correo.
- [ ] Diseñar/migrar Instagram, Facebook, Telegram y TikTok desde `Integration` singular a conexiones por cuenta.
- [ ] Ampliar Baileys a múltiples sesiones/cuentas por organización (hoy el registry separa por org).
- [ ] Probar dos cuentas reales del mismo canal dentro de una organización y dos organizaciones en paralelo.
- [ ] Implementar billing/entitlements antes de ofrecer planes de pago.
- [ ] Migrar/ensayar PostgreSQL y validar backups/restauración en staging.
- [ ] Verificación visual del equipo y selector Super Admin en staging.
- [ ] Integrar PR #3 solo con autorización expresa; despliegue y cobros requieren autorización separada.


## Canales canónicos — avance 2026-11-13

- [x] Bandeja canónica encola respuestas con `clientRequestId` e identidad/tenant derivados de sesión.
- [x] Hilo canónico muestra estados `queued`, `sending`, `failed` y `unknown`; pruebas de aislamiento de tenant.
- [x] Worker interno autenticado con secreto dedicado, lote máximo 5 y bandera `CHANNEL_OUTBOUND_DISPATCH_ENABLED`; sin cron ni scheduler.
- [x] Endpoint de conciliación manual `unknown → sent|failed`, requiere confirmación de consulta al proveedor y registra evento de auditoría.
- [ ] Pendiente: aprobar permisos Meta, ventanas de mensajería, observabilidad/runbook, prueba controlada y autorización expresa antes de configurar el secreto/activar el worker.
- [ ] Pendiente: añadir Messenger, Telegram y TikTok al outbox con adaptadores y contratos verificados; actualmente solo WhatsApp Cloud e Instagram son encolables.


## Pruebas de ruta canónica inbox/outbox — 2026-11-13

- [x] Añadir integración de `POST /api/inbox/send`: 202 HTTP queued, ausencia de llamada de red, requestId obligatorio, aislamiento cross-tenant, provider/canal incompatible sin fallback legacy e idempotencia HTTP.
- [ ] Confirmar CI del commit de pruebas `98fee6991df657ad564530e2dd1e0643d639f269` (run `43466211765`, en ejecución al registrar esta nota). Solo marcar aprobado después de revisar conclusión y jobs.
- [ ] Si CI falla, inspeccionar logs y corregir la causa sin retirar las aserciones de seguridad.
- [ ] Mantener worker deshabilitado; no configurar secreto ni habilitar despacho sin aprobación expresa.


## Fencing de leases y cierre operativo — 2026-11-13

- [x] Añadir `claimToken` por reclamación de `ChannelWebhookEvent`; cada recuperación genera token nuevo.
- [x] Completar/fallar el evento con condición atómica `id + status=processing + claimToken`; un propietario vencido no puede cerrar el claim actual.
- [x] Integrar el token en handlers de WhatsApp e Instagram.
- [x] Añadir pruebas de regresión: el claim antiguo no puede completar ni fallar después de la recuperación; solo un reclaimer concurrente gana el lease.
- [x] Añadir migración aditiva 10 para `claimToken`.
- [x] Documentar umbrales de alertas y límites del endpoint de salud en `RUNBOOK_CANALES.md`.
- [x] Exponer `oldestQueuedAgeSeconds` en la salud agregada sin revelar IDs, cuerpos ni tenants; probar el contrato.
- [x] CI completo del HEAD `04db615ea35192aa8998e5ec04ddf88d2e8d0661`: push run `43497893649` y pull_request run `43497905739`, ambos success (secret scan, Prisma migrate clean install, TypeScript, lint ratchet, suite completa y build).
- [ ] Añadir idempotencia/outbox propia para workflows y autorespuestas; fencing no evita repetir un efecto externo ya iniciado por un proceso antiguo.
- [ ] Incorporar antigüedad de la cola queued y series temporales para que el monitor pueda medir backlog y crecimiento sin inferencias.
- [ ] Revisar el diff completo de PR #3 por módulos y ejecutar pruebas manuales de navegador en staging; PR continúa draft.


## Cierre de seguridad de webhooks y automatizaciones — 2026-11-13

- [x] Propagar el ID estable del mensaje Meta (`message.id` WhatsApp / `msg.mid` Instagram) al payload de workflows; la clave única de AutomationRun deduplica el replay por automatización.
- [x] Añadir prueba de integración de reentrega: segundo disparo con el mismo ID devuelve `deduplicated` y conserva un único run.
- [x] Rechazar `hub.mode` distinto de `subscribe` en verificación GET de Instagram; comparación de verify tokens en tiempo constante en Instagram y en el fallback legacy de WhatsApp.
- [x] Añadir opt-in explícito `CHANNEL_AUTOREPLY_ENABLED=true` para auto-respuestas WhatsApp/Instagram.
- [x] Añadir opt-in explícito `WORKFLOW_EXTERNAL_SENDS_ENABLED=true` para acciones externas WhatsApp/Telegram/email de workflows; por defecto registran el intento como pendiente sin contactar al proveedor.
- [x] Auto-respuestas WhatsApp/Instagram persistidas primero en `ChannelOutboundMessage` con clave estable SHA-256 de `message.id`/`msg.mid`; el webhook no llama directamente a Meta.
- [x] Pruebas de integración en ambos webhooks: con opt-in explícito, la respuesta IA se encola con clave estable y estado `queued`, sin despacho directo al proveedor.
- [x] CI del HEAD previo (`51a7775`) aprobó toda la suite y build; la nueva fase outbox necesita CI final propio.
- [~] La idempotencia de workflow impide runs duplicados. El sweeper marca `running` huérfanos como `failed` tras 10 minutos, sin reejecutar acciones de resultado incierto. Las acciones externas de workflows aún no están integradas con la outbox canónica; no certificar exactly-once.
- [ ] Validar las nuevas protecciones con CI del HEAD final.
- [ ] Probar webhooks con sandbox/cuentas de prueba Meta; no se ha hecho desde este entorno.
- [ ] Ejecutar dry-run de backfill y ensayo de reversión en staging con backup restaurable; no se ha hecho desde este entorno.
