# Arquitectura de multicuenta de canales

Fecha: 2026-11-13  
Repositorio: `ALBRA8/CRM-ALBRA`  
Rama: `fix/migration-safety-audit`  
Estado: Fase 0 implementada; Fase 1 en transición expand. Instagram ya tiene selector y webhook resuelto por cuenta canónica; WhatsApp Cloud lee credenciales canónicas y particiona conversaciones nuevas. La bandeja de entrada/envíos e históricos legacy aún no están migrados.

## Objetivo y alcance

El producto debe soportar varias cuentas/conexiones por organización para los cinco canales actuales: WhatsApp, Instagram, Facebook Messenger, Telegram y TikTok. La implementación se prioriza así:

1. **WhatsApp e Instagram**: primera entrega funcional, incluyendo varias cuentas del mismo canal por organización.
2. **Facebook Messenger**: segunda fase sobre el mismo contrato.
3. **Telegram y TikTok**: tercera fase sobre el mismo contrato.

La prioridad ordena la entrega, no reduce el alcance final. No se debe declarar un canal listo por tener únicamente campos de configuración, un endpoint o una pantalla.

## Diagnóstico del esquema actual

- `Organization` tiene una relación opcional singular `integration: Integration?`; `Integration.organizationId` es único.
- `Integration` concentra credenciales y flags de Telegram, Instagram, Facebook, TikTok y WhatsApp Cloud. Esa forma permite esencialmente una configuración por organización.
- `WhatsAppConnection` ya permite varias conexiones WhatsApp Cloud por organización y cifra el access token. Debe conservarse como compatibilidad durante la transición.
- `WhatsAppConversation` tiene unicidad `[organizationId, contactPhone]`. Esto puede mezclar conversaciones del mismo contacto que llegan por dos números/cuentas distintos de una misma organización. La clave debe incorporar la conexión.
- Baileys separa sesiones por organización, pero no representa aún varias cuentas Baileys independientes por organización.
- El datasource Prisma actual es SQLite. La migración debe probarse en SQLite y diseñarse teniendo presente el futuro paso a PostgreSQL.

## Modelo canónico propuesto

Introducir una entidad `ChannelConnection` como identidad canónica de cada cuenta conectada:

- `id`: identificador interno.
- `organizationId`: tenant propietario; obligatorio.
- `channel`: `whatsapp | instagram | facebook | telegram | tiktok`.
- `provider`: adaptador concreto, por ejemplo `meta_cloud`, `meta_messenger`, `instagram_graph`, `telegram_bot`, `tiktok_business`, `baileys`.
- `providerAccountKey`: identificador externo normalizado y no secreto, obligatorio; namespace del proveedor/app cuando el ID no sea global.
- `externalAccountId`: ID externo de página, cuenta, WABA, número, bot u open_id, según canal.
- `displayName`: nombre seguro para UI.
- `status`: `pending | connected | reconnect_required | disconnected | revoked | error`.
- `scopes`: scopes concedidos serializados como JSON.
- `credentialsEnc`: blob completo de credenciales cifrado en reposo con el módulo criptográfico existente; nunca devolverlo ni registrarlo.
- `metadata`: JSON no secreto y allowlisted (p. ej. nombre, avatar, región); nunca tokens.
- `tokenExpiresAt`, `lastVerifiedAt`, `lastErrorAt`, `createdAt`, `updatedAt`.
- `lastErrorCode` / detalle sanitizado para diagnóstico; no guardar respuestas que puedan contener secretos o PII innecesaria.

Índices y restricciones:
- `@@index([organizationId, channel, status])` para listado/operación por tenant.
- `providerAccountKey` tiene unicidad global (`@unique`) para impedir reclamar una misma cuenta externa en dos workspaces. La propia clave incluye el namespace del proveedor/app cuando se requiere (por ejemplo, `meta:instagram:<id>`).
- No asumir que `externalAccountId` por sí solo es globalmente único entre apps/proveedores.
- Si el proveedor permite varias conexiones legítimas al mismo objeto externo bajo distintas apps, definir explícitamente el namespace de `providerAccountKey` y la política de propiedad antes de relajar la restricción.

Entidades auxiliares recomendadas:
- `ChannelOAuthAttempt`: state/nonce hasheado, organizationId, channel/provider, expiración, consumo de un solo uso y metadatos no secretos. PKCE verifier protegido si se persiste. No guardar access tokens aquí.
- `ChannelWebhookEvent`: connectionId, eventId, tipo, estado de procesamiento, intentos, timestamps y payload minimizado/sanitizado. Unicidad `[connectionId, eventId]`; payload crudo solo si existe necesidad justificada, con política de retención.
- `ChannelConnectionEvent`: auditoría de connect, disconnect, token refresh, revoke y errores; nunca secretos.

