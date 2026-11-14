# Runbook operativo — canales, outbox y scheduler

Fecha: 2026-11-13  
Rama de implementación: `fix/migration-safety-audit`  
Estado: guía de staging; **no autoriza activar envíos ni desplegar**.

## 1. Estado seguro por defecto

- `CHANNEL_OUTBOUND_DISPATCH_ENABLED` debe permanecer ausente o distinto de `true`.
- `CHANNEL_AUTOREPLY_ENABLED` debe permanecer ausente o distinto de `true`; los webhooks Meta, la auto-respuesta Telegram y el endpoint interno de auto-respuesta Baileys no deben responder automáticamente por defecto.
- Las acciones externas de workflows (Baileys, Telegram y SMTP) ahora persisten primero en `WorkflowOutboundMessage`, con payload cifrado, clave idempotente por run/paso y estados `queued/sending/sent/failed/unknown`. El worker `POST /api/internal/workflow-outbox` permanece desactivado por defecto: requiere `WORKFLOW_OUTBOX_DISPATCH_ENABLED=true` y `WORKFLOW_OUTBOX_WORKER_SECRET` (mínimo 32 caracteres). `WORKFLOW_EXTERNAL_SENDS_ENABLED` es un flag legacy ignorado; no habilita envíos.
- `WHATSPOWER_ENABLED` debe permanecer ausente o distinto de `true`; el bridge inbound puede activar automatizaciones remotas, por lo que también se mantiene apagado durante pruebas de recepción.
- `CHANNEL_OUTBOX_WORKER_SECRET` y `WORKFLOW_OUTBOX_WORKER_SECRET` no deben configurarse en entornos que no vayan a ejecutar sus respectivos workers.
- src/instrumentation.ts sí registra el scheduler general de workflows al iniciar cada proceso Node: primer tick a los 15 s y luego cada 60 s. Ejecuta automatizaciones schedule y reanuda runs waiting; **no despacha** ChannelOutboundMessage ni WorkflowOutboundMessage. Los endpoints POST de ambas outboxes siguen siendo pull workers separados, sin scheduler interno.
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
- `workflowExternalSendsEnabled`: estado efectivo de `WORKFLOW_OUTBOX_DISPATCH_ENABLED` para la outbox workflow (debe ser `false` por defecto).
- `workflowExternalSendsFlagRequested`: indica si quedó solicitado el flag legacy `WORKFLOW_EXTERNAL_SENDS_ENABLED`; no habilita envíos.
- `workflowOutboxWorkerSecretConfigured`: indica únicamente si el secreto dedicado del worker workflow está configurado; nunca expone su valor.
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
- Los envíos externos de workflows y las auto-respuestas tienen opt-in explícito separado. El worker workflow requiere además secreto dedicado y no tiene scheduler registrado. No habilitar estas variables durante pruebas de recepción.
- Las auto-respuestas WhatsApp/Instagram ahora persisten primero en `ChannelOutboundMessage` con clave derivada del ID del proveedor; el webhook no llama directamente a Meta. El worker de outbox sigue apagado por defecto y los reintentos se protegen por clave idempotente.
- No hay garantía exactly-once de extremo a extremo. La deduplicación de workflows evita crear un segundo run. Las acciones externas workflow persisten en `WorkflowOutboundMessage`, separada de la outbox canónica de WhatsApp/Instagram; resultados inciertos quedan en cuarentena y requieren conciliación manual.
- No se han validado todavía cuentas reales/sandbox de Meta. Las pruebas de integración usan payloads firmados con secretos sintéticos y cubren ambos canales, outbox y aislamiento; la validación de sandbox sigue pendiente.
- El scheduler general de workflows sí está registrado por instrumentation.ts; no hay scheduler de despacho de outboxes. No hay alertas desplegadas, dashboard de conciliación ni SLO/RPO/RTO aprobados.

### Reversión segura de esta fase

1. Deshabilitar `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_EXTERNAL_SENDS_ENABLED` (legacy, no habilita envíos) y `WHATSPOWER_ENABLED`; detener cualquier scheduler externo.
2. No borrar ni reencolar registros `unknown`, `sending` o `queued`; exportar únicamente IDs/códigos sanitizados para conciliación.
3. Si se revierte el código, mantener las migraciones aditivas aplicadas: no existe una migración down automática y las tablas/columnas nuevas no deben eliminarse mientras la versión anterior siga operando.
4. Restaurar backup solo si se verificó el punto de recuperación y se evaluó la pérdida de escrituras posteriores. Nunca usar `migrate reset` en un entorno con datos.
5. Reconciliar el estado del proveedor antes de volver a habilitar cualquier envío; hacerlo requiere aprobación separada.
- Messenger y TikTok no están conectados al outbox canónico. Telegram tiene dispatcher propio dentro de la outbox de workflows, no en la outbox canónica.


