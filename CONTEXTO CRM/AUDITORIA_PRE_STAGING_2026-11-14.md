# Auditoría previa a staging — 2026-11-14

Repositorio: ALBRA8/CRM-ALBRA  
PR de integración: #3  
Rama inspeccionada: `fix/migration-safety-audit`  
HEAD inspeccionado: `68e06a232107f80c9ce221adeadcd8fff6690b37`

## Estado de control verificado

- PR #3: abierta, draft, no fusionada.
- CI pull_request del HEAD inspeccionado: run 43565638654, conclusión `success`.
- En ese run finalizaron correctamente: instalación, secret scan, Prisma generate, migraciones limpias SQLite, TypeScript, lint, suite de tests y build de producción.
- Esto valida ese SHA en CI; no demuestra compatibilidad con una base de staging real ni con proveedores externos.
- No se ejecutaron migraciones, backfills, workers, envíos externos ni despliegues durante esta auditoría.

## Hallazgos técnicos confirmados en el código inspeccionado

### TikTok — no listo para staging

- El webhook valida HMAC y frescura del timestamp, exige un identificador estable y reclama el evento en `ChannelWebhookEvent`.
- El ledger evita procesar de nuevo eventos ya procesados y utiliza lease/fencing para los claims.
- El parser actual obtiene `senderId` y texto, pero no conserva de forma fiable el `conversation_id` documentado del mensaje entrante.
- El webhook explícitamente no despacha respuestas; el sender de Business Messaging existe, pero no está integrado a la outbox canónica de canales.
- El endpoint de despacho de `ChannelOutboundMessage` inspeccionado solo selecciona WhatsApp, Instagram y Messenger; TikTok no está incluido.
- Bloqueo: definir y probar el contrato de evento entrante autorizado por TikTok Business Messaging, persistir la conversación y conexión correctas y conectar el adaptador con outbox, conciliación y estado ambiguo. No inferir el ID de conversación desde el remitente.

### Telegram — el estado anterior estaba desactualizado

- El webhook actual sí valida `X-Telegram-Bot-Api-Secret-Token`.
- Reclama `update_id` en `ChannelWebhookEvent` antes de timeline, workflows, ASR o respuesta.
- La respuesta IA se encola mediante `enqueueTelegramWebhookReply`; no debe considerarse entrega confirmada.
- Pendiente: verificar el contrato completo de conexión canónica/backfill, cobertura de carreras y fallos parciales, y que todas las rutas de envío automático estén detrás del kill-switch global y de la outbox. Probar con mocks y luego sandbox aprobado.

### Scheduler — no listo para staging

- La reclamación de una automatización schedule y la creación de `AutomationRun` están dentro de una transacción; el filtro incluye automatización, tenant, tipo y vencimiento.
- La exclusión `running` es una variable local al proceso; no es un lock distribuido.
- La recuperación de runs antiguos utiliza un cambio condicional de estado/fecha, pero no hay un lease/fencing token de propiedad del worker que cubra la ejecución completa. Un proceso antiguo que siga vivo puede continuar después de que otro proceso lo considere estancado.
- Los pasos `started` ambiguos se convierten a `unknown` y no se repiten automáticamente; los runs históricos sin ledger se dejan para revisión.
- Bloqueo: lease distribuido con fencing monotónico y comprobación del token en cada escritura de progreso/resultado, además de pruebas de dos instancias, expiración, worker antiguo reanudado y crash en cada frontera.

### Outbox y workers — no listos para staging

- Hay outbox de canales y outbox de workflows separadas, con estados conservadores y endpoints pull protegidos por secretos dedicados y flags.
- `unknown` y `sending` vencidos requieren conciliación; no deben reintentarse a ciegas.
- El monitor de salud existe como script/workflow manual condicionado a secretos; no hay evidencia de monitorización/alertas desplegadas.
- Bloqueo: verificar todos los adaptadores/canales, reconciliación idempotente, carrera entre ACK y lease, métricas, alertas reales de staging y procedimientos de pausa/recuperación.

### Multitenancy, datos y migraciones

- El esquema canónico `ChannelConnection`, `ChannelConversation`, `ChannelWebhookEvent` y outboxes ya existe.
- El runbook indica backfill en dry-run por defecto y exige backup restaurable, revisión de conflictos y aprobación separada antes de aplicar.
- La CI comprueba migraciones limpias en SQLite. No prueba restauración de backup, volumen real, PostgreSQL ni backfill sobre datos reales.
- Bloqueo: auditoría sistemática de cada query y relación por `organizationId`, constraints compuestas donde correspondan, dry-run revisado, ensayo de restauración y migraciones en staging aislado.

## Puertas obligatorias antes de staging

