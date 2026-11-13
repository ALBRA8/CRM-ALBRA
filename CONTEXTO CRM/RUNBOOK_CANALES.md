# Runbook operativo — WhatsApp Cloud e Instagram

Fecha: 2026-11-13  
Rama de implementación: `fix/migration-safety-audit`  
Estado: guía de staging; **no autoriza activar envíos ni desplegar**.

## 1. Estado seguro por defecto

- `CHANNEL_OUTBOUND_DISPATCH_ENABLED` debe permanecer ausente o distinto de `true`.
- `CHANNEL_AUTOREPLY_ENABLED` debe permanecer ausente o distinto de `true`; los webhooks no deben responder automáticamente por defecto.
- `WORKFLOW_EXTERNAL_SENDS_ENABLED` debe permanecer ausente o distinto de `true`; las acciones de workflow que envían WhatsApp/Telegram/email quedan en estado pendiente auditable sin llamar al proveedor.
- `WHATSPOWER_ENABLED` debe permanecer ausente o distinto de `true`; el bridge inbound puede activar automatizaciones remotas, por lo que también se mantiene apagado durante pruebas de recepción.
- `CHANNEL_OUTBOX_WORKER_SECRET` no debe configurarse en entornos que no vayan a ejecutar el worker.
- No hay cron/scheduler registrado por el repositorio; el endpoint POST no se ejecuta solo.
- `POST /api/inbox/send` en conversaciones canónicas crea una intención `queued`; HTTP 202 no significa que Meta haya recibido el mensaje.
- `unknown` significa resultado ambiguo. No volver a encolar ni reenviar hasta comprobar el estado en el proveedor.
- El envío legacy de las integraciones existentes sigue separado durante la migración expand/contract.

## 2. Comprobaciones previas a cualquier prueba en staging

1. Confirmar que el entorno y la base de datos son staging, no producción.
2. Crear y verificar backup restaurable antes de aplicar migraciones.
3. Aplicar migraciones Prisma en staging y comprobar que `ChannelWebhookEvent` y las tablas canónicas existen.
4. Ejecutar `bun run scripts/backfill-channel-connections.ts` en modo dry-run y revisar conteos/conflictos. El script no escribe por defecto.
5. Aplicar backfill solo tras backup restaurable y aprobación explícita, usando ambos guardas: `BACKFILL_CHANNEL_CONNECTIONS_CONFIRM=1` y `--apply`. Si `NODE_ENV=production`, además exige `BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION=1`. Nunca ejecutar automáticamente ni en producción sin revisión.
6. Confirmar que cada `ChannelConnection` pertenece a la organización correcta, usa el proveedor/canal esperado y está `connected`.
7. Verificar en Meta que la app, permisos, número/cuenta, webhook URL, suscripción a campos y política de ventana/plantillas están aprobados.
8. Confirmar firma HMAC válida con el App Secret de la conexión y probar una firma inválida (debe devolver 401).
9. Usar contactos de prueba consentidos y mensajes no sensibles. No importar datos de clientes reales en fixtures.

## 3. Salud agregada del outbox y webhooks

El endpoint interno de solo lectura es:

`GET /api/internal/channel-outbox`

Requiere `Authorization: Bearer <CHANNEL_OUTBOX_WORKER_SECRET>` con secreto de al menos 32 caracteres. Devuelve únicamente contadores globales y timestamp; no expone IDs, cuerpos, tenants ni credenciales.

Campos:
- `outbox.queued`: intenciones esperando worker.
- `outbox.oldestQueuedAgeSeconds`: edad en segundos de la intención queued más antigua; cero cuando no hay cola.
- `outbox.sending`: llamadas en curso.
- `outbox.staleSending`: `sending` con más de cinco minutos.
- `outbox.unknown`: resultado ambiguo que exige conciliación humana.
- `outbox.failed`: fallos definitivos o no enviables.
- `webhookEvents.processing`, `failed`, `staleProcessing`: eventos en proceso, fallidos o con lease vencido.
- `workerEnabled`: valor efectivo del feature flag de outbox.
- `autoReplyEnabled`: estado efectivo de `CHANNEL_AUTOREPLY_ENABLED`.
- `workflowExternalSendsEnabled`: estado efectivo de `WORKFLOW_EXTERNAL_SENDS_ENABLED`.
- `whatspowerBridgeEnabled`: estado efectivo de `WHATSPOWER_ENABLED`.
- `connectedMetaConnections`: conexiones WhatsApp/Instagram canónicas conectadas.