## Conversaciones y enrutamiento

Toda conversación entrante debe quedar asociada a la conexión exacta que recibió el evento. Para WhatsApp, incorporar `connectionId` a `WhatsAppConversation` (y, si simplifica consultas/validación, a mensajes), y cambiar la unicidad a `[organizationId, connectionId, contactPhone]`. Las conversaciones históricas se asignan a la conexión legada correcta cuando exista evidencia determinista; si no, se mantienen explícitamente como legado/no asignado, sin inventar una asociación.

Los handlers de webhook deben:
1. Validar firma/secret del proveedor antes de procesar el contenido.
2. Resolver conexión por ID externo exacto y proveedor; nunca por coincidencia parcial ni por el tenant indicado en el body.
3. Verificar estado y organización de la conexión resuelta.
4. Registrar/deduplicar por `connectionId + eventId` antes de producir efectos no idempotentes.
5. Procesar de forma idempotente, con reintentos acotados y estado de fallo recuperable.
6. No filtrar la existencia, nombre o credenciales de conexiones de otros tenants en errores/respuestas.

Las rutas de envío reciben `connectionId` explícito, comprueban que pertenece a la organización de la sesión y que el canal/estado son compatibles. No seleccionar silenciosamente “la primera conexión” cuando haya más de una.

## Seguridad OAuth y credenciales

- `state` aleatorio, firmado o ligado a registro de intento en servidor, con caducidad y uso único; protección CSRF.
- PKCE cuando lo soporte el flujo/proveedor.
- Redirect URI exacta en allowlist; validar scopes solicitados y concedidos.
- Tokens cifrados en reposo usando la infraestructura criptográfica actual; claves separadas por entorno, rotables y fuera del repositorio.
- Renovación con exclusión mutua/idempotencia para evitar carreras; actualizar credenciales de forma atómica.
- Desconectar/revocar en proveedor cuando exista API; borrar o invalidar credenciales localmente incluso si la revocación remota falla.
- Logs, trazas, errores HTTP, auditoría y respuestas API nunca contienen access/refresh tokens, app secrets, verify tokens ni códigos OAuth.
- Webhooks Meta validan firma con el secreto correcto; Telegram usa secreto de webhook robusto; TikTok valida el mecanismo oficial disponible para el producto habilitado.
- No habilitar envíos reales hasta verificar permisos, revisión de app y elegibilidad comercial del proveedor.

## Compatibilidad y migración expand/contract

No reemplazar `Integration` ni `WhatsAppConnection` en una sola migración destructiva.

1. **Expand**: añadir `ChannelConnection` y tablas auxiliares, índices y campos nullable necesarios. Mantener modelos/tablas anteriores.
2. Crear adaptadores de lectura que prefieran la conexión canónica y permitan fallback controlado a la configuración legacy.
3. Backfill por organización:
   - WhatsApp Cloud: mapear cada `WhatsAppConnection` a una `ChannelConnection`, conservando IDs y estado. Mantener referencia de origen para reconciliación.
   - Instagram/Facebook/Telegram/TikTok: migrar solo cuando exista identidad externa inequívoca y credenciales descifrables válidas. Preservar cifrado; nunca imprimir secretos en logs.
   - Baileys: modelar cada sesión real como conexión individual solo después de definir y probar el identificador de sesión y el ciclo de vida por cuenta.
4. Comparar conteos, organizaciones, IDs externos, estado y disponibilidad de credenciales mediante hashes/indicadores no reversibles; verificar que ninguna conexión desaparece ni se duplica.
5. **Dual-read controlado**: comparar resultados de legacy y canónico en staging; la fuente canónica debe ganar solo tras reconciliación.
6. Migrar webhooks y envíos por canal, empezando por WhatsApp Cloud y luego Instagram. Añadir métricas para hits legacy, errores de resolución y eventos sin conexión.
7. **Contract**: retirar campos/rutas legacy únicamente en una versión posterior, con evidencia de que no hay lecturas ni escrituras activas y con backup/rollback probado.

La migración no debe copiar secretos a archivos temporales, fixtures, logs o documentación. Un rollback debe poder volver a la lectura legacy sin perder ni sobrescribir credenciales originales.

## Entrega por fases y criterios de aceptación