- [ ] Cerrar contrato TikTok entrante/saliente y outbox.
- [ ] Implementar lease/fencing distribuido del scheduler y pruebas multiinstancia.
- [ ] Auditar los cinco canales y todas las rutas de envío legacy/canónicas.
- [ ] Verificar idempotencia y conciliación de ambas outboxes.
- [ ] Completar matriz de aislamiento multitenant y pruebas negativas.
- [ ] Ejecutar dry-run de backfill y revisar conflictos; no aplicar sin aprobación.
- [ ] Backup y restauración demostrados en entorno aislado.
- [ ] CI verde en el nuevo HEAD (secret scan, migraciones, TypeScript, lint, tests y build).
- [ ] Pruebas sandbox por proveedor, con cuentas de prueba autorizadas y límites controlados.
- [ ] Monitorización/alertas y runbooks probados.
- [ ] Revisión de secretos, permisos, callbacks, URLs y feature flags.
- [ ] Confirmar flags de despacho y auto-respuesta apagados antes de cualquier despliegue.

## Límites de esta auditoría

Esta auditoría se hizo leyendo el árbol y los archivos de la rama en GitHub. No se ejecutó el repositorio localmente, no se aplicaron migraciones y no se accedió a staging ni a cuentas de proveedores. Los puntos anteriores son hallazgos de código/documentación, no una certificación de operación real.

## Regla de seguridad

Mantener desactivados `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_OUTBOX_DISPATCH_ENABLED` y `WHATSPOWER_ENABLED`. No configurar secretos de workers, no ejecutar envíos reales, no hacer merge ni desplegar como parte de esta fase previa.


## Auditoría ampliada de canales y CI — 2026-11-14

HEAD de esta revisión documental: `9b4fa5356b4d0243c84d8e97a48e0fc3203ee2a8`.

### Matriz de entrada por canal

| Canal | Firma/autenticación observada | Identidad/deduplicación observada | Brecha confirmada |
|---|---|---|---|
| WhatsApp Cloud | HMAC Meta contra secretos de las integraciones candidatas | Reclama `message.id` cuando existe; conserva IDs de mensaje en conversación canónica | El flujo sigue procesando algunos mensajes aunque falte `message.id`; ese camino no obtiene claim durable antes de timeline/workflow. Revisar y fallar cerrado para eventos de mensaje sin ID estable |
| Instagram | HMAC Meta por cuenta candidata | Reclama `msg.mid` cuando existe y usa upsert de mensaje canónico | Si falta `mid`, el handler aún puede procesar timeline/workflow sin claim durable. Debe definirse rechazo/registro no accionable para eventos sin identidad estable |
| Messenger | HMAC Meta y filtro estricto por Page ID exacto | Reclama `msg.mid` cuando existe | Si falta `mid`, actualmente continúa con efectos CRM/workflow sin claim. Bloquear o aislar estos eventos sin identidad estable |
| Telegram | Header `X-Telegram-Bot-Api-Secret-Token` | Reclama `update_id` antes de efectos; la respuesta automática se encola con clave basada en `update_id` | Verificar límites/retención del ledger, fallos parciales en timeline/ASR y alineación de la outbox específica de Telegram con la outbox canónica |
| TikTok | HMAC con timestamp y ventana de frescura; identidad tenant ambigua devuelve 409 | Exige ID estable de evento y reclama el evento con fencing token | Parser no conserva por separado sender ID y `conversation_id`; no hay despacho TikTok en outbox canónica ni conciliación de entrega |

### Hallazgos cruzados adicionales

- El helper del ledger de webhooks usa claim token aleatorio y compara ese token al completar/fallar. Es fencing para la vida del claim de webhook, pero no equivale a un lease/fencing del scheduler.
- Los webhooks Meta de Instagram/Messenger y WhatsApp tienen ramas que aceptan eventos sin ID estable. Para evitar duplicar timeline/workflows/auto-respuestas tras reentregas, la regla debe ser no ejecutar efectos no idempotentes sin identidad del proveedor.
- Telegram sí tiene deduplicación durable por `update_id`; el mensaje de respuesta se encola por `enqueueTelegramWebhookReply`, en una ruta específica de workflow outbox.
- El dispatcher de la outbox canónica filtra explícitamente canales WhatsApp, Instagram y Messenger. TikTok no aparece entre los canales elegibles.
- Las rutas manuales `/api/{facebook,instagram,telegram,tiktok}/send` y otras rutas legacy deben auditarse separadamente: no son el worker pull de outbox y no deben confundirse con entrega gestionada/conciliada por outbox.
- Scheduler: `running` es un mutex de módulo, no coordinación entre réplicas. La recuperación por `startedAt` puede tomar un run mientras un worker antiguo continúa vivo. Hace falta un token monotónico por run/lease, con todas las escrituras de estado condicionadas por ese token; además, los efectos internos no idempotentes deben tener su propia clave/claim.
- La outbox de workflows y la outbox de canales tienen leases/claims propios; no asumir que el fencing de una protege a la otra ni al scheduler.

### Estado CI del commit documental anterior

