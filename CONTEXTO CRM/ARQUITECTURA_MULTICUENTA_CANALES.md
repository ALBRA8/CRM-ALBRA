# Arquitectura de multicuenta de canales

Fecha: 2026-11-13  
Repositorio: `ALBRA8/CRM-ALBRA`  
Rama: `fix/migration-safety-audit`  
Estado: diseño técnico previo a migraciones; **no implementado**.

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
- `@@unique([provider, providerAccountKey])` para impedir reclamar una misma cuenta externa en dos workspaces. La clave debe ser estable, normalizada y namespaced cuando el proveedor lo requiera.
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
- [ ] Confirmar CI completo sobre el HEAD que incluye también las nuevas pruebas.
- [ ] Completar backfill repetible e idempotente con reporte de conflictos.
- [ ] Política explícita para conexiones legacy ambiguas.

### Fase 1 — WhatsApp e Instagram
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

**Actualización 2026-11-13:** Fase 0 está parcialmente implementada en la rama: se añadieron `ChannelConnection`, `ChannelConnectionEvent`, la migración aditiva SQLite y pruebas de esquema. La ejecución CI `43386995186` ya completó correctamente generación Prisma, migraciones SQLite y TypeScript; lint, suite y build seguían en ejecución en la última consulta. La prueba nueva de esquema se añadió después de que esa ejecución comenzara, por lo que necesita CI sobre el HEAD actual.

Esto todavía **no es una funcionalidad de multicuenta operativa**. No hay backfill ni dual-read, no hay endpoints canónicos ni adaptadores de Instagram, y los webhooks/envíos aún usan los modelos/rutas legacy. WhatsApp Cloud sigue usando `WhatsAppConnection`. No hacer merge, despliegue ni activar mensajería real sin autorización expresa.