### Fase 0 — Fundaciones
- [x] Modelo canónico `ChannelConnection` y auditoría `ChannelConnectionEvent` añadidos al esquema Prisma.
- [x] Migración SQLite aditiva `5_channel_connections`; conserva intactas `Integration` y `WhatsAppConnection`.
- [x] Pruebas de esquema añadidas para dos cuentas del mismo canal, unicidad de identidad externa, separación por tenant y registro de auditoría.
- [x] CI completo sobre el HEAD que incluye las pruebas de esquema (TypeScript, lint, suite, migración SQLite y build).
- [ ] Completar backfill repetible e idempotente con reporte de conflictos.
- [ ] Política explícita para conexiones legacy ambiguas.

### Fase 1 — WhatsApp e Instagram

**Avance parcial (2026-11-13):**
- [x] El callback OAuth de Instagram registra la cuenta elegida también en `ChannelConnection` (provider `meta_graph`, canal `instagram`) mediante escritura sombra.
- [x] Las nuevas conexiones WhatsApp Cloud se reflejan en `ChannelConnection` (provider `meta_cloud`); desconexión/revocación sincroniza estado y destruye credenciales canónicas dentro de la misma transacción.
- [x] Credenciales del registro canónico cifradas con AES-256-GCM; metadata limitada a IDs/nombres no secretos.
- [x] La escritura canónica, su evento de auditoría y la actualización legacy `Integration` ocurren en una transacción.
- [x] Se rechaza vincular a otro tenant una cuenta Instagram ya reclamada en el inventario canónico.
- [x] El callback registra todas las páginas devueltas por Meta que tengan Instagram Business vinculado; mantiene la primera como selección legacy provisional.
- [x] Se añadió `GET /api/instagram/connections` (listado por tenant sin secretos) y `POST /api/instagram/connections` (selección validada por `connectionId`, solo dentro de la organización autenticada).
- [x] La pantalla de ajustes consume el listado y el endpoint de selección; muestra las cuentas y conserva la selección activa.
- [x] El webhook de Instagram resuelve por `entry[].id` contra `ChannelConnection`, valida la firma con el secreto cifrado de esa cuenta y utiliza el token de esa misma conexión para la respuesta automática. Mantiene fallback legacy para cuentas sin registro canónico.
- [x] Se añadió `ChannelConversation`, con unicidad `[connectionId, externalContactKey]`, para separar conversaciones nuevas sin tocar históricos legacy.
- [x] Se añadió `src/lib/channel-conversations.ts`: resuelve por `providerAccountKey` exacta y rechaza canal/estado incompatibles; crea conversación dentro de la conexión resuelta.
- [x] Se añadió migración aditiva `6_channel_conversations` y pruebas de aislamiento para el mismo contacto en dos conexiones.
- [x] Se añadió `ChannelMessage` y la migración aditiva `7_channel_messages`; los mensajes pertenecen a una conversación concreta y su unicidad por `[conversationId, externalMessageId]` permite IDs externos iguales en cuentas distintas.
- [x] Webhooks de Instagram y WhatsApp Cloud escriben mensajes entrantes en `ChannelMessage` y actualizan `ChannelConversation`, sin eliminar las escrituras legacy de timeline/mensajes.
- [x] Webhook de WhatsApp Cloud prefiere credenciales de `ChannelConnection` tras atribuir la cuenta exacta por `phone_number_id` en `WhatsAppConnection`; mantiene fallback legacy cuando no existe el registro canónico.
- [ ] Adaptar listados de bandeja, historial, lecturas y rutas de envío para que consuman `ChannelConversation`/`ChannelMessage` de extremo a extremo.
- [ ] Añadir persistencia canónica de mensajes salientes y deduplicación transaccional/recuperable de eventos de webhook.
- [ ] La integración de webhooks/selector y el nuevo modelo de mensajes requieren CI completo sobre el HEAD más reciente.

- Varias conexiones del mismo canal por organización.
- Crear, listar, verificar, reconectar, desconectar y revocar por connectionId.
- Dos organizaciones aisladas y al menos dos cuentas del mismo canal en una organización.
- Webhook resuelve exactamente la cuenta que recibió el evento.
- Conversaciones separadas por conexión; mensajes entrantes y salientes usan la conexión seleccionada.
- Renovación/reconexión y fallo de credenciales no afectan las otras cuentas.
- Pruebas automatizadas con fixtures firmados y sandbox/proveedor real antes de habilitar producción.
- Para Baileys: auth-state y daemon/session manager por conexión, no solo por organización.

