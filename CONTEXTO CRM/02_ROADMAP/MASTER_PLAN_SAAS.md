# Plan maestro de evolución SaaS
Adaptación de PLAN_MAESTRO_SAAS.md legado. Las fases son planificación, no funcionalidades implementadas.

0. **Línea base:** inventario módulos/endpoints/modelos/integraciones, matriz tenant, pruebas base, commit estable, estrategia de ramas/migraciones/rollback.
1. **Tenancy y persistencia:** auditar consultas, mutaciones, relaciones, tareas, exportaciones y archivos; constraints compuestas; pruebas negativas; elegir y ensayar migración desde SQLite.
2. **Conexiones multi-cuenta:** diseñar ChannelConnection (nombre provisional) con org, canal, proveedor, externalAccountId, estado, permisos, credencial cifrada y ciclo de vida; soportar N cuentas y migrar Integration.
3. **Webhooks/eventos:** ID externo exacto, firma, rechazo de ambigüedad, idempotencia, deduplicación, reintentos, trazas y dead-letter queue.
4. **WhatsApp multicuenta:** sesiones/auth state por conexión, asociación org/número, reconexión, recuperación, límites y concurrencia; separar Cloud API de Baileys.
5. **Otros canales:** OAuth/renovación, matching estricto, evaluar Messenger, adaptar Telegram y WhatsApp Cloud.
6. **SaaS comercial:** onboarding, invitaciones, roles, planes, cuotas, medición, suscripciones, pagos, privacidad, retención y exportación/eliminación.
7. **Operación/escala:** métricas, logs, tracing, alertas, colas, rate limits, backups, restore, RPO/RTO, carga y secretos.
8. **Ecosistema:** contratos API/eventos versionados, auth, firma, idempotencia y fallos aislados; autonomía de cada producto.

Orden 0→1→2→3→4→5→6; seguridad, observabilidad y resiliencia transversales. Cada cambio requiere alcance, decisión, rollback, pruebas, aislamiento, revisión de seguridad y evidencia.