- El run pull_request `43566330805` para este HEAD superó Prisma generate, migraciones SQLite, TypeScript y lint.
- La suite de tests estaba en ejecución al momento de registrar esta actualización; build de producción aún no confirmado.
- No declarar el commit verde hasta verificar suite y build para el SHA exacto.


## Corrección incremental aplicada — identidad estable en webhooks Meta

Commits de código:
- `3b45a32`: WhatsApp omite mensajes entrantes sin `message.id` antes de timeline/workflows.
- `b8dc02e`: Instagram omite mensajes entrantes sin `msg.mid` antes de efectos CRM/workflow.
- `d0f4d40`: Messenger omite mensajes entrantes sin `msg.mid` antes de efectos CRM/workflow.
- `4b1c692`: test de integración Instagram demuestra que un mensaje sin MID no crea claim, conversación ni evento de timeline.

Motivo: sin un ID estable del proveedor no existe una clave durable fiable para deduplicar una entrega repetida. Se prefiere omitir el evento malformado antes que producir efectos duplicados. Esta corrección no resuelve el lease distribuido del scheduler ni integra TikTok en la outbox.

Validación pendiente para estos commits: CI completo en el HEAD resultante, incluidos tests y build. La prueba añadida cubre Instagram; deben añadirse pruebas equivalentes de ruta para WhatsApp y Messenger antes de cerrar la matriz de canales.


### Cobertura de prueba ampliada

- Se añadió `tests/integration/messenger-webhook.test.ts`: firma HMAC sintética, Page/tenant aislados y comprobación de que un mensaje Messenger sin MID no genera evento de ledger ni timeline.
- El test de Instagram equivalente está en `tests/integration/instagram-webhook.test.ts`.
- No se han añadido todavía pruebas equivalentes de ruta para WhatsApp ni una prueba de replay de extremo a extremo para TikTok; esos puntos siguen abiertos.
- HEAD de código/documentación en esta actualización: `ab90228acdfac327a52c3e7fb783c08dde3511a9`. CI push para este SHA está en ejecución; no hay conclusión final aún.


- Se añadió `tests/integration/whatsapp-webhook.test.ts`: conexión WhatsApp canónica sintética, firma HMAC y comprobación de que un inbound sin `message.id` no crea claim, conversación ni timeline.
- La matriz de pruebas negativas para identidad estable ya incluye Instagram, Messenger y WhatsApp. TikTok requiere una prueba de contrato del payload oficial y de conservación separada de `sender_id`/`conversation_id`.
- HEAD de esta ampliación: `00b5f7e4f0ee8a0d66e1c9ae8c83a0c46ccd4c31`. CI de este SHA aún debe completar tests y build.


## Revisión continuada — HEAD 5d6c51707e28e8a8d9280893dda92b4757b23bfc

### CI confirmado para el HEAD exacto

- El workflow `pull_request` run [43566986559](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/43566986559) terminó con `success` sobre el SHA exacto `5d6c51707e28e8a8d9280893dda92b4757b23bfc`.
- El job `ci` terminó correctamente en todos sus pasos: instalación de dependencias, escáner de secretos, generación Prisma, migraciones limpias SQLite, TypeScript, lint, suite completa de tests y build de producción.
- Esto valida el pipeline automatizado del SHA; no sustituye pruebas PostgreSQL/staging, aislamiento multiinstancia, sandbox de proveedores ni backup/restauración.

### Inspección adicional del código en ese HEAD

- **TikTok:** el parser `extractMessage` todavía sustituye un sender ausente por `conversation_id`; además el workflow fabrica `conversationId` como `tt:<senderId>`. No se considera contrato válido ni se corrige sin una fixture autorizada del payload Business Messaging. El webhook no envía respuestas, pero tampoco persiste aún la conversación real necesaria para el adaptador de outbox. TikTok sigue bloqueado para staging.
- **Outbox de canales:** `dispatchChannelOutboundMessage` solo despacha cuando el caller inyecta un adaptador exacto `provider:channel`; valida tenant/conexión antes de descifrar credenciales y clasifica resultados ambiguos como `unknown`. En el código inspeccionado no hay adaptador TikTok integrado al worker canónico. La existencia del dispatcher genérico no equivale a soporte TikTok.
- **Scheduler:** `src/lib/scheduler.ts` conserva un booleano `running` en memoria de proceso. La recuperación de stale runs cambia estado/fecha mediante condiciones CAS, pero no hay token de lease distribuido asociado al worker y exigido en cada escritura del motor. No es seguro declarar resuelta la carrera entre réplicas; implementar fencing requiere un diseño coordinado con el workflow engine y sus escrituras de ledger/resultado.
- **Conciliación:** existe resolución manual conservadora para outbound `unknown`, con estados no reintentables automáticamente. Aún falta demostrar una matriz completa de reconciliación para ambas outboxes, todos los proveedores/canales, ACK tardío frente a lease y procedimientos operativos/alertas.
- **Multitenancy y recuperación de datos:** el CI SQLite no prueba la totalidad de consultas/relaciones con tenants cruzados, PostgreSQL real, backfill sobre datos existentes ni restauración verificable. Se mantienen como puertas independientes; no se ejecutó backfill ni operación de backup/restore.