### Fase 2 — Facebook Messenger
- Adaptador Meta Page/Messenger sobre la entidad común.
- Varias páginas por organización, selección de página y resolución exacta de webhook.
- Compartir Meta App solo donde el flujo y los permisos lo permitan; credenciales por conexión.

### Fase 3 — Telegram y TikTok
- Varios bots Telegram por organización, secret de webhook y rotación.
- Varias cuentas TikTok donde Business Messaging/API y permisos aprobados lo permitan.
- Documentar limitaciones de API/revisión de proveedor; no presentar funciones no aprobadas como activas.

## Matriz mínima de pruebas

- Cuenta A1 y A2 del mismo canal dentro de organización A.
- Cuenta B1 del mismo canal dentro de organización B.
- A1 y A2 reciben eventos del mismo contacto y generan conversaciones distintas.
- Evento duplicado no duplica mensajes, clientes ni automatizaciones.
- Webhook con firma inválida, cuenta desconocida o conexión revocada se rechaza.
- Usuario de A no puede listar, leer, modificar, enviar ni desconectar conexiones de B.
- Token expirado solicita reconexión sin afectar otras conexiones.
- Dos refresh simultáneos no pierden una credencial más nueva.
- Backfill ejecutado dos veces no duplica conexiones.
- Rollback de lectura legacy mantiene operativas las integraciones previas.
- Ninguna respuesta API/log/trace incluye credenciales o secretos.

## Estado de implementación

**Actualización 2026-11-13:** Fase 0 y parte de la fase 1 están implementadas en la rama. Se añadieron `ChannelConnection`, `ChannelConnectionEvent`, `ChannelConversation` y `ChannelMessage`, con migraciones SQLite aditivas 5, 6 y 7. Instagram dispone de selector multicuenta; los webhooks de Instagram y WhatsApp Cloud resuelven cuentas por identificador externo exacto y escriben mensajes entrantes en la estructura canónica, manteniendo las escrituras legacy durante la transición. El webhook WhatsApp procesa múltiples números por POST y aísla fallos de configuración por destino para no abortar otros destinos válidos.

La CI `43395332553` validó correctamente schema, migraciones, TypeScript, lint, suite y build para el modelo `ChannelMessage` antes de la última incorporación de escrituras canónicas en los webhooks. La CI `43395622374` terminó con éxito para el commit `402c585d` (migraciones SQLite, TypeScript, lint, suite y build). La CI documental `43395971244` también terminó con éxito para `4b1ba773`.

Esto todavía **no es una funcionalidad de multicuenta operativa de extremo a extremo**. No hay backfill ni dual-read; la bandeja, el historial, la lectura y los envíos siguen consumiendo principalmente las estructuras legacy. La persistencia canónica de mensajes salientes y una deduplicación recuperable de eventos siguen pendientes. No hacer merge, despliegue ni activar mensajería real sin autorización expresa.


---

## Instrucciones operativas para agentes (lectura obligatoria antes de tocar código)

Esta sección es normativa para cualquier agente, desarrollador o automatización que continúe este trabajo. Si otra nota, issue o comentario contradice estas reglas, detenerse y aclarar antes de ejecutar cambios destructivos.

### Fuente de verdad y alcance

- Trabajar en `fix/migration-safety-audit`, PR #3, salvo instrucción expresa distinta. No asumir que el PR title describe todo el contenido actual: inspeccionar siempre el diff y el HEAD.
- La arquitectura objetivo es multicuenta para WhatsApp, Instagram, Facebook Messenger, Telegram y TikTok. Prioridad de entrega: WhatsApp e Instagram; después Messenger; finalmente Telegram y TikTok.
- `ChannelConnection` es la identidad canónica de la cuenta; `ChannelConversation` la conversación por conexión; `ChannelMessage` sus mensajes. Legacy (`Integration`, `WhatsAppConnection`, `WhatsAppConversation`, `WhatsAppMessage`, `TimelineEvent`) permanece durante expand/contract.
- Nunca declarar "multicuenta completa" mientras inbox, historial, lectura, envío, webhooks, backfill, deduplicación y pruebas no estén migrados y validados.

### Reglas de seguridad que no se negocian