No se ha configurado un sistema de alertas en este repositorio; los umbrales siguientes son criterios operativos para el monitor externo, no alertas ya desplegadas.

| Señal | Umbral | Severidad y acción |
|---|---:|---|
| `outbox.staleSending` | `> 0` durante 5 min | Crítica: pausar worker, inspeccionar intento y reconciliar; no reenviar a ciegas |
| `outbox.unknown` | `> 0` | Alta inmediata: conciliación humana con el proveedor; prohibido reencolar automáticamente |
| `webhookEvents.staleProcessing` | `> 0` durante 2 sondeos (intervalo sugerido 1 min) | Alta: revisar crash/lease; el lease base es 5 min |
| `webhookEvents.failed` | `> 0` | Alta: revisar código sanitizado y reintentos del proveedor |
| `outbox.queued` | edad del más antiguo `> 10 min` o crecimiento 3 sondeos | Media: comprobar worker apagado/cola acumulada |
| `connectedMetaConnections` | cae inesperadamente | Media: verificar revocación/token/estado con operador |

Sondear cada minuto en staging y cada 1–2 minutos en producción cuando exista aprobación para operar. Mantener ventana de evaluación de 5 minutos para señales de edad; `unknown` y fallos no se silencian por ser pocos. El endpoint entrega el contador y la edad de la intención queued más antigua. El monitor debe conservar snapshots para medir crecimiento sostenido; no se exponen IDs ni marcas temporales por mensaje. No alertar por `queued > 0` aislado: el worker está intencionalmente apagado en el estado actual.

La reclamación usa un `claimToken` de fencing. Completar/fallar solo actualiza el evento si conserva el token vigente; un handler antiguo no puede cerrar el claim de quien recuperó el lease. Esto protege el estado del ledger, pero no cancela un efecto externo que el handler antiguo ya hubiera iniciado.

## 4. Prueba controlada de recepción

Para cada conexión y cuenta:
1. Enviar un mensaje entrante desde un contacto de prueba.
2. Verificar que la conversación se crea bajo la conexión exacta y no aparece en otra cuenta/tenant.
3. Repetir el mismo POST firmado para verificar que el ledger evita procesarlo dos veces.
4. Probar dos eventos/cuentas dentro del mismo batch; un destino inválido no debe impedir procesar destinos válidos.
5. Verificar que firma ausente/inválida, conexión desconectada y cuenta desconocida no producen efectos.
6. Revisar el hilo canónico, TimelineEvent y el estado de `ChannelWebhookEvent`; no registrar ni exportar payloads crudos.

La prueba de batch debe usar fixtures firmados generados con secretos sintéticos. No copiar secretos reales a tests, logs o documentación.

## 5. Prueba de salida (solo después de autorización separada)

No ejecutar esta sección hasta aprobación expresa del propietario y revisión de permisos/ventanas de Meta.

1. Mantener el lote en 1 y un solo destinatario de prueba.
2. Confirmar backup, conexión, credenciales y teléfono/IGSID correctos.
3. Verificar primero `GET /api/internal/channel-outbox`.
4. Habilitar el worker solo en staging mediante el feature flag y secreto dedicado.
5. Ejecutar una única llamada POST autorizada al worker con `limit: 1`.
6. Confirmar el ID devuelto por Meta y el status callback:
   - WhatsApp incluye `biz_opaque_callback_data` para correlacionar la intención aunque el callback llegue antes del ACK.
   - El hilo debe evolucionar `queued → sending → sent → delivered → read` cuando el proveedor notifique esos estados.
   - Instagram echo debe quedar en la conversación de la cuenta exacta y enlazarse a la intención por el `mid`.
7. Verificar que un timeout pasa a `unknown` y no se reintenta automáticamente.

