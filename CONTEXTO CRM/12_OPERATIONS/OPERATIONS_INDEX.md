# Índice de operaciones
| ID | Área | Estado | Siguiente paso |
|---|---|---|---|
| OPS-001 | Instalación CRM | DOCUMENTED | [README](https://github.com/ALBRA8/CRM-ALBRA/blob/main/README.md), [DEPLOY](https://github.com/ALBRA8/CRM-ALBRA/blob/main/DEPLOY.md); validar entorno |
| OPS-002 | Variables entorno | DOCUMENTED PARTIAL | .env.example; nunca copiar valores reales |
| OPS-003 | Backup SQLite | DOCUMENTED | Revisar scripts y probar restauración aislada |
| OPS-004 | Health/observabilidad | DOCUMENTED | HARNESS describe health, Doctor, timeline y ActivityLog; validar endpoints |
| OPS-005 | Despliegue/rollback | DOCUMENTED PARTIAL | DEPLOY.md; completar rollback probado |
| OPS-006 | Recuperación daemon | DOCUMENTED PARTIAL | Revisar scripts y probar fuera de producción |
| OPS-007 | Operación campañas | DOCUMENTED IN MODULE | [ULTRA README](https://github.com/ALBRA8/WHATSPOWER-ULTRA/blob/main/README.md); envío real requiere autorización |

No desplegar, migrar, ejecutar campañas reales, rotar secretos ni hacer force-push como parte de reorganización documental.