### Decisión operativa

- CI del HEAD indicado: **verde**.
- Auditoría global: **incompleta**; staging: **no aprobado**.
- Sin merge, despliegue, migración aplicada, backfill aplicado, workers activados ni envíos reales.
- Mantener apagados `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_OUTBOX_DISPATCH_ENABLED` y `WHATSPOWER_ENABLED`.


## Continuación técnica — diseño de cierre de riesgos

### Scheduler: diseño requerido antes de tocar el motor

No se añadió un campo de lease aislado ni se cambió el scheduler parcialmente: eso dejaría escrituras de workers antiguos sin protección. La implementación segura debe ser un cambio coordinado con migración y motor:

1. Añadir a `AutomationRun` un contador monotónico `fencingVersion` (default 0), `leaseOwner` y `leaseExpiresAt`. El contador es la autoridad; el owner es diagnóstico y no sustituye al fence.
2. Reclamar o recuperar mediante una transacción/CAS que compruebe estado y expiración, incremente `fencingVersion` y devuelva el nuevo valor al worker. Una reclamación nunca reutiliza un fence anterior.
3. Pasar `runId + fencingVersion` como contexto obligatorio a `runWorkflowsForTrigger`, `resumeWaitingRuns` y cada operación que cambie `AutomationRun`, `WorkflowStepExecution`, `stepStates`, `currentStep`, outputs, status o timestamps. Cada escritura debe filtrar por el fence vigente; cero filas significa pérdida de ownership y el worker debe detenerse.
4. Renovar lease con CAS condicionado al fence vigente. Si no puede renovar, cancelar el trabajo restante. Un proceso que despierte después de una pausa larga no puede recuperar ownership con su fence viejo.
5. Mantener acciones externas exclusivamente como intenciones durables idempotentes en outbox; el worker del scheduler no debe llamar directamente a proveedores. Las acciones internas mutables también deben comprobar el fence dentro de la misma transacción que sus escrituras.
6. Probar dos instancias, expiración/reclaim, worker A pausado que vuelve después de que B reclama, pérdida de lease durante cada frontera de paso, heartbeat fallido y crash antes/después de persistir outbox. Verificar que A no escribe ni avanza estados después de perder el fence.

El diseño aún requiere revisión de todas las rutas de escritura del motor y una migración compatible con PostgreSQL/SQLite. No se implementó porque una protección solo en el claim del scheduler no impediría que el motor viejo escriba resultados después del reclaim.

### TikTok: límite del contrato de entrada

- La función privada `extractMessage` todavía permite inferir `senderId` desde `conversation_id` cuando no hay sender explícito. Esto mezcla identidad de persona y conversación y puede crear clientes CRM con una clave equivocada.
- El cambio seguro requiere un parser de contrato con `senderId` obligatorio y `conversationId` separado/opcional, preservando ambos sin inferencias. Hasta tener un payload Business Messaging aprobado/fixture del portal de socios, no se habilita el canal ni se conecta el envío.
- La prueba unitaria actual valida firma/frescura y el contrato del helper de envío, pero no valida el payload real de webhook, deduplicación de extremo a extremo ni el enlace tenant/conversación/outbox.

### Backups: evidencia disponible y límite

- El repositorio contiene `scripts/backup-restore-drill.sh`, un ensayo aislado que construye datos demo, toma snapshot, verifica hash, copia a un destino externo o directorio simulado, restaura y arranca el CRM contra la base restaurada. También comprueba health y autenticación.
- Hay pruebas de integración para límites de tamaño, validación y atomicidad del endpoint de restore.
- **No se ejecutó** el drill en esta revisión. Un directorio local que simula almacenamiento externo no demuestra recuperación del proveedor remoto; tampoco acredita RPO/RTO, restauración de adjuntos/sesiones ni disponibilidad de secretos. El ensayo real debe ejecutarse en un entorno aislado con destino remoto configurado y evidencia de tiempos/conteos.

### Estado de CI y alcance

- El commit documental anterior es `0aeb1f793fc4bda00831287be584ce522e1ae1a7`. Al último chequeo, sus workflows push y pull_request seguían `in_progress`; por tanto, no se atribuye CI verde a ese SHA.
- El CI verde confirmado sigue siendo el del código `5d6c51707e28e8a8d9280893dda92b4757b23bfc`, no el commit documental posterior.
- La auditoría multitenant y conciliación no se consideran completas por la existencia de tests parciales: falta una matriz de rutas/queries y una matriz de estados/acciones de operador con escenarios de ACK tardío y lease expirado.


### Hallazgos de revisión adicional: conciliación y multitenancy

