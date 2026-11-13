# Runbook operativo — WhatsApp Cloud e Instagram

Fecha: 2026-11-13  
Rama de implementación: `fix/migration-safety-audit`  
Estado: guía de staging; **no autoriza activar envíos ni desplegar**.

## 1. Estado seguro por defecto

- `CHANNEL_OUTBOUND_DISPATCH_ENABLED` debe permanecer ausente o distinto de `true`.
- `CHANNEL_OUTBOX_WORKER_SECRET` no debe configurarse en entornos que no vayan a ejecutar el worker.
- No hay cron/scheduler registrado por el repositorio; el endpoint POST no se ejecuta solo.
- `POST /api/inbox/send` en conversaciones canónicas crea una intención `queued`; HTTP 202 no significa que Meta haya recibido el mensaje.
- `unknown` significa resultado ambiguo. No volver a encolar ni reenviar hasta comprobar el estado en el proveedor.
- El envío legacy de las integraciones existentes sigue separado durante la migración expand/contract.

## 2. Comprobaciones previas a cualquier prueba en staging

1. Confirmar que el entorno y la base de datos son staging, no producción.
2. Crear y verificar backup restaurable antes de aplicar migraciones.
3. Aplicar migraciones Prisma en staging y comprobar que `ChannelWebhookEvent` y las tablas canónicas existen.
4. Confirmar que cada `ChannelConnection` pertenece a la organización correcta, usa el proveedor/canal esperado y está `connected`.
5. Verificar en Meta que la app, permisos, número/cuenta, webhook URL, suscripción a campos y política de ventana/plantillas están aprobados.
6. Confirmar firma HMAC válida con el App Secret de la conexión y probar una firma inválida (debe devolver 401).
7. Usar contactos de prueba consentidos y mensajes no sensibles. No importar datos de clientes reales en fixtures.

## 3. Salud agregada del outbox y webhooks

El endpoint interno de solo lectura es:

`GET /api/internal/channel-outbox`

Requiere `Authorization: Bearer <CHANNEL_OUTBOX_WORKER_SECRET>` con secreto de al menos 32 caracteres. Devuelve únicamente contadores globales y timestamp; no expone IDs, cuerpos, tenants ni credenciales.

Campos:
- `outbox.queued`: intenciones esperando worker.
- `outbox.sending`: llamadas en curso.
- `outbox.staleSending`: `sending` con más de cinco minutos.
- `outbox.unknown`: resultado ambiguo que exige conciliación humana.
- `outbox.failed`: fallos definitivos o no enviables.
- `webhookEvents.processing`, `failed`, `staleProcessing`: eventos en proceso, fallidos o con lease vencido.
- `workerEnabled`: valor efectivo del feature flag.
- `connectedMetaConnections`: conexiones WhatsApp/Instagram canónicas conectadas.

No se ha configurado un sistema de alertas en este repositorio. En staging, como mínimo, alertar si `staleSending > 0`, `unknown > 0`, `staleProcessing > 0` o `webhookEvents.failed > 0`; revisar cualquier crecimiento sostenido de `queued`.

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

- La tabla de eventos evita claims concurrentes y permite recuperar fallos/leases vencidos, pero un crash después de un efecto externo y antes de marcar `processed` puede repetir ese efecto en una recuperación. Workflows y auto-respuestas requieren idempotencia/outbox propia.
- No hay garantía exactly-once de extremo a extremo.
- No se han validado todavía cuentas reales/sandbox de Meta ni el batch firmado completo en rutas.
- No hay scheduler, alertas, dashboard de conciliación ni SLO/RPO/RTO aprobados.
- Messenger, Telegram y TikTok no están conectados al outbox canónico.
