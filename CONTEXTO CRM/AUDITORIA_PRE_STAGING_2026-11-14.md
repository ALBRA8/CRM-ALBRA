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