- La conciliación de `ChannelOutboundMessage` sí es transaccional: solo acepta `unknown`, resuelve a `sent/failed`, no reencola, vincula un echo coincidente y crea `ChannelConnectionEvent`. El endpoint exige secreto interno y `providerChecked=true`; sin embargo, ese booleano es una afirmación del caller, no evidencia verificable. El evento registra conexión/organización/tipo/ID, pero no identidad autenticada del operador, referencia de consulta al proveedor, fecha de comprobación separada ni motivo. Antes de operación humana formal, añadir actor/razón/evidencia y un procedimiento de doble comprobación; no llamar esto conciliación completa.
- El estado `unknown` de la outbox de canales es terminal para despacho automático; los ACK/echo tardíos pueden confirmar el envío mediante rutas específicas. Debe probarse el orden de llegada para todos los canales, además de los escenarios ya cubiertos en tests Meta.
- La suite `multitenant-p0.test.ts` cubre una selección de rutas críticas (cliente, oportunidad, cotización, equipo, settings, memoria, automatizaciones y proxy WhatsApp). También hay pruebas aisladas para outbox y scheduler tenant-scope. Esto es evidencia útil, pero no una auditoría exhaustiva de todos los endpoints, jobs, relaciones Prisma, export/import, archivos y callbacks de proveedores. La aceptación debe basarse en inventario de rutas/modelos y tests negativos sistemáticos por organización.
- La ruta de conciliación es interna y usa secreto de worker, no autenticación de usuario/rol de operador. No exponerla al frontend ni compartir ese secreto; para uso en staging debe existir un procedimiento controlado con registro de actor y revisión independiente.


### Revisión de profundidad de pruebas: scheduler y TikTok

- `tests/integration/scheduler-recovery.test.ts` valida recuperación serial de un run stale sin ledger (marca failed), conserva un run reciente y un waiting futuro, y repite el tick para idempotencia. No simula dos procesos/instancias, renovación de lease, pausa de worker antiguo ni carrera entre reclaim y escrituras del worker original.
- `tests/integration/tenant-scope-scheduler.test.ts` sí comprueba aislamiento A/B en schedule claim, sweeper y reanudación waiting. El aislamiento de tenant no equivale a exclusión distribuida ni fencing de una ejecución que perdió ownership.
- `tests/integration/channel-webhook-events.test.ts` cubre ledger concurrente y ownership cross-tenant de conexiones Telegram/Messenger, y contiene cobertura de conexión TikTok. Pero no invoca la ruta HTTP real de TikTok con payloads firmados ni prueba el parser, la asociación de sender/conversation, el dedupe end-to-end o el fallo parcial y posterior reclaim.
- `tests/unit/tiktok-webhook-signature.test.ts` cubre frescura/HMAC raw-body y el helper de envío; no constituye una prueba de contrato del payload webhook. El propio handler reconoce que el esquema de mensajes no es públicamente documentado. Mantener el comportamiento de entrada conservador y sin despacho hasta contar con fixture de socio validada.
- Aceptación scheduler pendiente: test multi-instancia con DB compartida, worker A detenido tras claim, expiración/reclaim por B, intento tardío de A de escribir estado/resultado, y prueba de que cada escritura protegida rechaza fencingVersion obsoleta. Incluir caso de side effect externo iniciado antes de perder lease y verificar su manejo mediante outbox/idempotencia.


### Revisión de endpoint de conciliación manual

- `POST /api/internal/channel-outbox/reconcile` está protegido por `CHANNEL_OUTBOX_WORKER_SECRET` (mínimo 32 caracteres), comparación constante y validación de ID/resolución. No es un endpoint de usuario final y no debe exponerse al navegador.
- `providerChecked=true` es solo un booleano suministrado por el mismo caller autenticado. No se persiste fuente de consulta, evidencia, actor humano ni motivo. El evento actual solo guarda ID de intención y tipo de resolución.
- El endpoint acepta `resolution=sent` sin `providerMessageId`; el servicio puede entonces crear un mensaje saliente local sin ID externo. Para los proveedores donde existe un ID de mensaje, esto debilita la trazabilidad y la deduplicación frente a un echo tardío. Definir por proveedor si el ID es obligatorio; como mínimo exigirlo en los adaptadores que garantizan ese dato y conservar referencia verificable de la consulta.
- Las pruebas de integración llaman directamente al servicio de conciliación; en la revisión no se encontró una prueba HTTP de este endpoint que cubra ausencia/rotación del secreto, longitud/formato de entrada, booleano ausente y resolución sent sin ID. Añadir pruebas de ruta antes de habilitar operación.
- Conclusión: el endpoint tiene autenticación de máquina y transición conservadora de estado, pero no constituye todavía un flujo de conciliación operativa auditable por operador.


### Telegram: replay y fallos parciales del webhook