1. **Tenant isolation en cada query y mutación**: derivar `organizationId` de la sesión autenticada; no confiar en tenant, connectionId, canal ni accountId enviados por el cliente sin validar pertenencia.
2. **Conexión exacta**: cada lectura/envío debe resolver una conversación canónica por su ID y validar `conversation.organizationId === auth.orgId`; la conexión relacionada debe coincidir con canal y estar `connected`. No elegir la primera conexión ni leer tokens de `Integration` para una conversación canónica.
3. **Credenciales**: descifrar únicamente las credenciales de la conexión ya validada. Nunca devolver, registrar, copiar a fixtures/docs ni incluir secretos en errores. Metadata solo allowlisted y no secreta.
4. **Fail closed**: conexión ausente, ajena, revocada, desconectada, canal incompatible o credencial inválida => no enviar ni exponer datos. No usar fallback legacy para una key canónica inválida.
5. **No mezclar conversaciones**: misma persona/contacto en dos conexiones distintas debe producir conversaciones distintas. La identidad de inbox debe incluir el ID canónico de conversación, no solo clientId o handle.
6. **Sin acciones externas accidentales**: tests con mocks/stubs; no enviar mensajes reales ni activar automatizaciones/cobros. No merge ni deploy sin autorización expresa.
7. **No borrar/alterar legacy**: conservar dual-read/escrituras existentes hasta tener migración, reconciliación, rollback y evidencia. No cambiar unicidades legacy de forma destructiva ni asignar históricos ambiguos a una conexión por conjetura.
8. **Idempotencia**: no confundir upsert de mensaje con idempotencia de todo el webhook. Los eventos deben tener estado/reintento recuperable y los efectos secundarios no deben duplicarse ante retry.

### Estado real de la bandeja (auditoría de código)

A fecha 2026-11-13, inspección de `src/lib/inbox.ts`, `src/app/api/inbox/route.ts` y `src/app/api/inbox/send/route.ts`:

- `listInbox` agrega WhatsApp legacy (`WhatsAppConversation`) y Telegram/Instagram/Facebook agrupados por `TimelineEvent`; no consulta `ChannelConversation`.
- Las keys actuales son `wa:<WhatsAppConversation.id>`, `tg:<clientId>`, `ig:<clientId>`, `fb:<clientId>`. Agrupar por clientId mezcla potencialmente cuentas/canales distintos y no identifica una conexión concreta.
- `getInboxMessages` lee `WhatsAppMessage` o `TimelineEvent`; no lee `ChannelMessage`.
- `markInboxRead` actualiza `WhatsAppConversation` o metadatos de `TimelineEvent`; no actualiza `ChannelConversation.unreadCount`.
- `sendInboxMessage` usa daemon Baileys para WhatsApp y `Integration` para Telegram/Instagram/Facebook; no resuelve `ChannelConversation`/ `ChannelConnection`, no elige token por conexión y no persiste mensajes salientes en `ChannelMessage`.
- `POST /api/inbox/send` recibe `key`, `contactHandle`, `clientId`, `text`; valida clientId contra el tenant, pero el contrato actual no contiene `connectionId` explícito.
- El API GET marca como leída al solicitar mensajes (actualmente en paralelo con la lectura); conservar o cambiar esa semántica conscientemente, sin pérdida de unread en fallos.
- `listClientChannels` también produce keys/handles legacy para WhatsApp y timeline. Debe revisarse para no seguir ofreciendo opciones ambiguas a los flujos de envío desde ficha/IA de cierre.

### Contrato recomendado para migrar inbox

- Introducir una key inequívoca, por ejemplo `cc:<ChannelConversation.id>`, validada estrictamente. No interpretar IDs canónicos como keys legacy ni viceversa.
- Listar conversaciones canónicas por `organizationId`, incluir datos mínimos de conexión (canal/displayName) y ordenar por actividad. Si se muestran simultáneamente legacy y canónicas, evitar duplicados mediante una regla explícita; no fusionar por teléfono/handle sin prueba de identidad.
- Para hilo, consultar `ChannelMessage` solo mediante una `ChannelConversation` encontrada por `id + organizationId`. Ordenar cronológicamente para UI y limitar paginación.
- Para lectura, actualizar `ChannelConversation.unreadCount` con filtro tenant-scoped; evitar mutación antes de validar conversación.
- Para envío, el servidor debe obtener el handle externo y credenciales desde la conversación y su conexión validadas. No confiar en `contactHandle` ni `channel` del cliente como autoridad. El adaptador se selecciona por `connection.provider/channel`; validar status y credenciales justo antes del envío.
- Tras respuesta exitosa del proveedor, guardar `ChannelMessage(direction="out")` y actualizar `lastMessage`, `lastMessageAt`, `lastMessageFrom` de forma coherente. Usar ID externo del proveedor si está disponible. Si falla persistencia después de que el proveedor aceptó el mensaje, diseñar recuperación para no reenviar a ciegas.
- No afirmar soporte de un adaptador por reutilizar un sender legacy que toma `Integration`. Si un proveedor no tiene adaptador canónico probado, rechazar envío canónico de forma segura.
- Las opciones legacy (`wa-new:<phone>`, timeline por clientId) no contienen conexión exacta: mantenerlas separadas como compatibilidad, no convertirlas silenciosamente en `cc:`. La ruta canónica debe ser explícita.
- La UI debe mostrar canal y cuenta/conexión cuando existan varias; los IDs internos pueden estar en key, nunca tokens.