## Controles adicionales — 2026-11-13

- El callback OAuth de Instagram debe actualizar únicamente una conexión cuya clave global pertenezca también a la organización autenticada. Un conflicto concurrente de ownership debe abortar, nunca ejecutar un upsert global que reemplace credenciales.
- Los workflows no deben usar teléfonos/correos suministrados libremente en el payload del evento; solo datos de un cliente resuelto en la organización del run pueden ser destinatarios.
- El estado de entrega no debe retroceder: callbacks tardíos de fallo no reemplazan estados de éxito ya observados.


## Seguridad de callbacks y correo

- El callback OAuth elimina la cookie CSRF en todos los resultados y mantiene el mismo path de cookie.
- El webhook WhatsApp descarta estados de entrega no reconocidos antes de persistirlos.
- El HTML de correo de workflows escapa el cuerpo como texto plano; el asunto se limita a 200 caracteres y elimina saltos CR/LF.
- Estas protecciones están cubiertas por tests automatizados; no sustituyen las pruebas con sandbox Meta ni una prueba SMTP controlada en staging.


- Un HTTP 2xx de Meta sin ID de mensaje no se considera confirmación suficiente: la intención queda `unknown` y requiere conciliación manual; nunca se reenvía a ciegas.


## 9. Outbox de acciones externas de workflows

- Cada paso send_whatsapp, send_telegram o send_email crea primero una fila en WorkflowOutboundMessage dentro de la organización del run. La clave única corresponde a (organizationId, automationRunId, stepIndex).
- El payload (destinatario, asunto y contenido) se cifra con APP_ENCRYPTION_KEY/APP_SECRET; no se guarda en claro. La notificación y TimelineEvent solo contienen el estado y el identificador interno.
- El worker es POST /api/internal/workflow-outbox, autenticado con WORKFLOW_OUTBOX_WORKER_SECRET; requiere además WORKFLOW_OUTBOX_DISPATCH_ENABLED=true. GET devuelve únicamente contadores agregados.
- Baileys usa el daemon multi-organización con orgId explícito e INTERNAL_API_SECRET; Telegram resuelve el token cifrado de la integración de la misma organización; SMTP usa Settings de esa organización o el fallback global existente.
- Un timeout, excepción de transporte o resultado ambiguo queda unknown. Los sending con más de cinco minutos se ponen en cuarentena como unknown; nunca se reencolan automáticamente. Solo un rechazo HTTP 4xx claro del daemon Baileys se marca failed.
- El worker procesa como máximo cinco por llamada, de forma secuencial. No existe scheduler automático para esta outbox; el scheduler general de workflows no la despacha. Persistir una intención no habilita ni ejecuta el envío.
- No activar el worker en producción ni hacer pruebas de envío sin autorización separada, destinatarios de prueba consentidos y revisión de credenciales.


## 10. Prueba controlada de outbox workflow (Baileys / Telegram / SMTP)

Esta prueba requiere un entorno staging aislado, un destinatario de prueba consentido por canal, backup restaurable y autorización operativa separada. No se ejecuta como parte de la validación de recepción ni en producción.

1. Confirmar `WORKFLOW_OUTBOX_DISPATCH_ENABLED=false`, worker detenido y ausencia de scheduler.
2. Aplicar migraciones en staging y verificar que la tabla `WorkflowOutboundMessage` existe.
3. Ejecutar un workflow con datos sintéticos y verificar que la fila queda `queued`, que `payloadEnc` está cifrado y que no se produce ninguna llamada de red.
4. Confirmar que una repetición del mismo run/paso devuelve la misma intención y que un payload distinto para la misma clave se rechaza como conflicto.
5. Para el canal elegido, validar destinatario de prueba, configuración del tenant y credenciales. Para SMTP, usar un servidor/sink de pruebas; para Telegram, un bot y chat de prueba; para Baileys, una sesión/número de staging.
6. Solo después de aprobar esos controles, configurar `WORKFLOW_OUTBOX_WORKER_SECRET` (32+ caracteres) y activar `WORKFLOW_OUTBOX_DISPATCH_ENABLED=true` en staging.
7. Ejecutar una sola llamada autenticada a `POST /api/internal/workflow-outbox` con `limit: 1`; comprobar estado, ID de proveedor cuando exista y que no se haya procesado más de una intención.
8. Simular un timeout en entorno de prueba. El estado debe pasar a `unknown`; una segunda llamada no debe volver a contactar al proveedor.
9. Probar `GET /api/internal/workflow-outbox`: solo devuelve contadores agregados y no IDs, destinatarios ni contenido.
10. Desactivar el flag, retirar el secreto del worker y detener cualquier scheduler al terminar. Documentar la evidencia sin PII ni credenciales.