- La ruta valida el secreto Telegram, reclama `update_id` antes de ASR/timeline/workflows/respuesta y devuelve 200 para eventos ya procesados; eventos concurrentes aún no procesados reciben 503. El ledger usa claim token y lease de cinco minutos, por lo que una reclamación antigua no debe cerrar una reclamación posterior.
- Sin embargo, el procesamiento no es una única transacción: crea/actualiza cliente, registra timeline, ejecuta workflows, genera respuesta y encola outbox en pasos separados. Si falla después de registrar timeline o ejecutar workflows, la ruta marca el claim como fallido y devuelve 500 para que Telegram reintente. El retry puede repetir efectos anteriores si el consumidor downstream no tiene su propia clave idempotente estable para ese `update_id`.
- El payload de workflow incluye `messageId: tg_update_<update_id>`, pero en la revisión no se verificó que todos los workflows/triggers y sus acciones deduzcan duplicados con esa clave. No asumirlo. Añadir pruebas de fallo inyectado después de cada frontera (cliente, timeline, workflows, enqueue, notificación) y verificar que el reintento no duplica efectos ni pierde la respuesta.
- El fallback de voz registra timeline y notifica; si la notificación falla después del timeline, el claim se libera como fallido y el retry puede registrar el mismo evento otra vez. La escritura de timeline debe tener una clave idempotente por organización/update o la ruta debe guardar progreso por etapa.
- En los archivos de pruebas localizados no aparece una prueba de integración de la ruta HTTP Telegram real (la ruta de prueba solicitada no existe); el test unitario cubre flag de auto-respuesta y contrato del adaptador de envío, no autenticación webhook, claim, replay ni fallos parciales. Crear suite con DB aislada y Bot API mock.
- El flag global `CHANNEL_AUTOREPLY_ENABLED` es fail-closed en los tests unitarios y el webhook usa `isTelegramAutoReplyEnabled`; mantenerlo apagado hasta completar la cobertura de replay. El encolado de respuesta Telegram va por la outbox de workflow, no prueba por sí solo la entrega externa.
- No activar polling ni envío Telegram real durante esta auditoría.

### Backup/restore drill: alcance de la evidencia

- El script declara que usa BD demo aislada, pero toma primero una copia del archivo configurado por `DATABASE_URL` (o `db/custom.db`) antes de sembrar datos. La copia evita mutar el archivo de origen, pero si el origen es producción contiene una copia de datos reales dentro de `/tmp`; por tanto, no es correcto describir el drill como libre de datos reales sin restringir y validar explícitamente el origen.
- `BACKUP_REMOTE_DEST` solo usa rclone cuando está configurado y disponible; de lo contrario copia a un directorio local que simula remoto. Un PASS sin evidencia de esa variable/rclone solo demuestra copia local, no restauración desde almacenamiento remoto.
- El script se documenta como ensayo aislado, pero no se ejecutó en esta revisión. Antes de usarlo, exigir una BD fixture/sintética explícita y un destino remoto de prueba; bloquear URLs/rutas de producción, validar el destino y limpiar/retener el sandbox según política de datos.


## Corrección conservadora TikTok — 92669ae52675b4cf7471e6a7e15e2086496a86b4

- El parser ya no usa `conversation_id` como fallback de `senderId`.
- Conserva `senderId` y `conversationId` como campos separados; si el evento no trae remitente identificable, no genera efectos CRM/workflow.
- El workflow solo recibe `conversationId` cuando el payload realmente lo incluye; se elimina el identificador sintético `tt:<senderId>`.
- Esto corrige una mezcla de identidades, pero **no cierra TikTok**: sigue pendiente fixture/contrato de socio validado, prueba HTTP de replay/fallos, persistencia de conversación/conexión y adaptador de outbox canónica.
- No se habilitó despacho ni se contactó TikTok.


## Hardening de idempotencia del timeline — 2026-11-14

- Se añadió `TimelineEvent.sourceEventKey` nullable y único por `(organizationId, sourceEventKey)`, mediante migración aditiva `zzzz_timeline_event_idempotency`.
- `recordTimelineEvent` acepta esa clave y trata la colisión Prisma P2002 como no-op idempotente; los eventos manuales/legacy sin clave conservan el comportamiento previo.
- Telegram asigna una clave estable `telegram:update:<update_id>:inbound` tanto al camino de texto como al fallback de voz no transcrita. Un retry ya no crea una segunda fila de timeline para el mismo update y tenant.
- TikTok asigna una clave derivada por SHA-256 del ID de evento del proveedor; no se persiste el ID crudo como clave de timeline.
- Se añadieron pruebas de integración que verifican deduplicación en el mismo tenant y que la misma clave puede existir independientemente en dos tenants.
- Esto cierra duplicación de la fila de timeline, **no** hace atómicos el resto de los efectos Telegram/TikTok: notificaciones push, workflows, ASR y encolado requieren sus propias garantías idempotentes/ledger por etapa. No declarar resuelta toda la recuperación ante fallos parciales.

### CI de esta modificación