### Orden de trabajo y pruebas obligatorias

1. Confirmar CI del HEAD actual y registrar SHA exacto; no extrapolar CI de un commit padre.
2. Documentar cambios y reglas aquí antes de modificar código sustantivo.
3. Añadir parser y tests unitarios de key canónica; probar key malformada.
4. Migrar lectura/listado canónico con aislamiento tenant; pruebas para mismo contacto en dos conexiones y dos tenants.
5. Migrar lectura de mensajes y marcar leído; probar conversación ajena/no existente, orden y unread.
6. Implementar envío por adaptador canónico WhatsApp Cloud e Instagram primero; pruebas mockeadas que aseguren que token/endpoint corresponden a la conexión exacta. No usar daemon Baileys para WhatsApp Cloud salvo que el provider de esa conexión sea Baileys.
7. Persistir salientes y probar fallo proveedor, duplicados y recuperación; después integrar UI y `listClientChannels`.
8. Añadir Facebook, Telegram y TikTok solo con adaptadores oficiales/permisos validados, respetando prioridad y limitaciones.
9. Ejecutar CI completa (migraciones SQLite limpias, TypeScript, lint, suite y build) sobre el nuevo HEAD. Actualizar este documento con SHA/run y limitaciones reales.
10. Mantener PR en draft y sin merge/deploy hasta autorización.

### CI y estado del PR verificados

- PR #3: abierta, draft, no mergeada; HEAD verificado al documentar: `4b1ba77316fbafdae0a21b00d3109c13018f2bdf`.
- Run `43395622374` (commit de código `402c585d`): job CI completado con éxito; incluye instalación, escáner de secretos, Prisma, migraciones SQLite limpias, TypeScript, lint, tests y build.
- Run `43395971244` (HEAD documental `4b1ba773`): job CI completado con éxito en los mismos pasos.
- Estas ejecuciones validan sus respectivos commits; cualquier cambio posterior requiere CI nuevo sobre el HEAD actualizado.


## Avance posterior: bandeja canónica (2026-11-13)

**Código añadido en la rama; validación del HEAD final pendiente:**

- [x] La key canónica de inbox usa el prefijo `cc:<ChannelConversation.id>`; no se confunde con las keys legacy `wa:`, `ig:`, `tg:`, `fb:` ni `wa-new:`.
- [x] `listInbox` incorpora `ChannelConversation` con filtro por `organizationId`, solo conexiones activas/compatibles y etiqueta de cuenta (`displayName`). Las fuentes legacy siguen disponibles durante expand; no se fusionan por handle ni por nombre.
- [x] `getInboxMessages` consulta `ChannelMessage` solo tras resolver conversación por `id + organizationId` y validar conexión activa y canal coincidente.
- [x] `markInboxRead` valida tenant, conexión activa y canal antes de poner `unreadCount=0`.
- [x] La UI muestra el nombre de la cuenta conectada en lista e hilo para distinguir dos cuentas del mismo canal.
- [x] Envío de keys `cc:` bloqueado explícitamente en servidor y UI. Nunca hace fallback a Baileys ni a `Integration`; no se ha activado mensajería real.
- [x] Pruebas `tests/integration/channel-inbox.test.ts`: separación de dos cuentas del mismo contacto, aislamiento entre tenants, lectura de mensajes y marca de leído.
- [ ] Envío canónico saliente pendiente: requiere contrato de adaptadores por provider, persistencia/outbox y recuperación de resultado incierto antes de habilitar llamadas reales. No implementar un simple "enviar y luego insertar" que pueda duplicar mensajes tras timeout.
- [ ] Revisar `listClientChannels` y los flujos de IA de cierre para exponer conversaciones canónicas sin ofrecer handles legacy ambiguos.

**Commits de código relevantes:** `940bcb7e` (lectura/listado canónico), `058adb42` (pruebas), `266574a3` (bloqueo de envío canónico y UI), `3ea0ea16` (dirección del último mensaje), `22a74fb7` (validación de canal en lectura), `0833e679` (nombre de cuenta en lista), `ae7d4cea` (validación de canal al marcar leído). HEAD de código al momento de esta nota: `ae7d4cea5e0313777c5a896ade7ce78bc3b38622`.