No habilitar los tres canales a la vez en la primera prueba. La aprobación de un canal no autoriza activar los demás ni producción.

- La suite de integración de Workflow Outbox verifica reclamación concurrente (un solo envío por intención), fencing frente a ACK tardío tras cuarentena, resultado ambiguo sin reintento, aislamiento entre organizaciones, idempotencia/conflicto de payload y autenticación/feature gate del endpoint. Son pruebas con proveedor simulado; no demuestran aceptación en sandbox externo.

- En el detalle de pasos del workflow, una acción externa persistida en outbox se etiqueta `queued`, no `success`: el estado confirma que la intención quedó durablemente encolada, no que el proveedor la haya entregado. El estado global del run representa la finalización del flujo de automatización; la entrega conserva su ciclo de vida independiente en `WorkflowOutboundMessage`.

## 11. Monitor de salud de outbox (implementación manual, sin scheduler)

- `npm run ops:monitor-outbox` consulta exclusivamente por GET `/api/internal/channel-outbox` y `/api/internal/workflow-outbox`; nunca llama a los endpoints POST de despacho.
- Requiere `OUTBOX_MONITOR_BASE_URL` (HTTPS), `CHANNEL_OUTBOX_WORKER_SECRET` y `WORKFLOW_OUTBOX_WORKER_SECRET` (cada uno de 32+ caracteres). Si hay alertas también requiere `OUTBOX_ALERT_WEBHOOK_URL` (HTTPS), que recibe únicamente códigos, severidades y mensajes agregados, nunca IDs, destinatarios ni contenido.
- Umbrales: `staleSending > 0` crítico; `unknown > 0`, webhooks fallidos/vencidos o fallos de workflow altos; cola más antigua >10 minutos media.
- GitHub Actions ofrece únicamente ejecución manual (`workflow_dispatch`). No hay ejecución programada ni monitor activo por defecto. Si faltan URL o secretos de lectura, la ejecución se omite sin hacer peticiones.
- El webhook de alertas es una interfaz JSON genérica; debe apuntar a un receptor compatible configurado por el operador. No se configura ni se inventa un destino.
- El monitor no habilita workers, no modifica datos y no realiza envíos a canales. No ofrece deduplicación persistente de alertas; un operador que lo ejecute repetidamente puede recibir la misma alerta en cada ejecución.


## 12. Auditoría de cobertura por canal, backfill y scheduler

### Matriz de cobertura actual

| Canal / transporte | Persistencia y despacho actual | Estado y límite |
|---|---|---|
| WhatsApp Cloud API | ChannelConnection + ChannelOutboundMessage; adaptador Meta y worker pull | Cubierto por outbox canónica; worker apagado por defecto |
| Instagram Messaging | ChannelConnection + ChannelOutboundMessage; adaptador Meta y worker pull | Cubierto por outbox canónica; worker apagado por defecto |
| WhatsApp Baileys | WorkflowOutboundMessage cifrada; dispatcher usa daemon con orgId explícito | Cubierto para acciones de workflows; la auto-respuesta del daemon también exige CHANNEL_AUTOREPLY_ENABLED=true y NichoConfig.autoReplyEnabled; no comparte la outbox canónica Meta |
| Telegram Bot | WorkflowOutboundMessage para acciones de workflows | El webhook histórico también tenía auto-respuesta directa al Bot API. Ahora exige CHANNEL_AUTOREPLY_ENABLED=true además de la preferencia por organización; esa ruta directa aún no es durable ni usa la outbox. El webhook registra `update_id` en `ChannelWebhookEvent`, asociado a la conexión canónica `telegram:bot:<botId>`. El claim es atómico por `(connectionId, eventKey)`, usa lease de cinco minutos y fencing token; los duplicados procesados/en curso se reconocen y los eventos fallidos o con lease vencido pueden reclamarse. Tras un fallo posterior al claim se devuelve HTTP 500 para solicitar reintento de Telegram. La clave de conexión coincide con la del backfill; si el bot ya pertenece a otro tenant, el webhook falla cerrado. El `update_id` también se propaga como `messageId` estable (`tg_update_<update_id>`) al motor de workflows, cuya clave única por automatización evita crear un segundo run al reintentar el mismo update. Esto evita el doble procesamiento concurrente y los reintentos posteriores a un procesamiento confirmado, pero no ofrece exactly-once: un crash después de un efecto lateral y antes de completar el ledger puede repetir ese efecto al recuperarse. El webhook legacy sigue escribiendo timeline y ejecutando workflows directamente; la auto-respuesta IA también sigue siendo directa y depende de `CHANNEL_AUTOREPLY_ENABLED`. El endpoint manual autenticado /api/telegram/send sigue siendo una operación directa iniciada por usuario |
| Email / SMTP | WorkflowOutboundMessage cifrada; configuración SMTP de la organización o fallback global existente | Cubierto para acciones de workflows; requiere sink SMTP de pruebas antes de validar |
| Messenger | Webhook legacy valida HMAC y ahora exige coincidencia exacta de Page ID; envío automático legacy directo | Sin adaptador/outbox canónica. La deduplicación por búsqueda en timeline no es un claim atómico y puede duplicar bajo concurrencia; auto-respuesta exige flag global. Inventario solamente, no habilitar como canal migrado |
| TikTok | Webhook legacy valida HMAC/timestamp; envío automático legacy directo | Sin adaptador/outbox canónica ni ledger durable de deduplicación; la validación HMAC ahora exige timestamp numérico reciente (ventana de 5 min, tolerancia futura de 30 s) ligado al body; no hay ledger de event_id para deduplicar reintentos dentro de esa ventana, por lo que el replay reciente aún puede duplicar procesamiento. Auto-respuesta exige flag global. Inventario solamente, no habilitar como canal migrado |