- HEAD al momento de esta nota: `5ff123c312f47e4bc4bd04648ff38a285aeef1bf`.
- CI anterior `9e4acfd61db3678f08e5b9ddc578c0b92ffd64fa`: push y pull_request terminaron en success.
- Para los commits de migración/schema, helper, rutas y pruebas de idempotencia del timeline, los workflows push/PR aparecían en `in_progress` en el último chequeo; no atribuirles éxito hasta que ambos terminen en el SHA final y se revisen todos los pasos.

## Bloqueos que siguen impidiendo declarar staging-ready

1. **Scheduler:** no existe fencing monotónico de lease compartido entre scheduler y workflow engine; las escrituras tardías del worker antiguo siguen sin estar condicionadas por ownership. Requiere cambio coordinado de schema, claim/heartbeat y cada escritura de run/step, además de pruebas multiinstancia.
2. **Telegram:** el claim durable por `update_id` ya existe y el timeline entrante ahora es idempotente, pero el pipeline no es transaccional. Falta suite HTTP con fallos inyectados en cada etapa y deduplicación verificable de notificaciones/acciones downstream; no confundir la outbox específica con entrega confirmada.
3. **TikTok:** el parser ya separa sender/conversation y el timeline deduplica por event ID; faltan payload fixture oficial del programa Business, test HTTP firmado/replay, persistencia canónica de conversación y adaptador completo de outbox/ACK/reconciliación. Sin fixture aprobada no se inventa contrato.
4. **Outboxes:** completar pruebas de ACK tardío/lease para todos los proveedores, matriz de estados y conciliación auditable (actor, motivo y referencia/evidencia de consulta). Los estados ambiguos no se reintentan automáticamente.
5. **Multitenancy:** inventario completo de rutas, jobs, relaciones Prisma, archivos, export/import y callbacks; pruebas negativas de tenant cruzado y constraints compuestas donde correspondan. La suite P0 actual es parcial.
6. **Backup/restore:** endurecer el script para exigir origen sintético explícito y destino remoto de prueba (fallar cerrado; no copiar por defecto `DATABASE_URL` potencialmente real a `/tmp`). Ejecutar drill aislado con evidencia de RPO/RTO, integridad, conteos y restore remoto.
7. **Staging real:** ejecutar migraciones/backfill solo en entorno aislado con backup restaurable, sandbox autorizado por proveedor, secretos de staging, observabilidad/alertas y runbooks probados. La CI SQLite no sustituye PostgreSQL ni sandbox.
8. **Release:** mantener PR draft, sin merge/deploy, y flags de despacho/auto-respuesta apagados hasta la aprobación específica de staging.

No se declara staging aprobado en este commit. La evidencia de CI de los cambios de idempotencia está pendiente.


## Endurecimiento del backup drill — 2026-11-14

- `scripts/backup-restore-drill.sh` ya no copia el archivo definido por `DATABASE_URL` ni `db/custom.db`. Ahora crea una SQLite vacía desde el schema Prisma y siembra exclusivamente organización, usuario y registros sintéticos.
- El script exige Prisma local. Para acreditar almacenamiento remoto exige `BACKUP_REMOTE_DEST` y rclone; la simulación local solo se permite con `BACKUP_DRILL_ALLOW_LOCAL_SIMULATION=1` y su salida se etiqueta como PASS LOCAL, no como recuperación remota.
- La recuperación del artefacto remoto se hace con `rclone copy` hacia el sandbox local antes de restaurar y verificar el hash.
- El drill **no se ejecutó** en esta sesión. No hay evidencia de RPO/RTO ni de restore remoto; solo se eliminó el riesgo de copiar por defecto una base posiblemente real. Debe probarse primero en entorno aislado.
- HEAD del código al registrar esta nota: `8c243ba2b898227a2818e5bd19004dd9b0cc27b5`. CI push de ese SHA seguía `in_progress`; no certificar el resultado hasta verificar CI de PR y push del SHA final.


## Actualización de cierre de revisión — HEAD `de20d912bf3d7aa2a9526191d891856534919ba2`

Esta sección **reemplaza cualquier estado anterior de CI** que describa los workflows recientes como queued/in_progress y corrige el hallazgo antiguo del script de backup que indicaba que copiaba el archivo de `DATABASE_URL`.

### CI verificado en el SHA exacto

- Push: [run 43568878176](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/43568878176) — `success`.
- Pull request: [run 43568881717](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/43568881717) — `success`.
- En ambos runs el job `ci` y todos sus pasos terminaron en `success`: checkout/setup, instalación, secret scan, Prisma generate, migraciones limpias SQLite, TypeScript, lint ratchet, suite completa de tests y build de producción.
- Esta evidencia es específica del SHA indicado. No prueba PostgreSQL real, migraciones con datos existentes, staging, proveedores externos ni restore remoto.

### Estado actual de la PR

- PR #3: abierta, `draft=true`, `merged=false`, mergeable según el último snapshot de GitHub.
- Conteo observado frente a `main`: 601 commits y 105 archivos.
- La descripción de la PR se normalizó para retirar snapshots históricos contradictorios y dejar explícitos el HEAD, ambos runs verdes, los bloqueos y las restricciones operativas.
- No se realizó merge, deploy, backfill aplicado, activación de workers ni envío externo real.