**CI observado:**
- Run `43396997198`, commit `266574a3`: escáner, Prisma, migraciones SQLite, TypeScript, lint, suite y build completados con éxito; job en cierre de pasos post-run.
- Run `43397181657`, commit `0833e679`: migraciones y TypeScript completados; lint en curso en la última consulta.
- Run `43397305922`, commit `ae7d4cea`: CI en curso; aún no se declara validado el HEAD.
- Los runs se disparan tanto por push como por sincronización del PR. La aceptación debe basarse en el run del HEAD exacto, no en un commit padre.


## Outbox saliente: contrato de seguridad (2026-11-13)

Se añadió la base persistente de outbox para impedir que un timeout provoque reenvíos a ciegas:

- Modelo `ChannelOutboundMessage`, migración `8_channel_outbound_messages` y vínculo opcional `ChannelMessage.outboundId`.
- Servicio `src/lib/channel-outbox.ts`: crea intención antes de red, usa `clientRequestId` único por conversación, valida tenant/conversación/conexión, y hace claim atómico `queued → sending`.
- Confirmación 2xx se persiste en una transacción: mensaje saliente, estado `sent`, ID externo y preview de conversación.
- Rechazo explícito del proveedor puede quedar `failed`; timeout o worker interrumpido pasa a `unknown`.
- `unknown` es terminal y **no se reintenta automáticamente**. Debe reconciliarse con el proveedor antes de cualquier reenvío. Esto evita duplicar a costa de requerir resolución manual cuando el resultado es ambiguo.
- La idempotencia de la solicitud solo se garantiza dentro de la misma conversación y para el mismo `clientRequestId`; reutilizar la clave con otro cuerpo da conflicto.
- Tests en `tests/integration/channel-outbox.test.ts` cubren idempotencia, claim concurrente, confirmación atómica, cuarentena y aislamiento de tenant.

**Límite explícito:** la existencia de outbox, dispatcher y adaptadores NO significa que el envío esté activado. La bandeja canónica ahora puede crear intenciones idempotentes, pero el worker está protegido por secreto dedicado y por la bandera `CHANNEL_OUTBOUND_DISPATCH_ENABLED=true`, que permanece sin habilitar. No existe scheduler registrado. Los envíos legacy continúan separados; nunca se usa fallback legacy para una key `cc:`.

**Hallazgo corregido:** el parser devuelve `channel: null` para keys `cc:`; el canal canónico se deriva de `ChannelConversation` y su conexión. No inferir WhatsApp para todas las conversaciones canónicas.

## Dispatcher y salida canónica (2026-11-13)

Antes de conectar proveedores se implementará un dispatcher aislado con adaptadores inyectables:

- El dispatcher solo procesa una intención ya persistida y reclamada atómicamente; no crea intenciones ni acepta IDs de conexión del cliente.
- Relee la conversación y conexión desde la relación de la intención, valida organización, estado, canal y provider exactos, y solo después descifra credenciales.
- La clave del adaptador es la pareja provider/canal; nunca se infiere proveedor solo por el canal.
- Los adaptadores reciben únicamente el destinatario canónico, cuerpo y credenciales de esa conexión. En tests se inyectan adaptadores simulados.
- Excepciones/timeout se consideran resultado incierto y pasan a `unknown`; solo un rechazo inequívoco se marca `failed`; una respuesta aceptada se confirma con `markChannelOutboundSent`.
- No hay endpoint público ni cron. El worker interno está autenticado y feature-gated; los adaptadores Meta solo se registran desde ese worker. La activación sigue pendiente de aprobación específica.
- No se promete exactly-once: sin idempotencia del proveedor, el estado `unknown` requiere conciliación manual.

### Implementación del dispatcher (validada por CI)

- Se añadió `src/lib/channel-outbound-dispatcher.ts`: reclama una intención existente, vuelve a leer conversación/conexión y comprueba tenant, estado, canal y provider antes de descifrar el blob de credenciales.
- El adaptador se inyecta por clave exacta `<provider>:<channel>`; el módulo no incluye cliente HTTP ni adaptadores reales. El destinatario sale de `ChannelConversation.externalContactKey`, no del body del navegador.
- Los errores lanzados/ambiguos quedan `unknown`; los rechazos definitivos y las configuraciones inválidas quedan `failed`; una aceptación confirmada persiste el mensaje y estado en la transacción de outbox.
- Se añadieron pruebas con adaptadores simulados para éxito, timeout sin reintento y ausencia de adaptador. También hay pruebas unitarias de los adaptadores Meta con fetch simulado.
- El endpoint worker interno ya existe, pero permanece deshabilitado por bandera y secreto operativo no configurado. El inbox canónico solo encola; no realiza envío al proveedor.