La cobertura de WhatsApp/Instagram en outbox no implica validación de proveedor real. Los tests automatizados usan mocks/fixtures; faltan cuentas sandbox, pruebas de entrega y conciliación externas.

- Los endpoints manuales autenticados de envío (Telegram, Instagram, Facebook/Messenger, TikTok y correo) realizan llamadas directas al proveedor; no son workers de outbox ni quedan bloqueados por CHANNEL_OUTBOUND_DISPATCH_ENABLED. Facebook y TikTok también conservan auto-respuestas legacy directas desde webhook; ambas quedaron detrás de CHANNEL_AUTOREPLY_ENABLED, pero todavía no tienen persistencia previa en outbox. No invocarlos durante pruebas de auditoría ni usar destinatarios reales. El endpoint canónico /api/inbox/send sí persiste intención queued para WhatsApp/Instagram.

### Backfill legacy: alcance y recuperación

- scripts/backfill-channel-connections.ts es dry-run por defecto. Lee WhatsAppConnection e Integration y planifica WhatsApp Cloud, Instagram, Messenger, Telegram y TikTok.
- La fuente WhatsAppConnection tiene prioridad frente a duplicados legacy de Integration. La clave global providerAccountKey se valida contra tenant, canal, proveedor e ID externo; los conflictos se cuentan y hacen que el proceso termine con código 2.
- El backfill no modifica ni elimina las tablas legacy. Para escribir exige --apply y BACKFILL_CHANNEL_CONNECTIONS_CONFIRM=1; en producción requiere además BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION=1.
- Messenger, Telegram y TikTok quedan pending porque todavía no tienen adaptador/outbox canónica. No deben tratarse como conexiones listas para envío.
- No se ha ejecutado el dry-run en una base de staging en esta fase, porque no hay staging configurado/autorizado. No ejecutar --apply hasta tener backup restaurable, revisar conteos y resolver cada conflicto.

### Scheduler general: comportamiento y límites

- src/instrumentation.ts arranca runDueJobs() en runtime Node: primer tick tras 15 segundos y luego cada 60 segundos. Es un scheduler activo del CRM, independiente de los workers de outbox.
- runDueJobs({ orgId }) filtra sweeper, runs waiting y automatizaciones programadas por organización. La llamada global sin orgId es para el operador del sistema; POST /api/cron/run solo la permite con CRON_SECRET/APP_SECRET. La sesión admin pasa su auth.orgId.
- El claim de una automatización mueve nextRunAt mediante updateMany condicional, evitando que dos instancias reclamen la misma ocurrencia. El guard running solo coordina llamadas dentro del mismo proceso; no es un lease distribuido.
- **Límite de recuperación identificado:** nextRunAt se adelanta antes de invocar runWorkflowsForTrigger. Si el proceso cae después del claim y antes de crear el run, esa ocurrencia puede perderse hasta el siguiente intervalo. El sweeper recupera runs ya creados que quedaron running más de 10 minutos y los marca failed; resumeWaitingRuns retoma los waiting vencidos. No existe todavía un ledger durable de claims de scheduler que permita reponer con certeza una ocurrencia reclamada pero no iniciada.
- Los tests scheduler-recovery y tenant-scope-scheduler cubren huérfanos, waiting, idempotencia del sweeper y separación A/B; no prueban crash entre claim de nextRunAt y creación del run ni coordinación entre procesos distribuidos.
- No cambiar el scheduler general ni activar workers/outboxes como parte de esta auditoría sin una revisión separada. La siguiente mejora técnica es persistir cada ocurrencia programada en un ledger/outbox de scheduler antes de avanzar nextRunAt, con clave única por automatización y hora programada, lease y recuperación idempotente.
