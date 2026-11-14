# Checklist de preparación para staging — CRM ALBRA8

**Repositorio:** `ALBRA8/CRM-ALBRA`  
**PR:** #3  
**Rama:** `fix/migration-safety-audit`  
**Regla:** no marcar una casilla sin evidencia asociada al HEAD exacto que se pretende validar.

## Seguridad operativa

- [ ] Confirmar que `CHANNEL_OUTBOUND_DISPATCH_ENABLED` está apagado.
- [ ] Confirmar que `CHANNEL_AUTOREPLY_ENABLED` está apagado.
- [ ] Confirmar que `WORKFLOW_OUTBOX_DISPATCH_ENABLED` está apagado.
- [ ] Confirmar que `WHATSPOWER_ENABLED` está apagado.
- [ ] Confirmar que los secretos de worker no están configurados en entornos no autorizados.
- [ ] Confirmar que no hay destinatarios ni credenciales de producción en pruebas.

## CI y calidad

- [ ] Secret scan aprobado sobre HEAD exacto.
- [ ] Prisma validate/generate aprobado.
- [ ] Migración limpia SQLite aprobada.
- [ ] Migración limpia PostgreSQL aprobada.
- [ ] Migración de datos representativos PostgreSQL aprobada.
- [ ] TypeScript aprobado.
- [ ] ESLint aprobado.
- [ ] Tests unitarios e integración aprobados.
- [ ] Tests de concurrencia y recuperación aprobados.
- [ ] Build de producción aprobado.

## Datos y recuperación

- [ ] Diagnóstico de backfill ejecutado en dry-run.
- [ ] Duplicados y conflictos revisados.
- [ ] Backfill idempotente demostrado con dos ejecuciones.
- [ ] Rollback probado en copia aislada.
- [ ] Backup PostgreSQL creado.
- [ ] Restauración en instancia independiente verificada.
- [ ] Integridad relacional y credenciales cifradas verificadas.
- [ ] RPO/RTO medidos y documentados.

## OAuth y canales

- [ ] TikTok refresh probado con dos workers independientes en PostgreSQL.
- [ ] Rotación de access/refresh token y fencing comprobados.
- [ ] Estados uncertain/invalid_grant y reconexión probados.
- [ ] Callback OAuth valida tenant y persiste ambas representaciones.
- [ ] WhatsApp, Telegram, Instagram y Messenger tienen pruebas de contrato y deduplicación.
- [ ] TikTok Business Messaging tiene fixture autorizada y mapeo real de conversation_id.
- [ ] SMTP manual integrado a outbox idempotente o mantenido explícitamente deshabilitado.
- [ ] Gmail integrado al dispatcher canónico o mantenido explícitamente deshabilitado.
- [ ] Ninguna ruta legacy realiza llamadas externas sin el control correspondiente.
- [ ] Sandboxes de proveedores validados cuando estén disponibles.

## Multi-tenant y ejecución distribuida

- [ ] Matriz de acceso cruzado por API route completada.
- [ ] Consultas Prisma y relaciones revisadas por organizationId.
- [ ] Webhooks con IDs ausentes/repetidos no producen efectos duplicados.
- [ ] Scheduler usa lease/fencing distribuido en todas las escrituras de estado.
- [ ] Dos o más workers no procesan el mismo run/outbound simultáneamente.
- [ ] Crashes, expiración de lease, ACK tardío y estado unknown probados.
- [ ] Reconciliación no reintenta envíos ambiguos automáticamente.
- [ ] Alertas y procedimientos de pausa/recuperación comprobados.

## Aprobación

- [ ] Evidencia enlazada a commits y CI del mismo HEAD.
- [ ] Revisión humana de los cambios y del informe.
- [ ] PR permanece draft hasta que todos los criterios críticos estén aprobados.
- [ ] Autorización explícita separada para staging.
- [ ] Autorización explícita separada para merge/deploy/activación de workers/envíos reales.

## Estado al crear este documento

**NO APTO PARA STAGING.** Las validaciones PostgreSQL, backfill, concurrencia multiinstancia, auditoría multitenant integral, sandbox y backup/restauración siguen pendientes. SMTP y Gmail manuales se mantienen bloqueados hasta su integración idempotente en el pipeline canónico.