### Adaptadores Meta de texto (sin activar)

- Se añadió `src/lib/meta-channel-adapters.ts` con adaptadores separados `meta_cloud:whatsapp` y `meta_graph:instagram`, seleccionados por la pareja exacta provider/canal.
- WhatsApp usa el phone-number ID de la conexión en `/{phone-number-id}/messages`; Instagram usa el ID de cuenta profesional de la conexión y el IGSID del contacto. Los tokens viajan solo en Authorization, nunca en query strings ni logs.
- Los 4xx inequívocos se clasifican como rechazo definitivo; 429/5xx se consideran ambiguos y quedan en cuarentena. Las excepciones de red también se convierten en `unknown` en el dispatcher.
- Los adaptadores nuevos usan `META_CHANNELS_GRAPH_VERSION` (formato validado) y, si no se define, Graph API `v27.0`; no modifican el `GRAPH_VERSION` legacy del resto de integraciones.
- Pruebas unitarias mockean fetch para comprobar endpoint/cuerpo, ID externo, token en header y clasificación 4xx/5xx. No se hace ninguna petición real.
- Referencias oficiales: [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) y [Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging). Revisar permisos/App Review y ventanas de respuesta antes de activar en producción.

- Los adaptadores nuevos usan `META_CHANNELS_GRAPH_VERSION` (formato validado) y, si no se define, Graph API `v27.0`; no modifican el `GRAPH_VERSION` legacy del resto de integraciones.


**Validación CI del dispatcher y adaptadores Meta:**
- HEAD validado: `3ebb15df4b589734df65b404a9fe2b527e2d4057`.
- Run `43433127349`: escáner de secretos, Prisma, migraciones SQLite limpias, TypeScript, lint, 71 archivos de tests (611 tests) y build completados con éxito.
- Esta validación no activa envíos ni añade worker/endpoint. Los adaptadores Meta están implementados y probados con fetch simulado; el inbox canónico permanece bloqueado hasta revisión de permisos, ventana de mensajería, política de reintentos y activación autorizada.


### Inbox → outbox, worker protegido y conciliación (en validación CI)

- `POST /api/inbox/send` reconoce `cc:<conversationId>` y crea una intención de outbox con organización/usuario de la sesión y `clientRequestId` obligatorio. Responde HTTP 202 `queued`; no llama al proveedor ni a `sendInboxMessage` legacy.
- El cliente usa un ID de idempotencia estable durante el reintento de la misma solicitud y muestra los estados `queued`, `sending`, `failed` y `unknown` en el hilo canónico. El texto de UI aclara que `queued` no significa entregado.
- `getInboxMessages` incorpora intenciones aún no confirmadas al hilo canónico, manteniendo el aislamiento por organización y la validación de conexión activa.
- Se añadió `POST /api/internal/channel-outbox`: requiere `CHANNEL_OUTBOX_WORKER_SECRET` de al menos 32 caracteres, comparación constante y `CHANNEL_OUTBOUND_DISPATCH_ENABLED=true`. Procesa lotes máximos de 5 con adaptadores Meta; sin ambos controles responde 401/503. No se registró cron, scheduler ni ejecución automática.
- Se añadió `POST /api/internal/channel-outbox/reconcile` con el mismo secreto. Exige `providerChecked=true` y resolución explícita `sent|failed`; la conciliación de `unknown` crea mensaje/actualiza preview o marca fallo y genera `ChannelConnectionEvent` de auditoría. Nunca reencola.
- Las pruebas de integración verifican que los mensajes en cola aparecen solo en el tenant propietario y que la conciliación manual es terminal y auditable.
- No habilitar la bandera de despacho ni configurar el secreto operativo hasta aprobar permisos Meta, ventanas de mensajería, límites, monitorización, runbook y una prueba controlada autorizada.


**CI de integración inbox/outbox:** commit `7dba61f4227d94d16963274da7ead4eaa3243cf2`, run `43436167818`: 71 archivos y 615 pruebas aprobadas; escáner de secretos, migraciones limpias, TypeScript, lint y build aprobados. El cambio posterior de guardia de teclado requiere CI propio antes de considerarse validado.