### Corrección del backup drill

- El script actual `scripts/backup-restore-drill.sh` **ya no lee ni copia el archivo indicado por `DATABASE_URL` ni `db/custom.db`**. Crea una SQLite vacía en el directorio temporal mediante `prisma db push` y siembra registros sintéticos.
- Para acreditar copia/restauración remota exige `BACKUP_REMOTE_DEST` y `rclone`; la rama local requiere opt-in explícito `BACKUP_DRILL_ALLOW_LOCAL_SIMULATION=1` y termina como `PASS LOCAL`, sin acreditar remoto.
- La ruta remota copia el snapshot con rclone, vuelve a descargarlo al sandbox, compara SHA-256, restaura y verifica integridad/conteos; después arranca el standalone contra la base restaurada y comprueba health y autenticación.
- **El drill sigue sin ejecutarse** en esta revisión. Por tanto no hay RPO/RTO medidos ni prueba operativa de restauración remota. Los apartados anteriores que describían la copia del archivo `DATABASE_URL` son históricos y quedan superados por esta corrección del script.

### Cambios incrementales confirmados en el HEAD

- Idempotencia de timeline por `(organizationId, sourceEventKey)`, usada en inbound Telegram/TikTok, con tests de deduplicación y aislamiento entre tenants.
- Parser TikTok con sender y conversation separados, y pruebas unitarias para impedir que `conversation_id` suplante al sender.
- Backup drill limitado a datos sintéticos y guardas explícitas para almacenamiento remoto.
- La clave de timeline evita duplicar esa fila concreta; no garantiza atomicidad de todo el pipeline de webhook ni de notificaciones/workflows/ASR.

### Bloqueos que siguen vigentes

- Scheduler: falta lease/fencing distribuido monotónico comprobado en todas las escrituras del workflow engine y pruebas multiinstancia/worker antiguo.
- TikTok: falta fixture oficial de socio, prueba HTTP firmada/replay y pipeline completo de conversación/outbox/ACK/conciliación.
- Outboxes: faltan matriz completa de ACK tardío/lease, evidencia y actor en conciliación y alertas operativas demostradas.
- Multitenancy: falta inventario sistemático y pruebas negativas exhaustivas de endpoints, jobs, relaciones y callbacks.
- Datos/operación: faltan dry-run revisado, ensayo aislado de migraciones/rollback, backup remoto ejecutado y sandbox de proveedores.
- Mantener apagados `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_OUTBOX_DISPATCH_ENABLED` y `WHATSPOWER_ENABLED`. No aprobar staging, merge ni deploy en esta fase.


## Actualización scheduler/outbox — HEAD `cbdfb704c5247c5d7c6d2531ad6e721bfa85aaa4`

- Se añadió `AutomationRun.leaseToken`, `leaseExpiresAt` y `fencingVersion`, con migración aditiva `zzzz_scheduler_distributed_fencing` e índice coherente en Prisma.
- El workflow engine reclama runs con compare-and-swap, incrementa la generación de fencing y renueva el lease en checkpoints. Las transiciones finales del run y las escrituras del ledger de pasos verifican tenant, token, generación y expiración; creación/actualización de pasos comparte transacción con la comprobación de ownership.
- El scheduler no toca runs con lease aún vigente aunque `startedAt` sea antiguo. Tras expiración, solo recupera automáticamente cuando el ledger demuestra que todos los pasos terminaron; pasos ambiguos y runs históricos sin ledger se cierran sin replay.
- Se añadieron pruebas de deduplicación de trigger, reclaim de lease vencido con nueva generación, preservación de lease activo y recuperación sin duplicar pasos completados.
- La conciliación manual de `ChannelOutboundMessage` usa compare-and-swap transaccional para impedir que dos procesos resuelvan la misma intención `unknown`; existe prueba de carrera concurrente.
- Límite importante: un efecto de acción que ya estaba en vuelo al perderse el lease puede terminar antes de que el checkpoint posterior detecte la pérdida. El ledger evita replay automático del resultado ambiguo, pero faltan fault-injection multiinstancia y validación de todos los efectos internos/externos. No declarar fencing plenamente cerrado ni staging-ready todavía.

### CI de este HEAD

- Push: [run 43572292463](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/43572292463).
- Pull request: [run 43572296100](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/43572296100).
- Ambos workflows están en ejecución al registrar esta sección. No se declara CI verde hasta que todos los pasos de ambos runs terminen en success.
- PR #3 sigue abierta, en draft y sin merge. No se ejecutaron migraciones reales, backfill, despliegues ni envíos externos.
- Mantener apagados `CHANNEL_OUTBOUND_DISPATCH_ENABLED`, `CHANNEL_AUTOREPLY_ENABLED`, `WORKFLOW_OUTBOX_DISPATCH_ENABLED` y `WHATSPOWER_ENABLED`.