## 6. Conciliación manual de unknown

1. Buscar la intención por su identificador interno en el panel/registro autorizado, sin copiar tokens.
2. Consultar el estado del mensaje directamente en Meta usando la cuenta exacta.
3. Si Meta confirma que fue aceptado/enviado, llamar al endpoint interno de conciliación con `providerChecked: true`, `resolution: "sent"` y el ID del proveedor.
4. Si Meta confirma que no fue enviado, usar `resolution: "failed"`.
5. Si el proveedor no puede confirmar, mantener `unknown`; no adivinar ni reenviar.
6. Confirmar el evento de auditoría `outbound_manually_reconciled_sent|failed`.

La conciliación no hace llamadas de red ni vuelve a poner en cola.

## 7. Incidente y rollback

- Detener el scheduler externo (si se hubiera configurado fuera del repositorio) y cambiar `CHANNEL_OUTBOUND_DISPATCH_ENABLED` a `false`.
- No borrar intenciones `unknown`, mensajes ni eventos para “limpiar” la cola.
- Conservar IDs de correlación y códigos sanitizados; no adjuntar tokens, payloads crudos ni PII.
- Investigar conexión exacta, estado de webhook, proveedor y eventos de auditoría.
- Revertir solo mediante un commit correctivo/rollback revisado; no ejecutar migraciones destructivas ni restaurar backup sin validar el impacto.
- Mantener compatibilidad legacy hasta reconciliar conteos y rutas de lectura/escritura.

## 8. Limitaciones conocidas

- La tabla de eventos evita claims concurrentes y permite recuperar fallos/leases vencidos. El token de fencing impide que un propietario antiguo marque como completado/fallido un claim posterior; no evita por sí solo que un proceso antiguo continúe un efecto externo que ya inició. Un crash después de un efecto externo y antes de marcar `processed` puede repetir ese efecto en una recuperación. Workflows requieren idempotencia/outbox propia; las auto-respuestas de WhatsApp e Instagram ya usan la outbox canónica.
- Los webhooks propagan `message.id`/`msg.mid` al motor de workflows; la clave única `(automationId, idempotencyKey)` deduplica reentregas del mismo mensaje por automatización.
- Los envíos externos de workflows y las auto-respuestas tienen opt-in explícito separado. No habilitar estas variables durante pruebas de recepción.
- Las auto-respuestas WhatsApp/Instagram ahora persisten primero en `ChannelOutboundMessage` con clave derivada del ID del proveedor; el webhook no llama directamente a Meta. El worker de outbox sigue apagado por defecto y los reintentos se protegen por clave idempotente.
- No hay garantía exactly-once de extremo a extremo. La deduplicación de workflows evita crear un segundo run, pero no recupera automáticamente una acción que haya quedado `running` tras un crash a mitad de ejecución; las acciones externas de workflow no están integradas todavía con la outbox canónica.
- No se han validado todavía cuentas reales/sandbox de Meta. Las pruebas de integración usan payloads firmados con secretos sintéticos y cubren ambos canales, outbox y aislamiento; la validación de sandbox sigue pendiente.
- No hay scheduler, alertas, dashboard de conciliación ni SLO/RPO/RTO aprobados.

### Reversión segura de esta fase

1. Deshabilitar `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_EXTERNAL_SENDS_ENABLED` y `WHATSPOWER_ENABLED`; detener cualquier scheduler externo.
2. No borrar ni reencolar registros `unknown`, `sending` o `queued`; exportar únicamente IDs/códigos sanitizados para conciliación.
3. Si se revierte el código, mantener las migraciones aditivas aplicadas: no existe una migración down automática y las tablas/columnas nuevas no deben eliminarse mientras la versión anterior siga operando.
4. Restaurar backup solo si se verificó el punto de recuperación y se evaluó la pérdida de escrituras posteriores. Nunca usar `migrate reset` en un entorno con datos.
5. Reconciliar el estado del proveedor antes de volver a habilitar cualquier envío; hacerlo requiere aprobación separada.
- Messenger, Telegram y TikTok no están conectados al outbox canónico.
